// npx tsx tests/multiCaseAnalysis.ts
// Real admin resolver and scope/noise/relations; service doubles, no DB writes.
import assert from "node:assert/strict";
import {buildSchema, parse, validate} from "graphql";
import {typeDefs} from "../src/graphql/schema";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";
import type {NoiseFilter} from "../src/services/noiseFilterService";

async function main() {
  const schema = buildSchema(typeDefs);
  assert.deepEqual(validate(schema, parse(`query($ids:[Int!]!){adminCaseAnalysis(caseFileIds:$ids){
    cases{id caseId caseName} accounts{account{id suspectId} caseFileIds statementCaseFileIds}
    people{person{id fullName} caseFileIds} transactions{transaction{id amount} caseFileIds relationKey}
    relations{relation{key txnCount creditTotal} caseFileIds} links{id contributingTxnIds totalFinancialValue}
  }}`)), []);
  const cases = [1, 2, 3].map(id => ({id, caseId: `C${id}`, caseName: `Case ${id}`}));
  // Owner 1 also owns other statements; membership never expands through owner.
  const accounts = [[10, 1], [20, 2], [30, 1], [40, 2], [50, 1], [60, 1], [70, 1]]
    .map(([id, suspectId]) => ({id, suspectId, accountNumber: String(id), bankName: null,
      accountHolderName: id === 20 ? "Counterparty" : null}));
  const suspects = [1, 2, 3].map(id => ({id, fullName: `Person ${id}`, caseId: `C${id}`,
    nationalId: null}));
  const member = (caseFileId: number, bankAccountId: number, isStatement = true, removed = false) =>
    ({caseFileId, bankAccountId, isStatement, removed});
  const memberships = [member(1, 10), member(1, 20, false), member(1, 60, true, true),
    member(2, 10), member(2, 30), member(3, 20), member(3, 40), member(3, 70)];
  const entry = (caseFileId: number, sourceType: string, sourceId: number) =>
    ({caseFileId, sourceType, sourceId});
  const entries = [entry(1, "TRANSACTION", 50), entry(1, "TRANSACTION", 60),
    entry(1, "BANK_ACCOUNT", 60), entry(1, "SUSPECT", 1), entry(2, "SUSPECT", 1)];
  const txn = (id: number, bankAccountId: number, extras = {}) => ({id, bankAccountId,
    timestamp: "2026-11-01T10:00:00Z", amount: 100, type: "credit",
    counterpartyAccount: "20", counterpartyName: null, counterpartyNationalId: null,
    description: "normal", ...extras});
  const transactions = [txn(1, 10), txn(2, 30), txn(3, 20), txn(4, 40), txn(5, 10),
    txn(6, 10), txn(7, 10, {amount: 1}), txn(8, 10, {description: "START fee"}),
    txn(9, 10, {description: "fee END"}), txn(11, 10, {description: "a MID b"}),
    txn(12, 10, {counterpartyAccount: " PAIR "}), txn(50, 50), txn(51, 50), txn(60, 60), txn(70, 70)];
  const filter = (): NoiseFilter => ({minAmount: 5, ignoredPairs: ["10→PAIR"],
    ignoredTxns: [6], descRules: [{mode: "starts", text: "start"},
      {mode: "ends", text: "end"}, {mode: "contains", text: "mid"}]});
  const filters = new Map([[1, {...filter(), ignoredTxns: [5, 6]}], [2, filter()], [3, filter()]]);
  const link = (id: number, caseFileId: number | null, ids: number[]) => ({id,
    caseFileId, sourceSuspectId: 1, targetSuspectId: 2, linkType: "FINANCIAL_TRANSFER",
    totalFinancialValue: 999999, contributingTxnIds: JSON.stringify(ids), strength: 10});
  const links = [link(1, 1, [1, 2, 5, 6, 50, 60, 70]), link(2, 2, [1, 2, 5, 6]),
    link(3, 3, [3, 4, 70]), link(4, null, [70]), {...link(5, 1, [1]), linkType: "MANUAL"}];
  const before = JSON.stringify({cases, accounts, suspects, memberships, entries, transactions, links, filters: [...filters]});
  let reads = 0;
  const read = async <T,>(value: T) => {reads++; return value;};
  const ctx = {
    user: {id: 1, role: "ADMIN", username: "qa"},
    session: {getCurrentCase: async () => {throw Error("Must not consult active case");}},
    suspects: {getAllSuspects: () => read(suspects)},
    data: {getAllCaseFiles: () => read(cases), getAllBankAccounts: () => read(accounts),
      getAllTransactions: () => read(transactions), getAllLinks: () => read(links),
      getCaseBankAccounts: (ids: number[]) => read(memberships.filter(m => ids.includes(m.caseFileId)))},
    evidence: {getForCase: (id: number) => read(entries.filter(e => e.caseFileId === id))},
    noise: {getForCase: (id: number) => read(filters.get(id))},
  } as unknown as GraphQLContext;
  const query = (caseFileIds: number[], c = ctx) => resolvers.Query.adminCaseAnalysis(null, {caseFileIds}, c);
  await assert.rejects(query([1], {...ctx, user: null}), /Нэвтрэх/);
  await assert.rejects(query([1], {...ctx, user: {...ctx.user!, role: "DETECTIVE"}}), /админ/);
  assert.equal(reads, 0, "Unauthorized requests must not read evidence");
  for (const ids of [[], [0], [-1], [1.5], [NaN]]) await assert.rejects(query(ids), /сонгоно/);
  assert.equal(reads, 0);
  await assert.rejects(query([999]), /олдсонгүй/);
  const a = await query([1]);
  assert.deepEqual(a.transactions.map(r => r.transaction.id), [1, 50]);
  assert.deepEqual(a.accounts.map(r => r.account.id), [10, 20, 50]);
  assert(!a.transactions.some(r => [3, 4, 51, 60, 70].includes(r.transaction.id)),
    "Counterparty, same owner, tagged-row siblings, removed accounts and other cases stay out");
  const union = await query([2, 1, 2]);
  assert.deepEqual(union.cases.map(c => c.id), [1, 2]);
  assert.deepEqual(union.transactions.map(r => r.transaction.id), [1, 2, 5, 50]);
  assert.deepEqual(union.transactions.find(r => r.transaction.id === 1)?.caseFileIds, [1, 2]);
  assert.deepEqual(union.transactions.find(r => r.transaction.id === 5)?.caseFileIds, [2],
    "Removal belongs to each case independently");
  assert(!union.transactions.some(r => r.transaction.id === 6));
  assert.deepEqual(union.accounts.find(r => r.account.id === 20)?.statementCaseFileIds, []);
  assert.deepEqual(union.relations.map(r => [r.relation.key, r.relation.txnCount,
    r.relation.creditTotal, r.caseFileIds]), [["name:counterparty", 4, 400, [1, 2]]]);
  assert.equal(union.links.length, 1);
  assert.deepEqual(JSON.parse(union.links[0].contributingTxnIds!), [1, 50, 2, 5]);
  assert.equal(union.links[0].totalFinancialValue, 400,
    "Shared backing rows counted once; other-case, removed, legacy and manual links excluded");
  assert.deepEqual((await query([2, 1])).transactions, union.transactions);
  assert.deepEqual((await query([3])).transactions.map(r => r.transaction.id), [3, 4, 70]);
  assert.equal(JSON.stringify({cases, accounts, suspects, memberships, entries, transactions, links, filters: [...filters]}), before,
    "The combined view must not mutate or merge source data, memberships, filters or links");
  console.log("PASS: admin-only explicit case union, exact account/tagged-row scope, tombstones, per-case noise, deduplication/provenance, relation/link totals and read-only source preservation");
}
main().catch(e => {console.error(e); process.exitCode = 1;});
