import type {BankAccount, BankTransaction, CaseFile, Suspect, SuspectLink} from "../models/types";
import {buildCaseScope, type CaseScopeSnapshot} from "./caseScope";
import {accountNameLookup} from "./accountNames";
import {buildRelations, relationKey} from "./relationService";
import {ignoredTransactionIds} from "./transactionNoise";
import type {NoiseFilter} from "./noiseFilterService";

// A read-only union, not a case merge. Per-row provenance contains only cases
// where that row is visible after that case's own removal/noise rules.
export function buildMultiCaseAnalysis(input: Omit<CaseScopeSnapshot, "suspects" | "transactions"> & {
  cases: CaseFile[]; suspects: Suspect[]; accounts: BankAccount[];
  transactions: BankTransaction[]; links: SuspectLink[];
  filters: Map<number, NoiseFilter>;
}) {
  const txnCases = new Map<number, Set<number>>();
  const accountCases = new Map<number, Set<number>>();
  const statementCases = new Map<number, Set<number>>();
  const personCases = new Map<number, Set<number>>();
  const add = (map: Map<number, Set<number>>, id: number, caseId: number) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id)!.add(caseId);
  };
  const accountsById = new Map(input.accounts.map(a => [a.id, a]));
  for (const cf of input.cases) {
    const scope = buildCaseScope([cf], input);
    const ignored = ignoredTransactionIds(input.transactions, input.filters.get(cf.id)!);
    for (const id of scope.accountIds) {
      add(accountCases, id, cf.id);
      const owner = accountsById.get(id)?.suspectId;
      if (owner != null) add(personCases, owner, cf.id);
    }
    for (const id of scope.statementAccountIds) add(statementCases, id, cf.id);
    for (const id of scope.suspectIds) add(personCases, id, cf.id);
    for (const t of input.transactions) {
      if (!ignored.has(t.id) && (scope.statementAccountIds.has(t.bankAccountId)
        || scope.txnIds.has(t.id))) add(txnCases, t.id, cf.id);
    }
  }
  const caseIds = (ids: Set<number> | undefined) => [...(ids ?? [])].sort((a, b) => a - b);
  const accounts = input.accounts.filter(a => accountCases.has(a.id));
  const owners = accountNameLookup(accounts);
  const txns = input.transactions.filter(t => txnCases.has(t.id)).map(t => ({...t,
    counterpartyName: owners(t.counterpartyAccount) ?? t.counterpartyName}));
  const subjects = input.suspects.filter(s => personCases.has(s.id));
  const summary = buildRelations(txns, accounts, subjects.flatMap(s => s.nationalId ? [s.nationalId] : []));
  const relationCases = new Map<string, Set<number>>();
  for (const t of txns) {
    const key = relationKey(t, owners);
    if (!key) continue;
    if (!relationCases.has(key)) relationCases.set(key, new Set());
    for (const id of txnCases.get(t.id)!) relationCases.get(key)!.add(id);
  }
  // A generated relationship contributes only its selected case's visible
  // transactions. Combine duplicate pairs across cases without double totals.
  const txnById = new Map(txns.map(t => [t.id, t]));
  const selected = new Set(input.cases.map(c => c.id));
  const people = new Set(subjects.map(s => s.id));
  const linkGroups = new Map<string, {row: SuspectLink; ids: Set<number>}>();
  for (const l of input.links) {
    if (l.linkType !== "FINANCIAL_TRANSFER" || l.caseFileId == null
      || !selected.has(l.caseFileId) || !people.has(l.sourceSuspectId)
      || !people.has(l.targetSuspectId)) continue;
    let backing: number[];
    try {const raw = JSON.parse(l.contributingTxnIds ?? "[]");
      backing = Array.isArray(raw) ? raw : [];} catch {continue;}
    const ids = backing.filter(id => txnCases.get(id)?.has(l.caseFileId!));
    if (!ids.length) continue;
    const key = [Math.min(l.sourceSuspectId, l.targetSuspectId),
      Math.max(l.sourceSuspectId, l.targetSuspectId)].join(":");
    if (!linkGroups.has(key)) linkGroups.set(key, {row: l, ids: new Set()});
    for (const id of ids) linkGroups.get(key)!.ids.add(id);
  }
  return {
    cases: input.cases,
    accounts: accounts.map(account => ({account, caseFileIds: caseIds(accountCases.get(account.id)),
      statementCaseFileIds: caseIds(statementCases.get(account.id))})),
    people: subjects.map(person => ({person, caseFileIds: caseIds(personCases.get(person.id))})),
    transactions: txns.map(transaction => ({transaction, caseFileIds: caseIds(txnCases.get(transaction.id)),
      relationKey: relationKey(transaction, owners)})),
    relations: summary.relations.map(relation => ({relation,
      caseFileIds: caseIds(relationCases.get(relation.key))})),
    links: [...linkGroups.values()].map(({row, ids}) => ({...row,
      contributingTxnIds: JSON.stringify([...ids]), strength: Math.min(10, ids.size),
      totalFinancialValue: [...ids].reduce((sum, id) => sum + Math.abs(txnById.get(id)!.amount), 0)})),
  };
}
