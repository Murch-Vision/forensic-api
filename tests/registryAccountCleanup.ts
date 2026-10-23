// TZ=Asia/Ulaanbaatar npx tsx tests/registryAccountCleanup.ts
// No real database or case is touched.
import assert from "node:assert/strict";
import path from "node:path";
import knex from "knex";
import {DataService} from "../src/services/dataService";
import {SuspectService} from "../src/services/suspectService";
import {PeopleService} from "../src/services/peopleService";
import {AuditLogService} from "../src/services/auditLogService";
import {EvidenceService} from "../src/services/evidenceService";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";

async function main() {
  const db = knex({client: "better-sqlite3", connection: {filename: ":memory:"},
    useNullAsDefault: true, pool: {afterCreate(conn: any, done: any) {
      conn.pragma("foreign_keys = ON"); done(null, conn);
    }}});
  try {
    await db.migrate.latest({directory: path.resolve(__dirname, "../src/db/migrations"),
      loadExtensions: [".ts"]});
    const data = new DataService(db), suspects = new SuspectService(db);
    const people = new PeopleService(db), audit = new AuditLogService(db);
    const evidence = new EvidenceService(db, audit);
    const now = new Date().toISOString();
    const [a] = await db("case_files").insert({caseId: "A", caseName: "A", createdAt: now, updatedAt: now});
    const [b] = await db("case_files").insert({caseId: "B", caseName: "B", createdAt: now, updatedAt: now});
    const [owner] = await db("suspects").insert({suspectId: "OWNER", fullName: "Нэг эзэмшигч", caseId: "A", createdAt: now, updatedAt: now});
    await evidence.tag(Number(a), "SUSPECT", Number(owner));
    const addAccount = (accountNumber: string) => data.createBankAccount({accountNumber, suspectId: owner});
    const old = await addAccount("1111111111"), live = await addAccount("2222222222");
    await data.linkCaseBankAccounts(Number(a), [live.id], [live.id]);
    await data.linkCaseBankAccounts(Number(b), [live.id], [live.id]);
    await evidence.tag(Number(a), "BANK_ACCOUNT", live.id);
    // Old removals may leave a tombstone on the account. That is not live use.
    await db("case_bank_accounts").insert({caseFileId: a, bankAccountId: old.id, isStatement: false, removed: true});
    const [oldTxn] = await db("bank_transactions").insert({bankAccountId: old.id, timestamp: now, amount: 10, type: "CREDIT"});
    const [otherTxn] = await db("bank_transactions").insert({bankAccountId: live.id, timestamp: now, amount: 10, type: "DEBIT", counterpartyAccount: old.accountNumber});
    await db("analysis_results").insert({bankAccountId: old.id, analyzedAt: now});
    const ctx = {data, suspects, people, evidence, audit,
      user: {id: 1, username: "admin", role: "ADMIN"},
      session: {getCurrentCase: async () => db("case_files").where({id: a}).first()},
    } as unknown as GraphQLContext;
    const preview = (id: number, context = ctx) => resolvers.Query.bankAccountCleanupPreview(null, {id}, context);
    const remove = (id: number, context = ctx) => resolvers.Mutation.deleteOrphanBankAccount(null, {id}, context);
    const detective = {...ctx, user: {...ctx.user!, role: "DETECTIVE"}} as GraphQLContext;
    const anonymous = {...ctx, user: null};
    for (const context of [detective, anonymous]) {
      await assert.rejects(preview(old.id, context), /админ|Нэвтрэх/);
      await assert.rejects(remove(old.id, context), /админ|Нэвтрэх/);
    }
    assert.deepEqual((await preview(live.id)).cases.map(c => c.caseId), ["A", "B"]);
    await assert.rejects(remove(live.id), /хэрэгт ашиглагдаж/);
    const plan = await preview(old.id);
    assert.equal(plan.txnCount, 1);
    assert.deepEqual(plan.cases, []); // owner's cases never expand to accounts
    const removed = await remove(old.id);
    assert.equal(removed.transactions, 1); assert.equal(removed.analyses, 1);
    assert.equal(await db("bank_accounts").where({id: old.id}).first(), undefined);
    assert.equal(await db("bank_transactions").where({id: oldTxn}).first(), undefined);
    assert.equal((await db("bank_transactions").where({id: otherTxn}).first()).counterpartyAccount, old.accountNumber);
    assert(await db("suspects").where({id: owner}).first());
    assert.equal((await db("case_bank_accounts").where({bankAccountId: live.id})).length, 2);
    assert.equal((await people.getGlobalPeople())[0].bankAccounts.length, 1);
    assert.equal((await people.getGlobalPeople())[0].accountNumbers.includes(old.accountNumber), false);
    assert(await db("audit_events").where({action: "BankAccount.Cleanup", target: `BankAccount:${old.id}`}).first());
    await assert.rejects(remove(old.id), /Данс олдсонгүй/);
    await assert.rejects(preview(999999), /Данс олдсонгүй/);

    // A case attached AFTER preview must veto the write, even without evidence.
    const raced = await addAccount("3333333333");
    assert.deepEqual((await preview(raced.id)).cases, []);
    await data.linkCaseBankAccounts(Number(b), [raced.id]); // counterparty role protects too
    await assert.rejects(remove(raced.id), /хэрэгт ашиглагдаж/);
    assert(await db("bank_accounts").where({id: raced.id}).first());

    // Legacy direct account evidence, transaction-only evidence, conclusions,
    // and saved/tagged findings all protect their actual account.
    const legacy = await addAccount("4444444444");
    await evidence.tag(Number(b), "BANK_ACCOUNT", legacy.id);
    assert.equal((await preview(legacy.id)).cases[0].id, b);
    await assert.rejects(remove(legacy.id), /хэрэгт ашиглагдаж/);
    const txnOnly = await addAccount("5555555555");
    const [t] = await db("bank_transactions").insert({bankAccountId: txnOnly.id, timestamp: now, amount: 1, type: "CREDIT"});
    const txnEvidence = await evidence.tag(Number(b), "TRANSACTION", Number(t));
    await assert.rejects(remove(txnOnly.id), /хэрэгт ашиглагдаж/);
    await db("evidence_entries").where({id: txnEvidence.id}).del();
    await db("case_conclusions").insert({caseFileId: b, bankAccountId: txnOnly.id, text: "Finding", createdAt: now, updatedAt: now});
    await assert.rejects(remove(txnOnly.id), /хэрэгт ашиглагдаж/);
    await db("case_conclusions").where({bankAccountId: txnOnly.id}).del();
    const [graphId] = await db("case_graphs").insert({caseFileId: b, name: "Board", state: "{}", createdAt: now, updatedAt: now});
    const [linkId] = await db("suspect_links").insert({sourceSuspectId: owner, targetSuspectId: owner,
      linkType: "FINANCIAL_TRANSFER", createdAt: now, caseGraphId: graphId, contributingTxnIds: JSON.stringify([t])});
    await assert.rejects(remove(txnOnly.id), /хэрэгт ашиглагдаж/);
    await db("suspect_links").where({id: linkId}).update({caseGraphId: null});
    await evidence.tag(Number(b), "SUSPECT_LINK", Number(linkId));
    await assert.rejects(remove(txnOnly.id), /хэрэгт ашиглагдаж/);
    // No active case is needed for an admin's orphan cleanup.
    const empty = await addAccount("6666666666");
    const noCase = {...ctx, session: {getCurrentCase: async () => null}} as unknown as GraphQLContext;
    assert.equal((await remove(empty.id, noCase)).transactions, 0);
    console.log("PASS: registry cleanup auth, orphan removal, counts, exact references, race recheck, cross-case/owner/counterparty preservation, audit");
  } finally { await db.destroy(); }
}
main().catch(e => {console.error(e);process.exitCode = 1;});
