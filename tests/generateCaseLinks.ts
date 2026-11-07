// npx tsx tests/generateCaseLinks.ts
// Real generation/resolvers, service doubles; no application DB is changed.
import assert from "node:assert/strict";
import {AnalysisService} from "../src/services/analysisService";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";
import type {DataService} from "../src/services/dataService";

async function main() {
  const cases = [{id: 1, caseId: "A"}, {id: 2, caseId: "B"}];
  const accounts = [[10, 1], [20, 2], [11, 1], [21, 2]].map(([id, suspectId]) =>
    ({id, suspectId, accountNumber: String(id), accountHolderName: null}));
  const people = [1, 2].map(id => ({id, fullName: `Person ${id}`,
    caseId: id === 1 ? "A" : "B", aliases: null, nationalId: null,
    bankAccounts: accounts.filter(a => a.suspectId === id),
    phoneNumbers: [{number: String(id)}]}));
  const txn = (id: number, bankAccountId: number, cp: string, amount: number) => ({
    id, bankAccountId, counterpartyAccount: cp, counterpartyName: null,
    counterpartyNationalId: null, amount, type: "credit", description: null,
    timestamp: "2026-11-01T10:00:00Z"});
  const transactions = [txn(1, 10, "20", 100), txn(2, 21, "11", 900),
    txn(3, 11, "20", 50000), txn(7, 11, "20", 7), txn(8, 10, "20", 123)];
  const calls = [{id: 30, suspectId: 2, callerNumber: "2", calledNumber: "1",
    durationSeconds: 99, startTime: "2026-11-01T10:00:00Z"}];
  const legacy = {id: 90, sourceSuspectId: 1, targetSuspectId: 2,
    linkType: "FINANCIAL_TRANSFER", totalFinancialValue: 999999,
    contributingTxnIds: "[2]", caseFileId: null};
  const manual = {...legacy, id: 91, linkType: "MANUAL", contributingTxnIds: null};
  let stored: any[] = [legacy, manual];
  let active: number | null = 1, changeDuringRead = false, failSave = false;
  let saves = 0;
  const data = {
    getAllCaseFiles: async () => cases,
    getAllBankAccounts: async () => accounts,
    getSuspectsWithRelations: async () => structuredClone(people),
    getAllTransactions: async () => {
      if (changeDuringRead) active = 2;
      return transactions;
    },
    getAllCallRecords: async () => calls,
    getAllLinks: async () => structuredClone(stored),
    getCaseBankAccounts: async (ids: number[]) => ids.flatMap(caseFileId =>
      (caseFileId === 1 ? [10, 20] : [11, 21]).map(bankAccountId => ({
        caseFileId, bankAccountId, removed: false,
        isStatement: caseFileId === 1 ? bankAccountId === 10 : true}))),
    replaceCaseGeneratedLinks: async (caseFileId: number, links: any[]) => {
      if (failSave) throw Error("save failed");
      saves++;
      const rows = links.map((l, i) => ({...l, id: caseFileId * 100 + i, caseFileId}));
      stored = stored.filter(l => l.caseFileId !== caseFileId || l.linkType === "MANUAL").concat(rows);
      return rows;
    },
  } as unknown as DataService;
  const ctx = {
    data, analysis: new AnalysisService(data),
    user: {id: 1, role: "DETECTIVE", username: "qa"},
    auth: {accessibleCaseIds: async () => new Set([1, 2])},
    session: {getCurrentCase: async () => cases.find(c => c.id === active) ?? null},
    suspects: {getAllSuspects: async () => people},
    evidence: {getForCase: async (id: number) => id === 1
      ? [{caseFileId: 1, sourceType: "TRANSACTION", sourceId: 7}] : []},
    noise: {getForCase: async () => ({minAmount: 0, ignoredPairs: [],
      ignoredTxns: [8], descRules: []})},
    audit: {record: async () => undefined},
  } as unknown as GraphQLContext;
  const generate = (c = ctx) => resolvers.Mutation.generateLinks(null, {}, c);
  assert.deepEqual((await resolvers.Query.suspectLinks(null, {}, ctx)).map(l => l.id), [91],
    "Global legacy links must not leak into a case even with identical endpoints");
  await assert.rejects(generate({...ctx, user: null}), /Нэвтрэх/);
  await assert.rejects(generate({...ctx, auth: {accessibleCaseIds: async () => new Set([2])}} as any), /эрхгүй/);
  active = null; await assert.rejects(generate(), /хэрэг сонго/); active = 1;
  const a = await generate();
  assert.equal(a.length, 1); assert.equal(a[0].totalFinancialValue, 107);
  assert.deepEqual(JSON.parse(a[0].contributingTxnIds!), [1, 7]);
  assert.equal(a[0].caseFileId, 1);
  assert(!a.some(l => l.linkType === "PHONE_CONTACT"), "Other case's calls stay out");
  const ownA = structuredClone(stored.filter(l => l.caseFileId === 1));
  active = 2; await generate();
  assert.deepEqual(stored.filter(l => l.caseFileId === 1), ownA,
    "Generating B preserves A even when both share exactly the same people");
  const ownB = structuredClone(stored.filter(l => l.caseFileId === 2));
  assert(ownB.some(l => l.linkType === "PHONE_CONTACT"));
  active = 1; await generate();
  assert.deepEqual(stored.filter(l => l.caseFileId === 2), ownB);
  assert(stored.some(l => l.id === 90) && stored.some(l => l.id === 91));
  // A stale/corrupt stored total can never expose B's row in A.
  stored.find(l => l.caseFileId === 1).contributingTxnIds = "[1,2,7,8]";
  const visible = await resolvers.Query.suspectLinks(null, {}, ctx);
  assert.equal(visible.find(l => l.caseFileId === 1)?.totalFinancialValue, 107);
  assert(!visible.some(l => l.caseFileId === 2 || l.id === 90));
  const before = structuredClone(stored), saveCount = saves;
  changeDuringRead = true; await assert.rejects(generate(), /солигдсон/);
  assert.equal(saves, saveCount); assert.deepEqual(stored, before);
  changeDuringRead = false; active = 1; failSave = true;
  await assert.rejects(generate(), /save failed/); assert.deepEqual(stored, before);
  console.log("PASS: case generation scopes exact accounts, tagged rows, calls and noise; shared owners cannot pull other statements; independent replacements, legacy hiding, auth/stale/failure checks and scoped totals");
}
main().catch(e => {console.error(e); process.exitCode = 1;});
