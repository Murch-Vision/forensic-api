// Run: npx tsx tests/importCounterparties.ts (isolated in-memory database).
import assert from "node:assert/strict";
import path from "node:path";
import knex from "knex";
import {ImportService} from "../src/services/importService";
import {parseMnIban, BankLookupService} from "../src/services/bankLookupService";
import {DataService} from "../src/services/dataService";
import {EvidenceService} from "../src/services/evidenceService";
import {AuditLogService} from "../src/services/auditLogService";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";

async function main() {
  const db = knex({client: "better-sqlite3", connection: {filename: ":memory:"},
    useNullAsDefault: true});
  try {
    await db.migrate.latest({directory: path.resolve(__dirname, "../src/db/migrations"),
      loadExtensions: [".ts"]});
    const imports = new ImportService(db);
    const audit = new AuditLogService(db);
    const evidence = new EvidenceService(db, audit);
    const [caseId] = await db("case_files").insert({caseId: "test", caseName: "test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()});
    const mapping = {date: "date", account: "account", ownerName: "owner",
      nationalId: "register", amount: "amount", counterpartyAccount: "party",
      counterpartyName: "partyName", counterpartyNationalId: "partyRegister"};
    const content = ["date,account,owner,register,amount,party,partyName,partyRegister",
      "2026-06-29,330005005037400502,Owner,AA12345678,-100,5124051798,,",
      "2026-06-30,330005005037400502,Owner,AA12345678,200,5030673757,,",
      "2026-07-01,330005005037400502,Owner,AA12345678,300,5124051798,,",
      "2026-07-02,330005005037400502,Owner,AA12345678,-50,-,-,-",
      "2026-07-03,330005005037400502,Owner,AA12345678,-60,5219208949,Known,BB12345678"
    ].join("\n");
    const first = await imports.importData({content, filename: "test.csv", kind: "BANK", mapping});
    assert.equal(first.importedRows, 5);
    assert.deepEqual(first.errors, []);
    const accounts = await db("bank_accounts");
    assert.equal(accounts.length, 4);
    assert.equal(new Set(accounts.map(a => a.suspectId)).size, 4);
    assert.equal(accounts.find(a => a.accountNumber === "330005005037400502").iban,
      "MN330005005037400502");
    const unknown = await db("suspects").where({fullName: "5124051798"}).first();
    assert.equal(unknown.nationalId, null);
    assert.equal((await db("suspects").where({nationalId: "BB12345678"}).first()).fullName, "Known");
    // A saved owner must survive re-import of a nameless counterparty.
    await db("suspects").where({id: unknown.id}).update({fullName: "Verified owner"});
    await db("bank_accounts").where({suspectId: unknown.id})
      .update({accountHolderName: "Verified owner"});
    // A duplicate-only re-import must repair case evidence, then stay idempotent.
    const ctx = {imports, audit, evidence, data: new DataService(db),
      session: {getCurrentCase: async () => ({id: caseId})}} as unknown as GraphQLContext;
    const args = {content, kind: "BANK" as const, filename: "test.csv",
      mapping: Object.entries(mapping).map(([field, column]) => ({field, column}))};
    for (let i = 0; i < 2; i++) {
      const sum = await resolvers.Mutation.importData(null, args, ctx);
      assert.equal(sum.importedRows, 0);
      assert.equal(sum.duplicateRows, 5);
      assert.equal((await db("bank_transactions")).length, 5);
      assert.equal((await db("bank_accounts")).length, 4);
      assert.equal((await db("suspects")).length, 4);
      assert.equal((await evidence.getForCase(caseId)).length, 8);
    }
    assert.equal((await db("suspects").where({id: unknown.id}).first()).fullName, "Verified owner");
    assert.equal((await db("bank_accounts").where({suspectId: unknown.id}).first()).accountHolderName, "Verified owner");
    assert.equal(parseMnIban("330005005037400502")?.bankCode, "0005");
    assert.equal(parseMnIban("330005005037400503"), null);
    assert.equal(parseMnIban("5037400502"), null);
    assert.equal(parseMnIban("MN000005005037400502"), null);
    // Mock the public bank service: the restored IBAN must select the bank
    // and send only its 12 account digits, without querying unrelated banks.
    const fetchOriginal = globalThis.fetch;
    const requests: any[] = [];
    globalThis.fetch = async (_url, options) => {
      if (options?.body) requests.push(JSON.parse(String(options.body)).body);
      return new Response(JSON.stringify({header: {code: 200}, body: options?.body
        ? {accountIban: "MN330005005037400502", accountName: "Owner"}
        : [{cmCode: "050000|AGMOMNUB", cdDesc: "Хаан банк"}]}));
    };
    try {
      assert.equal((await new BankLookupService(db).resolve("330005005037400502"))?.bankName, "Хаан банк");
      assert.deepEqual(requests, [{value: "005037400502", bankId: "050000|AGMOMNUB"}]);
    } finally { globalThis.fetch = fetchOriginal; }
    console.log("PASS: account-only parties, register owners, placeholders, duplicate repair, IBAN lookup");
  } finally { await db.destroy(); }
}
main().catch(e => {console.error(e); process.exitCode = 1;});
