// TZ=Asia/Ulaanbaatar npx tsx tests/importDeletion.ts
// Isolated fixtures only: verify actual import/delete/re-import with FK on/off.
import assert from "node:assert/strict";
import path from "node:path";
import knex from "knex";
import {DataService} from "../src/services/dataService";
import {ImportService} from "../src/services/importService";
import {SuspectService} from "../src/services/suspectService";
import {AuditLogService} from "../src/services/auditLogService";
import {EvidenceService} from "../src/services/evidenceService";
import {NoiseFilterService} from "../src/services/noiseFilterService";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";

async function run(foreignKeys: boolean) {
  const db = knex({client: "better-sqlite3", connection: {filename: ":memory:"},
    useNullAsDefault: true, pool: {afterCreate(conn: any, done: any) {
      conn.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`); done(null, conn);
    }}});
  try {
    await db.migrate.latest({directory: path.resolve(__dirname, "../src/db/migrations"), loadExtensions: [".ts"]});
    const data = new DataService(db), imports = new ImportService(db);
    const suspects = new SuspectService(db), audit = new AuditLogService(db);
    const evidence = new EvidenceService(db, audit), noise = new NoiseFilterService(db);
    const now = new Date().toISOString();
    const makeCase = async (caseId: string) => Number((await db("case_files")
      .insert({caseId, caseName: caseId, createdAt: now, updatedAt: now}))[0]);
    const a = await makeCase("A"), b = await makeCase("B");
    let active = a;
    const ctx = {data, imports, suspects, audit, evidence, noise,
      user: {id: 1, username: "test", role: "ADMIN"},
      auth: {accessibleCaseIds: async () => null},
      session: {getCurrentCase: async () => db("case_files").where({id: active}).first()},
    } as unknown as GraphQLContext;
    const mapping = {date: "date", account: "account", amount: "amount", ownerName: "name",
      nationalId: "register", counterpartyAccount: "party", counterpartyName: "partyName", counterpartyName2: ""};
    const statement = (account: string, name: string, party: string, partyName: string, register = "") =>
      resolvers.Mutation.importData(null, {kind: "BANK", filename: "deletion.csv",
        content: `date,account,amount,name,register,party,partyName\n2026-11-01,${account},100,${name},${register},${party},${partyName}`,
        mapping: Object.entries(mapping).map(([field, column]) => ({field, column}))}, ctx);
    const account = (accountNumber: string) => db("bank_accounts").where({accountNumber}).first();
    const remove = (id: number) => resolvers.Mutation.deleteBankAccount(null, {id, caseFileId: active}, ctx);
    const count = async (table: string) => Number((await db(table).count({n: "*"}).first())?.n);

    // A deleted statement must not leave empty counterparties, auto subjects,
    // evidence, findings or noise marks that revive on a subsequent import.
    await statement("1111111111", "Old owner", "2222222222", "Old party", "AA12345678");
    const old = await account("1111111111"), party = await account("2222222222");
    const txn = await db("bank_transactions").where({bankAccountId: old.id}).first();
    await db("analysis_results").insert({bankAccountId: old.id, analyzedAt: now});
    await db("case_conclusions").insert({caseFileId: a, bankAccountId: old.id, text: "Old", createdAt: now, updatedAt: now});
    const [link] = await db("suspect_links").insert({sourceSuspectId: old.suspectId, targetSuspectId: party.suspectId,
      linkType: "FINANCIAL_TRANSFER", caseFileId: a, contributingTxnIds: JSON.stringify([txn.id]), createdAt: now});
    await evidence.tag(a, "SUSPECT_LINK", Number(link));
    await db("case_noise_filters").insert({caseFileId: a, minAmount: 0,
      ignoredTxns: JSON.stringify([txn.id]), ignoredPairs: JSON.stringify([`${old.id}→2222222222`]),
      descRules: "[]", updatedAt: now});
    await remove(old.id);
    for (const table of ["bank_accounts", "bank_transactions", "suspects", "suspect_links",
      "evidence_entries", "analysis_results", "case_conclusions", "case_bank_accounts"]) {
      assert.equal(await count(table), 0, `Exclusive deletion left ${table}`);
    }
    const filter = await db("case_noise_filters").where({caseFileId: a}).first();
    assert.equal(filter.ignoredTxns, "[]"); assert.equal(filter.ignoredPairs, "[]");
    const fresh = await statement("1111111111", "New owner", "3333333333", "New party", "AA12345678");
    assert.equal(fresh.importedRows, 1); assert.equal(fresh.duplicateRows, 0);
    assert.equal((await db("suspects").where({id: (await account("1111111111")).suspectId}).first()).fullName, "New owner");
    assert.equal(await account("2222222222"), undefined);
    await remove((await account("1111111111")).id);

    // An endpoint used by another surviving statement stays until its last
    // source is removed. Manually maintained subjects remain independent.
    await statement("4444444444", "Owner four", "6666666666", "Shared party");
    await statement("5555555555", "Owner five", "6666666666", "Shared party");
    const manual = await suspects.createSuspect({fullName: "Manual person", nationalId: "MM12345678"});
    await evidence.tag(a, "SUSPECT", manual.id);
    await remove((await account("4444444444")).id);
    assert(await account("6666666666"));
    assert.equal((await db("bank_transactions")).length, 1);
    await remove((await account("5555555555")).id);
    assert.equal(await count("bank_accounts"), 0);
    assert.deepEqual((await suspects.getAllSuspects()).map(s => s.id), [manual.id]);
    await statement("1616161616", "Annotated import", "", "");
    const annotated = await account("1616161616");
    await db("suspects").where({id: annotated.suspectId}).update({notes: "Keep operator work"});
    await remove(annotated.id);
    assert.equal((await db("suspects").where({id: annotated.suspectId}).first()).notes, "Keep operator work");
    assert(await evidence.find(a, "SUSPECT", annotated.suspectId));

    // Every step is atomic, including secondary endpoints and imported people.
    await statement("7777777777", "Rollback owner", "8888888888", "Rollback party");
    const rollback = await account("7777777777");
    const tables = ["bank_accounts", "bank_transactions", "suspects", "evidence_entries", "case_bank_accounts"];
    const snapshot = () => Promise.all(tables.map(table => table === "case_bank_accounts"
      ? db(table).orderBy(["caseFileId", "bankAccountId"]) : db(table).orderBy("id")));
    const before = await snapshot();
    await db.raw(`CREATE TRIGGER stop_delete BEFORE DELETE ON bank_accounts WHEN OLD.id = ${Number(rollback.id)} BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
    await assert.rejects(remove(rollback.id), /test rollback/);
    assert.deepEqual(await snapshot(), before);
    await db.raw("DROP TRIGGER stop_delete"); await remove(rollback.id);

    // Shared statement rows survive both account and case removal. Deleting
    // the last case then removes the rows and all former import context.
    await statement("9999999999", "Shared owner", "1010101010", "Shared CP", "SS12345678");
    const shared = await account("9999999999");
    const sharedOwner = shared.suspectId;
    await db("suspects").where({id: sharedOwner}).update({caseId: "A"});
    active = b; await statement("9999999999", "Shared owner", "1010101010", "Shared CP", "SS12345678");
    active = a; assert.equal((await remove(shared.id)).transactions, 0);
    assert.equal((await db("bank_transactions").where({bankAccountId: shared.id})).length, 1);
    // Simulate a legacy tombstone-only account and an import-owned orphan
    // retained by an earlier version of deletion.
    const [ghost] = await db("suspects").insert({suspectId: "IMP-LEGACY", fullName: "Ghost", createdAt: now, updatedAt: now});
    await evidence.tag(a, "SUSPECT", Number(ghost), "Импорт: old.csv");
    const orphan = await data.createBankAccount({accountNumber: "1212121212", suspectId: Number(ghost)});
    const tombstone = await data.createBankAccount({accountNumber: "1313131313"});
    await db("case_bank_accounts").insert({caseFileId: a, bankAccountId: tombstone.id, isStatement: false, removed: true});
    const [caseLink] = await db("suspect_links").insert({sourceSuspectId: sharedOwner,
      targetSuspectId: sharedOwner, linkType: "FINANCIAL_TRANSFER", caseFileId: a, createdAt: now});
    const plan = await resolvers.Query.casePurgePreview(null, {caseFileId: a}, ctx);
    assert.equal(plan?.accounts, 2);
    await resolvers.Mutation.deleteCaseFile(null, {caseFileId: a}, ctx);
    assert.equal(await account(orphan.accountNumber), undefined);
    assert.equal(await account(tombstone.accountNumber), undefined);
    assert.equal(await db("suspect_links").where({id: caseLink}).first(), undefined);
    assert.equal((await db("suspects").where({id: sharedOwner}).first()).caseId, null);
    const recreated = await makeCase("A"); active = recreated;
    assert.deepEqual(await resolvers.Query.accountRecords(null, {}, ctx), []);
    assert.deepEqual(await resolvers.Query.suspects(null, {}, ctx), []);
    active = b;
    assert.equal((await resolvers.Query.accountRecords(null, {}, ctx)).length, 1);
    await resolvers.Mutation.deleteCaseFile(null, {caseFileId: b}, ctx);
    assert.equal(await count("bank_accounts"), 0); assert.equal(await count("bank_transactions"), 0);
    assert.equal(await count("case_bank_accounts"), 0); assert.equal(await count("suspects"), 0);
    active = recreated;
    const afterCase = await statement("9999999999", "Fresh after case purge", "", "", "SS12345678");
    assert.equal(afterCase.importedRows, 1); assert.equal(afterCase.duplicateRows, 0);
    assert.equal((await db("suspects").first()).fullName, "Fresh after case purge");

    // Another case mentioning the account as a counterparty must preserve its
    // own statement, but must not pin the deleted account's old statement rows.
    const contextCase = await makeCase("Context"); active = contextCase;
    await statement("1414141414", "Context owner", "9999999999", "Fresh after case purge");
    active = recreated;
    const endpoint = await account("9999999999");
    assert.equal((await remove(endpoint.id)).transactions, 1);
    assert(await account("9999999999")); // context identity remains
    assert.equal((await db("bank_transactions").where({bankAccountId: endpoint.id})).length, 0);
    const afterEndpoint = await statement("9999999999", "Fresh after case purge", "", "", "SS12345678");
    assert.equal(afterEndpoint.importedRows, 1); assert.equal(afterEndpoint.duplicateRows, 0);
    const cpPlan = await resolvers.Query.casePurgePreview(null, {caseFileId: recreated}, ctx);
    assert.equal(cpPlan?.transactions, 1); // CP role cannot pin statement rows
    await resolvers.Mutation.deleteCaseFile(null, {caseFileId: recreated}, ctx);
    assert.equal((await db("bank_transactions").where({bankAccountId: endpoint.id})).length, 0);
    active = contextCase;
    assert.equal((await resolvers.Query.transactions(null, {includeRemoved: true}, ctx)).length, 1);
    await resolvers.Mutation.deleteCaseFile(null, {caseFileId: contextCase}, ctx);
    assert.equal(await count("bank_accounts"), 0); assert.equal(await count("bank_transactions"), 0);
  } finally { await db.destroy(); }
}

(async () => {
  await run(true); await run(false);
  console.log("PASS: permanent import cleanup, fresh reimport, counterparty/manual/shared preservation, case-number reuse and rollback (FK on/off)");
})().catch(error => {console.error(error); process.exitCode = 1;});
