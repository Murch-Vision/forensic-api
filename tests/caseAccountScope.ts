// Run: TZ=Asia/Ulaanbaatar npx tsx tests/caseAccountScope.ts
// Entire import/delete/case-switch sequence uses an isolated in-memory DB.
import assert from "node:assert/strict";
import path from "node:path";
import knex from "knex";
import {ImportService} from "../src/services/importService";
import {DataService} from "../src/services/dataService";
import {SuspectService} from "../src/services/suspectService";
import {AuditLogService} from "../src/services/auditLogService";
import {EvidenceService} from "../src/services/evidenceService";
import {NoiseFilterService} from "../src/services/noiseFilterService";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";
import {up as backfill, down as removeMemberships} from "../src/db/migrations/20261023000000_case_bank_accounts";

async function main() {
  const db = knex({client: "better-sqlite3", connection: {filename: ":memory:"},
    useNullAsDefault: true, pool: {afterCreate(conn: any, done: any) {
      conn.pragma("foreign_keys = ON"); done(null, conn);
    }}});
  try {
    await db.migrate.latest({directory: path.resolve(__dirname, "../src/db/migrations"),
      loadExtensions: [".ts"]});
    const data = new DataService(db), suspects = new SuspectService(db);
    const audit = new AuditLogService(db), evidence = new EvidenceService(db, audit);
    const imports = new ImportService(db), noise = new NoiseFilterService(db);
    const now = new Date().toISOString();
    const [a] = await db("case_files").insert({caseId: "A", caseName: "A",createdAt: now, updatedAt: now});
    const [b] = await db("case_files").insert({caseId: "B", caseName: "B",createdAt: now, updatedAt: now});
    const [empty] = await db("case_files").insert({caseId: "empty", caseName: "empty",createdAt: now, updatedAt: now});
    let active: number | null = Number(a);
    const ctx = {data, suspects, imports, audit, evidence, noise,
      user: {id: 1, username: "test", role: "ADMIN"},
      auth: {accessibleCaseIds: async () => null},
      session: {getCurrentCase: async () => active == null ? null : db("case_files").where({id: active}).first()},
      analysis: {analyzeNetworkFlow: (people: unknown, accounts: unknown, transactions: unknown) => ({people, accounts, transactions})},
    } as unknown as GraphQLContext;
    const mapping = {account: "account", date: "date", amount: "amount", nationalId: "register", counterpartyAccount: "party"};
    const importStatement = async (account: string, party = "") => resolvers.Mutation.importData(null, {
      content: `date,account,register,amount,party\n2026-10-01,${account},AA12345678,100,${party}`,
      kind: "BANK", filename: "test.csv", mapping: Object.entries(mapping).map(([field,column]) => ({field,column})),
    }, ctx);
    const records = async () => (await resolvers.Query.accountRecords(null, {}, ctx)).map(r => r.accountNumber);
    const accountIds = async () => (await resolvers.Query.bankAccounts(null, {}, ctx)).map(r => r.accountNumber).sort();
    const txns = () => resolvers.Query.transactions(null, {includeRemoved: true}, ctx);
    const idFor = async (accountNumber: string) => (await db("bank_accounts").where({accountNumber}).first()).id;

    await importStatement("1111111111");
    active = Number(b); await importStatement("2222222222");
    assert.deepEqual(await records(), ["2222222222"]);
    assert.deepEqual((await resolvers.Query.accountRecords(null, {caseFileId: Number(a)}, ctx))
      .map(r => r.accountNumber), ["1111111111"]);
    await assert.rejects(resolvers.Mutation.deleteBankAccount(null,
      {id: await idFor("2222222222"), caseFileId: Number(a)}, ctx), /солигдсон/);
    assert.deepEqual(await accountIds(), ["2222222222"]);
    assert.equal((await txns()).length, 1);
    const restricted = {...ctx, auth: {accessibleCaseIds: async () => new Set([Number(a)])}} as unknown as GraphQLContext;
    await assert.rejects(resolvers.Query.accountRecords(null, {caseFileId: Number(b)}, restricted), /эрхгүй/);
    const owner = (await suspects.getAllSuspects())[0];
    assert.deepEqual((await resolvers.Suspect.bankAccounts(owner, {}, ctx)).map(a => a.accountNumber), ["2222222222"]);
    active = Number(empty); await evidence.tag(Number(empty), "SUSPECT", owner.id);
    assert.deepEqual(await records(), []); assert.deepEqual(await accountIds(), []);
    // No "if the account scope is empty use all of the person's accounts" fallback.
    assert.deepEqual((await resolvers.Query.networkFlow(null, {}, ctx) as any).accounts, []);
    active = Number(a);
    assert.deepEqual(await records(), ["1111111111"]);
    // Import B's statement account only as a counterparty in A: keep the graph
    // endpoint, but never pull B's statement rows into A's delete list or totals.
    await importStatement("1111111111", "2222222222");
    assert.deepEqual(await accountIds(), ["1111111111", "2222222222"]);
    assert.deepEqual(await records(), ["1111111111"]);
    assert.equal((await txns()).length, 2);
    const sharedId = await idFor("1111111111");
    active = Number(b); const dup = await importStatement("1111111111");
    assert.equal(dup.duplicateRows, 1); // duplicate-only import still attaches the statement.
    active = Number(a);
    const removal = await resolvers.Mutation.deleteBankAccount(null, {id: sharedId}, ctx);
    assert.equal(removal.transactions, 0); // other case's statement survives.
    assert.deepEqual(await records(), []); assert.equal((await txns()).length, 0);
    assert.equal((await db("bank_transactions").where({bankAccountId: sharedId})).length, 2);
    await importStatement("3333333333", "1111111111");
    assert.deepEqual(await records(), ["3333333333"]);
    assert(!(await accountIds()).includes("1111111111")); // CP cannot resurrect removal.
    assert.equal((await txns()).length, 1);
    active = Number(b);
    assert.deepEqual(new Set(await records()), new Set(["1111111111", "2222222222"]));
    active = Number(a); await importStatement("1111111111");
    assert((await records()).includes("1111111111")); // explicit re-import restores it.
    // Unshared account delete, then import another account for the same person.
    const unsharedId = await idFor("3333333333");
    await resolvers.Mutation.deleteBankAccount(null, {id: unsharedId}, ctx);
    await importStatement("4444444444");
    assert(!(await records()).includes("3333333333"));
    assert.equal(await db("bank_accounts").where({id: unsharedId, accountNumber: "3333333333"}).first(), undefined);
    // Case purge never expands through the shared person to unrelated accounts.
    const plan = await resolvers.Query.casePurgePreview(null, {caseFileId: Number(a)}, ctx);
    assert.equal(plan?.accounts, 1); // only 4444444444 is exclusive to A.
    await resolvers.Mutation.deleteCaseFile(null, {caseFileId: Number(a)}, ctx);
    active = Number(b); assert.deepEqual(new Set(await records()), new Set(["1111111111", "2222222222"]));
    // Legacy explicit evidence is retained by migration, while a person's
    // other account is never manufactured into another case.
    await removeMemberships(db); await backfill(db);
    assert.deepEqual(new Set(await records()), new Set(["1111111111", "2222222222"]));
    active = Number(empty); assert.deepEqual(await records(), []);
    // A merge must carry exact statement roles to the target, too.
    active = Number(empty); await importStatement("5555555555");
    await data.mergeCases([Number(empty)], Number(b));
    active = Number(b);
    assert.deepEqual(new Set(await records()), new Set(["1111111111", "2222222222", "5555555555"]));
    const ev = await evidence.find(Number(b), "BANK_ACCOUNT", await idFor("5555555555"));
    await evidence.untag(ev!.id);
    assert(!(await accountIds()).includes("5555555555"));
    active = null; // Existing admin global registry behavior remains available.
    assert.equal((await resolvers.Query.bankAccounts(null, {}, ctx)).length, 3);
    console.log("PASS: exact per-case accounts, nested owners, CP roles, delete/reimport, shared preservation, purge, legacy migration");
  } finally { await db.destroy(); }
}
main().catch(e => {console.error(e);process.exitCode=1;});
