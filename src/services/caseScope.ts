import type {BankTransaction, CaseFile, EvidenceEntry, Suspect} from "../models/types";

export interface CaseScope {
  suspectIds: Set<number>;
  accountIds: Set<number>;
  statementAccountIds: Set<number>;
  txnIds: Set<number>;
  callIds: Set<number>;
}

export interface CaseScopeSnapshot {
  suspects: Pick<Suspect, "id" | "caseId">[];
  entries: Pick<EvidenceEntry, "caseFileId" | "sourceType" | "sourceId">[];
  memberships: {caseFileId: number; bankAccountId: number;
    removed: boolean | number; isStatement: boolean | number}[];
  transactions: Pick<BankTransaction, "id" | "bankAccountId">[];
}

// Shared by the ordinary single-case view and the admin's explicit multi-case
// view. A person's membership never expands to every account they own.
export function buildCaseScope(
  cases: Pick<CaseFile, "id" | "caseId">[], snapshot: CaseScopeSnapshot
): CaseScope {
  const ids = new Set(cases.map(c => c.id));
  const entries = snapshot.entries.filter(e => ids.has(e.caseFileId));
  const by = (type: string) => new Set(entries
    .filter(e => e.sourceType === type).map(e => e.sourceId));
  const tagged = by("SUSPECT");
  const caseIds = new Set(cases.map(c => c.caseId));
  const suspectIds = new Set(snapshot.suspects.filter(s => tagged.has(s.id)
    || (s.caseId != null && caseIds.has(s.caseId))).map(s => s.id));
  const memberships = snapshot.memberships.filter(m => ids.has(m.caseFileId));
  const memberByKey = new Map(memberships.map(m =>
    [`${m.caseFileId}:${m.bankAccountId}`, m]));
  const accountIds = new Set<number>(), statementAccountIds = new Set<number>();
  for (const m of memberships) {
    if (m.removed) continue;
    accountIds.add(m.bankAccountId);
    if (m.isStatement) statementAccountIds.add(m.bankAccountId);
  }
  for (const e of entries.filter(e => e.sourceType === "BANK_ACCOUNT")) {
    const member = memberByKey.get(`${e.caseFileId}:${e.sourceId}`);
    if (member?.removed) continue;
    accountIds.add(e.sourceId);
    if (!member) statementAccountIds.add(e.sourceId);
  }
  const txns = new Map(snapshot.transactions.map(t => [t.id, t]));
  const txnIds = new Set<number>();
  for (const e of entries.filter(e => e.sourceType === "TRANSACTION")) {
    const t = txns.get(e.sourceId);
    if (!t || memberByKey.get(`${e.caseFileId}:${t.bankAccountId}`)?.removed) continue;
    txnIds.add(t.id); accountIds.add(t.bankAccountId);
  }
  return {suspectIds, accountIds, statementAccountIds, txnIds, callIds: by("CALL_RECORD")};
}
