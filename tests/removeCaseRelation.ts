// TZ=Asia/Ulaanbaatar npx tsx tests/removeCaseRelation.ts
// Real resolvers and relation identity; in-memory service doubles, no DB writes.
import assert from "node:assert/strict";
import {buildSchema} from "graphql";
import {typeDefs} from "../src/graphql/schema";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";
import type {NoiseFilter} from "../src/services/noiseFilterService";

async function main() {
  assert(buildSchema(typeDefs).getMutationType()?.getFields().removeCaseRelation);
  const cases = [{id: 1, caseId: "A"}, {id: 2, caseId: "B"}];
  const accounts = [10, 20, 30, 40, 50].map(id => ({id, accountNumber: String(id),
    bankName: null, accountHolderName: id === 40 ? "Verified Owner" : null}));
  const txn = (id: number, bankAccountId: number, account: string | null,
    name: string | null, nationalId: string | null = null) => ({
    id, bankAccountId, counterpartyAccount: account, counterpartyName: name,
    counterpartyNationalId: nationalId, amount: 100, type: "credit", description: null,
  });
  const transactions = [txn(1, 10, "X", "Person"), txn(2, 10, "Y", " Person "),
    txn(3, 20, "X", "Person"), txn(4, 30, "X", "Person"),
    txn(5, 10, "X", "Other Person"), txn(6, 10, null, null, "aa123"),
    txn(7, 10, null, "Name Only"), txn(8, 10, "40", "40"),
    txn(9, 10, "Z", null), txn(11, 50, "X", "Person"), txn(12, 50, "X", "Person")];
  const initial = (): NoiseFilter => ({minAmount: 5, ignoredPairs: ["20→other"],
    ignoredTxns: [99], descRules: [{mode: "contains", text: "noise"}]});
  const filters = new Map([[1, initial()], [2, initial()]]);
  let active = 1, failSave = false, changeDuringRead = false;
  let saves = 0;
  const ctx = {
    user: {id: 1, username: "test", role: "DETECTIVE"},
    auth: {accessibleCaseIds: async () => new Set([1, 2])},
    session: {getCurrentCase: async () => cases.find(c => c.id === active)},
    suspects: {getAllSuspects: async () => []},
    evidence: {getForCase: async (id: number) => id === 1
      ? [{caseFileId: 1, sourceType: "TRANSACTION", sourceId: 11}] : []},
    data: {
      getAllCaseFiles: async () => cases,
      getCaseBankAccounts: async (ids: number[]) => ids.flatMap(caseFileId =>
        (caseFileId === 1 ? [10, 20, 40] : [10, 30]).map(bankAccountId =>
          ({caseFileId, bankAccountId, removed: false, isStatement: bankAccountId !== 40}))),
      getAllBankAccounts: async () => accounts,
      getAllTransactions: async () => {
        if (changeDuringRead) active = 2;
        return transactions;
      },
    },
    noise: {
      getForCase: async (id: number) => structuredClone(filters.get(id)),
      saveForCase: async (id: number, filter: NoiseFilter) => {
        if (failSave) throw Error("save failed");
        saves++;
        filters.set(id, structuredClone(filter));
        return structuredClone(filter);
      },
    },
    audit: {record: async () => undefined},
  } as unknown as GraphQLContext;
  const remove = (relationKey: string, bankAccountIds = [10], caseFileId = 1,
    c = ctx) => resolvers.Mutation.removeCaseRelation(null,
      {caseFileId, relationKey, bankAccountIds}, c);
  await assert.rejects(remove("name:person", [10], 1, {...ctx, user: null}), /Нэвтрэх/);
  await assert.rejects(remove("name:person", [10], 1, {...ctx,
    auth: {accessibleCaseIds: async () => new Set([2])}} as unknown as GraphQLContext), /эрхгүй/);
  await assert.rejects(remove("name:person", [30]), /дансыг/);
  await assert.rejects(remove("name:person", []), /дансыг/);
  await assert.rejects(remove("name:missing"), /олдсонгүй/);
  assert.equal(saves, 0);
  failSave = true;
  await assert.rejects(remove("name:person"), /save failed/);
  assert.deepEqual(filters.get(1), initial());
  failSave = false;
  await remove("name:person");
  assert.deepEqual(filters.get(1), {...initial(), ignoredTxns: [99, 1, 2]});
  assert.deepEqual(filters.get(2), initial(), "Another case sharing account 10 is untouched");
  assert.deepEqual((await resolvers.Query.transactions(null, {}, ctx)).map(t => t.id),
    [3, 5, 6, 7, 8, 9, 11]);
  assert.equal((await resolvers.Query.transactions(null, {includeRemoved: true}, ctx)).length, 9);
  active = 2;
  assert((await resolvers.Query.transactions(null, {}, ctx)).some(t => t.id === 1));
  await assert.rejects(remove("name:person"), /солигдсон/);
  active = 1;
  await remove("nat:AA123");
  await remove("name:name only");
  await remove("name:verified owner");
  await remove("acct:Z");
  await remove("name:person", [50]);
  assert.deepEqual(filters.get(1)?.ignoredTxns, [99, 1, 2, 6, 7, 8, 9, 11]);
  assert(!filters.get(1)?.ignoredTxns.includes(12), "Tagged row must not expand to its whole statement");
  await remove("name:person", [10, 20]);
  assert(filters.get(1)?.ignoredTxns.includes(3));
  const before = saves;
  changeDuringRead = true;
  await assert.rejects(remove("name:other person"), /солигдсон/);
  assert.equal(saves, before);
  changeDuringRead = false; active = 1;
  // Existing restore operation brings the removed rows back without source deletion.
  await resolvers.Mutation.saveCaseNoiseFilter(null, {input: initial()}, ctx);
  assert((await resolvers.Query.transactions(null, {}, ctx)).some(t => t.id === 1));
  assert.equal(transactions.length, 11);
  console.log("PASS: relation removal uses list identity, exact case/account/row scope, keeps other cases and filters, rejects stale/auth/failing saves, and restores source rows");
}
main().catch(e => {console.error(e); process.exitCode = 1;});
