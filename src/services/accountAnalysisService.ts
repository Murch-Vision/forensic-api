/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : accountAnalysisService.ts
 * Created at  : 2026-08-13
 * Author      : jeefo
 * Purpose     : Дансны дүн шинжилгээ — per statement account: the headline
 *               figures, when the account is active (hour / weekday / month),
 *               and money moving directly between two accounts we hold.
 * Description : This is what the "Мөрч дүгнэлт" report is built from, so every
 *               number here has to be one the analyst can also see on screen:
 *               the caller passes in already case-scoped, noise-filtered rows
 *               (see resolvers.scopedTransactions) and these functions only
 *               bucket them.
 *
 *               Activity is grouped three ways because that is what the report
 *               asks for: hour of day (24), day of week (7) and calendar month.
 *               Hour and weekday answer "when does this account move money";
 *               month answers "over which period", so it stays a real calendar
 *               series rather than 12 fixed buckets.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {BankAccount, BankTransaction} from "../models/types";
import {buildRelations} from "./relationService";
import type {RelationRow} from "./relationService";

// Шөнийн гүйлгээ and "их дүн" are NOT invented here: the AML config already
// carries the department's own numbers (nightHoursStart/End, highValueTxnFloor),
// and inventing a second definition is how two screens end up disagreeing.
export interface AnalysisConfig {
  nightFrom      : number;
  nightTo        : number;
  highValueFloor : number;
}

// The client's own spreadsheet labelled a counterparty "Их давтамж" from ten
// transactions upward.
const FREQUENT_TXN_MIN = 10;

export function isNightHour(hour: number, cfg: AnalysisConfig): boolean {
  // A window that wraps midnight (22→5) and one that does not (0→6) both work.
  return cfg.nightFrom <= cfg.nightTo
    ? hour >= cfg.nightFrom && hour <= cfg.nightTo
    : hour >= cfg.nightFrom || hour <= cfg.nightTo;
}

// Үнэлгээ — the rating column from the client's frequency sheet.
function rate(r: RelationRow, cfg: AnalysisConfig): string {
  const freq = r.txnCount >= FREQUENT_TXN_MIN;
  const big = (r.creditTotal + r.debitTotal) >= cfg.highValueFloor;
  if (freq && big) return "Их давтамж, их дүн";
  if (freq) return "Их давтамж";
  if (big) return "Их дүн";
  return "Ердийн";
}

// Buckets are read straight out of the stored ISO text rather than through
// new Date().getHours(), which would shift every row by the server's timezone
// and silently re-bucket a 14:00 transaction as 22:00 on a UTC+8 machine. The
// hour on the statement is the hour we report.
function hourOf(ts: string): number | null {
  const h = Number(ts.slice(11, 13));
  return Number.isFinite(h) && ts.length >= 13 ? h : null;
}

function monthOf(ts: string): string | null {
  return /^\d{4}-\d{2}/.test(ts) ? ts.slice(0, 7) : null;
}

// 0 = Sunday, from the date part only — also timezone-proof.
function weekdayOf(ts: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ts)) return null;
  const d = new Date(`${ts.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

// A statement that carries no clock — every row exactly midnight — cannot
// support an hourly chart or a night-transaction count. Reporting "100% of
// transactions happened at night" from date-only rows would be a false figure
// in a document that goes to court, so callers check this first.
function carriesTimeOfDay(txns: BankTransaction[]): boolean {
  return txns.some((t) => t.timestamp.slice(11, 19) !== "00:00:00"
    && t.timestamp.length >= 19);
}

// getDay() order: 0 = Sunday. Matches DAY_LABELS in the frontend.
const WEEKDAY_LABELS = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан",
  "Бямба"];

export interface ActivityBucket {
  key         : string;
  label       : string;
  count       : number;
  creditCount : number;
  debitCount  : number;
  creditTotal : number;
  debitTotal  : number;
}

export interface AccountAnalysis {
  accountId        : number;
  label            : string;
  accountNumber    : string;
  ownerName        : string | null;
  txnCount         : number;
  counterpartyCount: number;
  creditCount      : number;
  debitCount       : number;
  creditTotal      : number;
  debitTotal       : number;
  netTotal         : number;
  // False when the imported statement has no clock (see carriesTimeOfDay):
  // byHour, nightCount and peakHour are then all zero/null and must not be
  // shown as findings.
  hasTimeOfDay     : boolean;
  nightCount       : number;
  nightTotal       : number;
  firstTxn         : string | null;
  lastTxn          : string | null;
  byHour           : ActivityBucket[];
  byWeekday        : ActivityBucket[];
  byMonth          : ActivityBucket[];
  // Busiest bucket in each grouping, by transaction count. These fill the
  // report's "Тайлбар" sentence with measured values instead of prose.
  peakHour         : string | null;
  peakWeekday      : string | null;
  peakMonth        : string | null;
  topCounterparties: RatedRelation[];
}

export interface RatedRelation extends RelationRow {
  rating: string;
}

export interface DirectTransfer {
  fromAccountId : number;
  toAccountId   : number;
  fromLabel     : string;
  toLabel       : string;
  txnCount      : number;
  total         : number;
  byMonth       : ActivityBucket[];
}

function emptyBucket(key: string, label: string): ActivityBucket {
  return {key, label, count: 0, creditCount: 0, debitCount: 0,
    creditTotal: 0, debitTotal: 0};
}

function add(b: ActivityBucket, t: BankTransaction): void {
  b.count++;
  if (t.type === "credit") {b.creditCount++; b.creditTotal += t.amount;}
  else {b.debitCount++; b.debitTotal += t.amount;}
}

function peak(buckets: ActivityBucket[]): string | null {
  let best: ActivityBucket | null = null;
  for (const b of buckets) {
    if (b.count > 0 && (!best || b.count > best.count)) best = b;
  }
  return best ? best.label : null;
}

export function accountLabel(a: BankAccount): string {
  return [a.bankName, a.accountNumber, a.accountHolderName]
    .filter(Boolean).join(" · ");
}

// One account's full analysis. `txns` must already be that account's rows.
export function analyseAccount(
  account: BankAccount,
  txns: BankTransaction[],
  subjectNationalIds: string[],
  cfg: AnalysisConfig,
  topLimit = 30
): AccountAnalysis {
  const byHour = Array.from({length: 24}, (_v, h) =>
    emptyBucket(String(h), `${String(h).padStart(2, "0")}:00`));
  const byWeekday = WEEKDAY_LABELS.map((label, i) =>
    emptyBucket(String(i), label));
  const monthMap = new Map<string, ActivityBucket>();

  let creditCount = 0, debitCount = 0;
  let creditTotal = 0, debitTotal = 0;
  let nightCount = 0, nightTotal = 0;
  let firstTxn: string | null = null, lastTxn: string | null = null;
  const hasTime = carriesTimeOfDay(txns);

  for (const t of txns) {
    if (t.type === "credit") {creditCount++; creditTotal += t.amount;}
    else {debitCount++; debitTotal += t.amount;}

    // A row with an unreadable date still counts toward the totals, but it
    // cannot be placed on a clock or a calendar.
    const hour = hasTime ? hourOf(t.timestamp) : null;
    if (hour !== null && hour >= 0 && hour < 24) {
      add(byHour[hour], t);
      if (isNightHour(hour, cfg)) {nightCount++; nightTotal += t.amount;}
    }
    const wd = weekdayOf(t.timestamp);
    if (wd !== null) add(byWeekday[wd], t);
    const mk = monthOf(t.timestamp);
    if (mk) {
      let mb = monthMap.get(mk);
      if (!mb) {mb = emptyBucket(mk, mk); monthMap.set(mk, mb);}
      add(mb, t);
    }
    if (!firstTxn || t.timestamp < firstTxn) firstTxn = t.timestamp;
    if (!lastTxn || t.timestamp > lastTxn) lastTxn = t.timestamp;
  }

  const byMonth = [...monthMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key));

  // Counterparties for THIS account only — same aggregation the dashboard uses,
  // so a name cannot be counted differently in two places.
  const rel = buildRelations(txns, [account], subjectNationalIds);

  return {
    accountId: account.id,
    label: accountLabel(account),
    accountNumber: account.accountNumber,
    ownerName: account.accountHolderName ?? null,
    txnCount: txns.length,
    counterpartyCount: rel.totalRelations,
    creditCount, debitCount, creditTotal, debitTotal,
    netTotal: creditTotal - debitTotal,
    hasTimeOfDay: hasTime,
    nightCount, nightTotal,
    firstTxn, lastTxn,
    byHour, byWeekday, byMonth,
    peakHour: hasTime ? peak(byHour) : null,
    peakWeekday: peak(byWeekday),
    peakMonth: peak(byMonth),
    topCounterparties: rel.relations.slice(0, topLimit)
      .map((r) => ({...r, rating: rate(r, cfg)})),
  };
}

export function analyseAccounts(
  accounts: BankAccount[],
  txns: BankTransaction[],
  subjectNationalIds: string[],
  cfg: AnalysisConfig,
  topLimit = 30
): AccountAnalysis[] {
  const byAccount = new Map<number, BankTransaction[]>();
  for (const t of txns) {
    const list = byAccount.get(t.bankAccountId);
    if (list) list.push(t);
    else byAccount.set(t.bankAccountId, [t]);
  }
  return accounts
    // Only accounts a statement was actually imported for — the case scope also
    // carries account records belonging to a tagged person that hold no rows.
    .filter((a) => (byAccount.get(a.id)?.length ?? 0) > 0)
    .map((a) => analyseAccount(a, byAccount.get(a.id) ?? [],
      subjectNationalIds, cfg, topLimit))
    .sort((a, b) => b.txnCount - a.txnCount);
}

// Money moving between two accounts we hold statements for — "хоорондоо
// харилцсан шууд гүйлгээ". A row counts when its counterparty account number is
// another imported account, so the pair is evidenced on the statement itself
// rather than inferred from names.
export function directTransfers(
  accounts: BankAccount[],
  txns: BankTransaction[]
): DirectTransfer[] {
  const byNumber = new Map<string, BankAccount>();
  for (const a of accounts) {
    const n = a.accountNumber.trim();
    if (n) byNumber.set(n, a);
  }
  const pairs = new Map<string, DirectTransfer>();

  for (const t of txns) {
    const own = accounts.find((a) => a.id === t.bankAccountId);
    if (!own) continue;
    const other = byNumber.get((t.counterpartyAccount ?? "").trim());
    if (!other || other.id === own.id) continue;

    // Direction is read from the row's own type: a credit means money arrived
    // here FROM the other account.
    const from = t.type === "credit" ? other : own;
    const to = t.type === "credit" ? own : other;
    const key = `${from.id}->${to.id}`;
    let p = pairs.get(key);
    if (!p) {
      p = {
        fromAccountId: from.id, toAccountId: to.id,
        fromLabel: accountLabel(from), toLabel: accountLabel(to),
        txnCount: 0, total: 0, byMonth: [],
      };
      pairs.set(key, p);
    }
    p.txnCount++;
    p.total += t.amount;
    const mk = t.timestamp.slice(0, 7);
    let mb = p.byMonth.find((b) => b.key === mk);
    if (!mb) {mb = emptyBucket(mk, mk); p.byMonth.push(mb);}
    add(mb, t);
  }

  for (const p of pairs.values()) {
    p.byMonth.sort((a, b) => a.key.localeCompare(b.key));
  }
  return [...pairs.values()].sort((a, b) => b.total - a.total);
}
