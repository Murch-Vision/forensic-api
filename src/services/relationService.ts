/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : relationService.ts
 * Created at  : 2026-08-13
 * Author      : jeefo
 * Purpose     : Харьцаа — who the case's imported statement accounts actually
 *               transacted with, aggregated per counterparty.
 * Description : A statement lists a counterparty per row; the analyst wants the
 *               other direction — one row per counterparty with how often and
 *               how much moved, which statement accounts they touched, and
 *               whether they are "дундын" (shared: seen on two or more of our
 *               accounts, which is what makes a counterparty interesting).
 *
 *               Pure functions over already-scoped rows: case scoping and the
 *               noise filter stay in the resolver, so these totals match the
 *               transaction list on screen instead of quietly counting rows the
 *               analyst removed.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {BankTransaction} from "../models/types";

export interface RelationRow {
  key           : string;
  name          : string;
  account       : string | null;
  nationalId    : string | null;
  txnCount      : number;
  creditCount   : number;
  debitCount    : number;
  // Seen from OUR account: credit = money in (орлого), debit = out (зарлага).
  creditTotal   : number;
  debitTotal    : number;
  netTotal      : number;
  accountIds    : number[];
  mutual        : boolean;
  // The counterparty's registration number matches a subject on the case list.
  subjectMatch  : boolean;
}

// One statement account's own totals — the same figures the summary carries
// for the whole case, so the dashboard can show ONE account without
// re-deriving (and mis-deriving) them on the client.
export interface AccountRelations {
  accountId     : number;
  // label = the two parts joined; ownerName/accountNumber are kept apart so
  // the UI can print the name on one line and the number under it — a header
  // that runs "NAME · 00000005169198832" on one line is a wall of digits.
  label         : string;
  ownerName     : string | null;
  accountNumber : string;
  txnCount      : number;
  relationCount : number;
  mutualCount   : number;
  creditCount   : number;
  debitCount    : number;
  creditTotal   : number;
  debitTotal    : number;
  netTotal      : number;
  relations     : RelationRow[];
}

export interface RelationSummary {
  statementAccounts : number;
  totalRelations    : number;
  mutualRelations   : number;
  txnCount          : number;
  creditCount       : number;
  debitCount        : number;
  creditTotal       : number;
  debitTotal        : number;
  netTotal          : number;
  // Transactions whose statement row names no counterparty at all. Counted in
  // the totals above, but they can never appear in the list below.
  unnamedTxnCount   : number;
  relations         : RelationRow[];
  byAccount         : AccountRelations[];
}

// Statements arrive with "-" (and friends) written into every column the bank
// had nothing for — counterparty name, account AND registration number. Taken
// literally those become one giant fake counterparty called "-" holding half
// the case, and a registration number of "-" matches every subject whose own
// number is also "-". So a placeholder is emptiness, not a value.
const PLACEHOLDER = /^(?:[-–—_.\s]*|n\/?a|null|undefined|тодорхойгүй)$/i;

function clean(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v || PLACEHOLDER.test(v)) return null;
  return v;
}

// Loose name match only — a registration number is compared exactly.
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function normId(s: string | null | undefined): string | null {
  const v = clean(s);
  return v ? v.toUpperCase() : null;
}

// Identity of a counterparty is the PERSON, not the account (his call,
// 2026-08-16: "харьцсан хүний олон данстай байвал нийлүүлээд нэг болгож орж
// ирнэ"). Keying by account first split one person across as many rows as he
// held accounts — АМАРСАНАА ПҮРЭВДОРЖ appeared twice in the дундын list, once
// with a number and once without, and the counts read as two people.
//
// So: the printed name IS the identity; a registration number identifies the
// unnamed; the account number is an identity only when the statement printed
// neither. ⚠️ Two different people who share a name therefore merge — the
// statement gives nothing to tell them apart, and the analyst can see the
// split in the transaction list.
function relationKey(t: BankTransaction): string | null {
  const name = clean(t.counterpartyName);
  if (name) return `name:${normName(name)}`;
  const nat = normId(t.counterpartyNationalId);
  if (nat) return `nat:${nat}`;
  const acct = clean(t.counterpartyAccount);
  if (acct) return `acct:${acct}`;
  return null;
}

interface PerAcct {
  txnCount    : number;
  creditCount : number;
  debitCount  : number;
  credit      : number;
  debit       : number;
}

interface Acc {
  row   : RelationRow;
  perAcct : Map<number, PerAcct>;
}

function blank(key: string, t: BankTransaction): Acc {
  return {
    row: {
      key,
      name: clean(t.counterpartyName) ?? clean(t.counterpartyAccount) ?? "—",
      account: clean(t.counterpartyAccount),
      nationalId: normId(t.counterpartyNationalId),
      txnCount: 0, creditCount: 0, debitCount: 0,
      creditTotal: 0, debitTotal: 0, netTotal: 0,
      accountIds: [], mutual: false, subjectMatch: false,
    },
    perAcct: new Map(),
  };
}

export function buildRelations(
  transactions : BankTransaction[],
  accounts     : {id: number; bankName: string | null; accountNumber: string;
    accountHolderName: string | null;}[],
  subjectNationalIds : string[]
): RelationSummary {
  const subjects = new Set(
    subjectNationalIds.map(normId).filter((v): v is string => !!v));
  const byKey = new Map<string, Acc>();

  let txnCount = 0, creditCount = 0, debitCount = 0;
  let creditTotal = 0, debitTotal = 0, unnamedTxnCount = 0;

  for (const t of transactions) {
    const isCredit = t.type === "credit";
    txnCount++;
    if (isCredit) {creditCount++; creditTotal += t.amount;}
    else {debitCount++; debitTotal += t.amount;}

    const key = relationKey(t);
    // A row with no counterparty at all still counts toward the case totals —
    // it just isn't a relation anybody can be named in.
    if (!key) {unnamedTxnCount++; continue;}

    let a = byKey.get(key);
    if (!a) {a = blank(key, t); byKey.set(key, a);}
    const r = a.row;
    r.txnCount++;
    if (isCredit) {r.creditCount++; r.creditTotal += t.amount;}
    else {r.debitCount++; r.debitTotal += t.amount;}
    // Fill in details a later row may carry when the first one didn't.
    const laterName = clean(t.counterpartyName);
    if (r.name === "—" && laterName) r.name = laterName;
    if (!r.nationalId) r.nationalId = normId(t.counterpartyNationalId);
    // Now that one person's accounts merge, the first row seen may be the one
    // without a number — keep the first real one so the drill-through works.
    if (!r.account) r.account = clean(t.counterpartyAccount);

    const per = a.perAcct.get(t.bankAccountId)
      ?? {txnCount: 0, creditCount: 0, debitCount: 0, credit: 0, debit: 0};
    per.txnCount++;
    if (isCredit) {per.creditCount++; per.credit += t.amount;}
    else {per.debitCount++; per.debit += t.amount;}
    a.perAcct.set(t.bankAccountId, per);
  }

  const relations: RelationRow[] = [];
  for (const a of byKey.values()) {
    const r = a.row;
    r.accountIds = [...a.perAcct.keys()].sort((x, y) => x - y);
    r.mutual = r.accountIds.length > 1;
    r.netTotal = r.creditTotal - r.debitTotal;
    r.subjectMatch = !!r.nationalId && subjects.has(r.nationalId);
    relations.push(r);
  }
  // Frequency first — the client asked for the most-active counterparty on top.
  relations.sort((x, y) => y.txnCount - x.txnCount
    || (y.creditTotal + y.debitTotal) - (x.creditTotal + x.debitTotal)
    || x.name.localeCompare(y.name));

  // WHOSE account first, the number after: the analyst knows these accounts by
  // the person, and a heading that opens with seventeen digits says nothing
  // until it is read to the end.
  const acctOwner = (id: number): string | null => {
    const a = accounts.find((x) => x.id === id);
    return a ? clean(a.accountHolderName) : null;
  };
  const acctLabel = (id: number): string => {
    const a = accounts.find((x) => x.id === id);
    if (!a) return `Данс #${id}`;
    return [acctOwner(id), a.accountNumber, clean(a.bankName)]
      .filter(Boolean).join(" · ");
  };

  // Slide 4: every statement account with its own counterparty list.
  const byAccount: AccountRelations[] = accounts.map((acct) => {
    const rows: RelationRow[] = [];
    let count = 0, creditCount = 0, debitCount = 0;
    let credit = 0, debit = 0, mutualCount = 0;
    for (const a of byKey.values()) {
      const per = a.perAcct.get(acct.id);
      if (!per) continue;
      count += per.txnCount;
      creditCount += per.creditCount;
      debitCount += per.debitCount;
      credit += per.credit;
      debit += per.debit;
      if (a.row.mutual) mutualCount++;
      rows.push({
        ...a.row,
        txnCount: per.txnCount,
        creditCount: per.creditCount,
        debitCount: per.debitCount,
        creditTotal: per.credit,
        debitTotal: per.debit,
        netTotal: per.credit - per.debit,
        // Per-account rows keep the counterparty's OVERALL shared/matched
        // flags — that is what the analyst is scanning the column for.
      });
    }
    rows.sort((x, y) => y.txnCount - x.txnCount
      || x.name.localeCompare(y.name));
    return {
      accountId: acct.id, label: acctLabel(acct.id),
      ownerName: acctOwner(acct.id), accountNumber: acct.accountNumber,
      txnCount: count, relationCount: rows.length, mutualCount,
      creditCount, debitCount,
      creditTotal: credit, debitTotal: debit, netTotal: credit - debit,
      relations: rows,
    };
  }).filter((g) => g.relationCount > 0);

  // ONE PERSON'S ACCOUNTS STAND NEXT TO EACH OTHER. Sorting the columns by
  // transaction count alone scattered a man's three accounts across the strip
  // with other people's in between, so they could not be read together. Owners
  // are ordered by their own busiest account; within an owner, busiest first.
  const ownerBest = new Map<string, number>();
  for (const g of byAccount) {
    const o = acctOwner(g.accountId) ?? `#${g.accountId}`;
    ownerBest.set(o, Math.max(ownerBest.get(o) ?? 0, g.txnCount));
  }
  byAccount.sort((x, y) => {
    const ox = acctOwner(x.accountId) ?? `#${x.accountId}`;
    const oy = acctOwner(y.accountId) ?? `#${y.accountId}`;
    if (ox !== oy) {
      return (ownerBest.get(oy) ?? 0) - (ownerBest.get(ox) ?? 0)
        || ox.localeCompare(oy);
    }
    return y.txnCount - x.txnCount;
  });

  return {
    // "Хуулсан данс" means a statement was actually imported for it. The case
    // scope also carries account records that merely belong to a tagged person
    // and hold no rows — counting those would inflate the figure ~100×.
    statementAccounts: byAccount.length,
    totalRelations: relations.length,
    mutualRelations: relations.filter((r) => r.mutual).length,
    txnCount, creditCount, debitCount,
    creditTotal, debitTotal,
    netTotal: creditTotal - debitTotal,
    unnamedTxnCount,
    relations, byAccount,
  };
}
