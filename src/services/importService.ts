/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : importService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-30
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import * as XLSX from "xlsx";
import type {Knex} from "knex";
import {
  cell,
  detectHeaderRow,
  parseDelimited,
  type NormalizedTable,
} from "./import/tabularReader";
import {detectProfile, type DetectionResult} from "./import/profiles";

// Ported from Services/ImportService.cs (the TabularReader + ProfileDetector
// ingest pipeline). Files arrive as delimited text (CSV/TSV/…); the matching
// profile is auto-detected and rows are mapped, parsed and inserted.

export type ImportKind = "AUTO" | "BANK" | "CDR" | "ACCESS_LOG";

// field → column-header. The detected mapping, optionally overridden per-field
// by the analyst from the import screen.
export type ColumnMapping = Record<string, string>;

export interface ImportPreview {
  headers: string[];
  sampleRows: (string | null)[][];
  totalRows: number;
  detectedProfile: string | null;
  domain: string | null;
  confidence: string;
  mapping: {field: string; column: string}[];
}

// Everything the import mutation carries. Passed as one object so the call
// stays within the 4-argument limit.
export interface ImportOptions {
  content           : string;
  kind              : ImportKind;
  filename?         : string | null;
  sheetName?        : string | null;
  bankAccountId?    : number | null;
  subjectSuspectId? : number | null;
  mapping?          : ColumnMapping | null;
}

export interface ImportSummary {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: string[];
  messages: string[];
  detectedProfile: string | null;
  domain: string | null;
  // Internal (not in the GraphQL type): what the import touched, so the
  // resolver can link it into the active case as evidence entries.
  touchedAccountIds?: number[];
  touchedSuspectIds?: number[];
  newCallRecordIds?: number[];
}

export class ImportService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  // Build a NormalizedTable from either delimited text or a base64-encoded
  // workbook. Mirrors TabularReader.Read: CSV/TSV via the delimited parser,
  // .xlsx / .xls (legacy BIFF) via SheetJS — both .xls and .xlsx supported.
  buildTable(
    content: string,
    filename?: string | null,
    sheetName?: string | null
  ): NormalizedTable {
    if (isWorkbook(filename)) return parseWorkbook(content, sheetName);
    return parseDelimited(content);
  }

  excelSheets(content: string, filename?: string | null): string[] {
    if (!isWorkbook(filename)) return [];
    const wb = XLSX.read(Buffer.from(content, "base64"), {type: "buffer"});
    return wb.SheetNames;
  }

  preview(
    content: string,
    filename?: string | null,
    sheetName?: string | null
  ): ImportPreview {
    const table = this.buildTable(content, filename, sheetName);
    const det = detectProfile(table);
    return {
      headers: table.headers,
      sampleRows: table.rows.slice(0, 10),
      totalRows: table.rows.length,
      detectedProfile: det.profile?.displayName ?? null,
      domain: det.domain,
      confidence: det.confidence,
      mapping: Object.entries(det.proposedMapping)
        .map(([field, column]) => ({field, column})),
    };
  }

  async importData(opts: ImportOptions): Promise<ImportSummary> {
    const table = this.buildTable(opts.content, opts.filename, opts.sheetName);
    const det = detectProfile(table);
    const domain = opts.kind === "AUTO" ? det.domain : opts.kind;
    if (!domain) {
      return empty("Загвар таних боломжгүй — гарын авлагын зураглал шаардлагатай.");
    }
    // No subject picker: rows attribute themselves (bank rows via their
    // account column, calls via known phone numbers); a caller-provided
    // subject remains an optional fallback for API use.
    const map = mergeMapping(det.proposedMapping, opts.mapping);
    if (domain === "BANK") {
      return this.importBank(table, det, map, opts);
    }
    if (domain === "CDR") {
      return this.importCdr(table, det, map, opts.subjectSuspectId ?? null);
    }
    return this.importAccessLog(
      table, det, map, opts.subjectSuspectId ?? null);
  }

  // Find (or create, unowned) the bank account a statement row belongs to.
  private async findOrCreateAccount(
    accountNumber: string,
    cache: Map<string, number>
  ): Promise<number> {
    const key = accountNumber.trim();
    const hit = cache.get(key);
    if (hit != null) return hit;
    const existing = await this.db("bank_accounts")
      .where({accountNumber: key}).first();
    if (existing) {
      cache.set(key, Number(existing.id));
      return Number(existing.id);
    }
    const [id] = await this.db("bank_accounts").insert({
      accountNumber: key, bankName: null, branchCode: null, iban: null,
      accountType: "Current", currency: "MNT", currentBalance: 0,
      status: "ACTIVE", suspectId: null, accountHolderName: null,
      createdAt: new Date().toISOString(),
    });
    cache.set(key, Number(id));
    return Number(id);
  }

  // Fallback when a statement has no account column: an explicit account,
  // the (optional) subject's first account, or a shared unattributed bucket.
  private async resolveDefaultAccount(
    opts: ImportOptions,
    cache: Map<string, number>
  ): Promise<number> {
    if (opts.bankAccountId != null) return opts.bankAccountId;
    if (opts.subjectSuspectId != null) {
      const existing = await this.db("bank_accounts")
        .where({suspectId: opts.subjectSuspectId}).orderBy("id").first();
      if (existing) return Number(existing.id);
      const suspect = await this.db("suspects")
        .where({id: opts.subjectSuspectId}).first();
      const id = await this.findOrCreateAccount(
        `ХУУЛГА-${suspect?.suspectId ?? opts.subjectSuspectId}`, cache);
      await this.db("bank_accounts").where({id}).update({
        suspectId: opts.subjectSuspectId,
        accountHolderName: suspect?.fullName ?? null,
      });
      return id;
    }
    return this.findOrCreateAccount("ХУУЛГА-ИМПОРТ", cache);
  }

  private async importBank(
    table: NormalizedTable,
    det: DetectionResult,
    map: ColumnMapping,
    opts: ImportOptions
  ): Promise<ImportSummary> {
    // Style follows the mapped columns so a manual override works even when no
    // profile matched: credit/debit columns ⇒ split, else a single amount.
    const hasSplit = Boolean(map.credit || map.debit);
    const style = hasSplit ? "SPLIT_CREDIT_DEBIT"
      : map.amount ? "SIGNED" : det.profile?.amountStyle ?? "SIGNED";
    const res = newSummary(det);
    const rowsToInsert: Record<string, unknown>[] = [];
    const acctCache = new Map<string, number>();
    let defaultAccountId: number | null = null;
    // Reference numbers are unique per account — collect existing + in-file
    // ones so a manual reference mapping can't trip the unique index.
    const seenRefs = new Set<string>();
    if (map.reference) {
      const rows = await this.db("bank_transactions")
        .whereNotNull("referenceNumber")
        .select("bankAccountId", "referenceNumber");
      for (const r of rows) {
        seenRefs.add(`${r.bankAccountId}|${r.referenceNumber}`);
      }
    }

    for (const row of table.rows) {
      res.totalRows++;
      try {
        const get = (f: string) =>
          map[f] ? cell(table, row, map[f]) : null;
        const acctRaw = get("account");
        const bankAccountId = acctRaw
          ? await this.findOrCreateAccount(acctRaw, acctCache)
          : (defaultAccountId ??=
              await this.resolveDefaultAccount(opts, acctCache));
        const dateStr = get("date");
        if (!dateStr) {
          res.skippedRows++;
          continue;
        }
        const date = tryParseDateOrSerial(dateStr);
        if (!date) {
          res.skippedRows++;
          continue;
        }
        const desc = get("description");
        if (desc && desc.includes("Эхний үлдэгдэл")) {
          res.skippedRows++;
          continue;
        }
        const ref = get("reference");
        if (ref) {
          const refKey = `${bankAccountId}|${ref}`;
          if (seenRefs.has(refKey)) {
            res.skippedRows++;
            continue;
          }
          seenRefs.add(refKey);
        }
        const txn: Record<string, unknown> = {
          bankAccountId, timestamp: date, description: desc,
          flagStatus: "NORMAL", counterpartyAccount: get("counterpartyAccount"),
          counterpartyName: get("counterpartyName"), runningBalance: 0,
          referenceNumber: ref || null, category: get("category"),
          channel: get("channel"),
        };
        if (style === "SPLIT_CREDIT_DEBIT") {
          const cr = parseFloat(cleanAmount(get("credit")));
          const dr = parseFloat(cleanAmount(get("debit")));
          if (cr > 0) {
            txn.amount = cr;
            txn.type = "credit";
          } else if (dr !== 0) {
            txn.amount = Math.abs(dr);
            txn.type = "debit";
          } else {
            res.skippedRows++;
            continue;
          }
        } else {
          const amt = parseFloat(cleanAmount(get("amount")));
          if (Number.isNaN(amt)) {
            res.skippedRows++;
            continue;
          }
          txn.amount = Math.abs(amt);
          txn.type = amt >= 0 ? "credit" : "debit";
        }
        const balRaw = get("balance");
        if (balRaw != null) {
          const bal = parseFloat(cleanAmount(balRaw));
          if (!Number.isNaN(bal)) txn.runningBalance = bal;
        } else {
          // Some statements only carry the balance BEFORE the transaction.
          const beforeRaw = get("balanceBefore");
          if (beforeRaw != null) {
            const before = parseFloat(cleanAmount(beforeRaw));
            if (!Number.isNaN(before)) {
              txn.runningBalance = txn.type === "credit"
                ? before + (txn.amount as number)
                : before - (txn.amount as number);
            }
          }
        }
        rowsToInsert.push(txn);
        res.importedRows++;
      } catch {
        res.skippedRows++;
      }
    }
    if (rowsToInsert.length > 0) {
      await this.db.batchInsert("bank_transactions", rowsToInsert, 200);
    }
    const accountIds = new Set<number>(acctCache.values());
    if (defaultAccountId != null) accountIds.add(defaultAccountId);
    res.touchedAccountIds = [...accountIds];
    if (accountIds.size > 0) {
      res.touchedSuspectIds = (await this.db("bank_accounts")
        .whereIn("id", [...accountIds]).whereNotNull("suspectId")
        .pluck("suspectId")).map(Number);
    }
    return res;
  }

  private async importCdr(
    table: NormalizedTable,
    det: DetectionResult,
    map: ColumnMapping,
    subjectSuspectId: number | null
  ): Promise<ImportSummary> {
    const unit = det.profile?.durationUnit ?? "SECONDS";
    const res = newSummary(det);
    const rowsToInsert: Record<string, unknown>[] = [];

    // Rows attribute themselves: a caller/called number registered to a
    // suspect wins; the optional subject is only a fallback.
    const phoneRows = await this.db("phone_numbers")
      .whereNotNull("suspectId").select("number", "suspectId");
    const bySuffix = new Map<string, number>();
    for (const p of phoneRows) {
      const digits = String(p.number).replace(/\D/g, "");
      if (digits) bySuffix.set(digits.slice(-8), Number(p.suspectId));
    }
    const matchSuspect = (num: string | null): number | null => {
      if (!num) return null;
      const digits = num.replace(/\D/g, "");
      if (digits.length < 8) return null;
      return bySuffix.get(digits.slice(-8)) ?? null;
    };

    for (const row of table.rows) {
      res.totalRows++;
      try {
        const get = (f: string) =>
          map[f] ? cell(table, row, map[f]) : null;
        const caller = get("caller");
        const called = get("called");
        if (!caller || !called) {
          res.skippedRows++;
          continue;
        }
        const dt = tryParseDateOrSerial(get("datetime") ?? "");
        if (!dt) {
          res.skippedRows++;
          continue;
        }
        let durationSeconds = 0;
        const durRaw = get("duration");
        if (durRaw) {
          const d = parseFloat(durRaw.replace(/,/g, ""));
          if (!Number.isNaN(d)) {
            durationSeconds = unit === "MINUTES"
              ? Math.round(d * 60) : Math.round(d);
          }
        }
        const callerNumber = unwrapCallerId(caller);
        const calledNumber = unwrapCallerId(called);
        rowsToInsert.push({
          callerNumber, calledNumber,
          startTime: dt, durationSeconds, callType: "Voice",
          direction: get("direction") ?? "Outgoing",
          suspectId: matchSuspect(callerNumber)
            ?? matchSuspect(calledNumber) ?? subjectSuspectId,
        });
        res.importedRows++;
      } catch {
        res.skippedRows++;
      }
    }
    if (rowsToInsert.length > 0) {
      const beforeRow = await this.db("call_records").max({m: "id"}).first();
      const beforeMax = Number(beforeRow?.m ?? 0);
      await this.db.batchInsert("call_records", rowsToInsert, 200);
      res.newCallRecordIds = (await this.db("call_records")
        .where("id", ">", beforeMax).pluck("id")).map(Number);
      res.touchedSuspectIds = [...new Set(rowsToInsert
        .map((r) => r.suspectId).filter((v): v is number => v != null)
        .map(Number))];
    }
    return res;
  }

  private async importAccessLog(
    table: NormalizedTable,
    det: DetectionResult,
    map: ColumnMapping,
    subjectSuspectId: number | null
  ): Promise<ImportSummary> {
    const source = det.profile?.id === "Device-Log" ? "DeviceLog" : "WebAccessLog";
    const res = newSummary(det);

    const seen = new Set<string>();
    const rowsToInsert: Record<string, unknown>[] = [];
    const key = (ts: string, acct: string, ip: string | null) =>
      `${ts}|${acct}|${ip ?? " "}`;

    for (const row of table.rows) {
      res.totalRows++;
      try {
        const get = (f: string) =>
          map[f] ? cell(table, row, map[f]) : null;
        const acct = get("accountId");
        if (!acct) {
          res.skippedRows++;
          continue;
        }
        const ts = tryParseDateOrSerial(get("timestamp") ?? "");
        if (!ts) {
          res.skippedRows++;
          continue;
        }
        const ip = get("ip");
        const k = key(ts, acct, ip);
        if (seen.has(k)) {
          res.skippedRows++;
          continue;
        }
        seen.add(k);
        const exists = await this.db("access_log_entries")
          .where({timestamp: ts, accountOrUserId: acct, ipAddress: ip})
          .first();
        if (exists) {
          res.skippedRows++;
          continue;
        }
        const fullName = get("fullName");
        rowsToInsert.push({
          timestamp: ts, accountOrUserId: acct, fullName, ipAddress: ip,
          deviceUuid: get("uuid"), fingerprint: get("fingerprint"),
          userAgent: get("userAgent"), deviceModel: get("deviceModel"),
          deviceMake: get("deviceMake"), os: get("os"),
          osVersion: get("osVersion"), source, suspectId: subjectSuspectId,
        });
        res.importedRows++;
      } catch {
        res.skippedRows++;
      }
    }
    if (rowsToInsert.length > 0) {
      await this.db.batchInsert("access_log_entries", rowsToInsert, 200);
    }
    return res;
  }
}

// Lay the analyst's per-field overrides over the detected mapping. Empty
// override values are ignored so they don't clear a detected column.
function mergeMapping(
  base: ColumnMapping,
  override?: ColumnMapping | null
): ColumnMapping {
  const m: ColumnMapping = {...base};
  if (override) {
    for (const [field, col] of Object.entries(override)) {
      if (col && col.trim()) m[field] = col.trim();
    }
  }
  return m;
}

function newSummary(det: DetectionResult): ImportSummary {
  const messages: string[] = [];
  if (det.profile) messages.push(`Танилцсан загвар: ${det.profile.displayName}`);
  return {
    totalRows: 0, importedRows: 0, skippedRows: 0, errors: [], messages,
    detectedProfile: det.profile?.displayName ?? null, domain: det.domain,
  };
}

function empty(message: string): ImportSummary {
  return {
    totalRows: 0, importedRows: 0, skippedRows: 0, errors: [message],
    messages: [], detectedProfile: null, domain: null,
  };
}

// === helpers (ported from ImportService) ================================

// Excel serial epoch: 1899-12-30 (handles the 1900 leap-year bug for >= 60).
function excelSerialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  return new Date(ms).toISOString();
}

export function tryParseDateOrSerial(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const parsed = Date.parse(s.replace(" ", "T"));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  const serial = Number(s);
  if (!Number.isNaN(serial) && serial > 1 && serial < 100_000) {
    try {
      return excelSerialToIso(serial);
    } catch {
      return null;
    }
  }
  return null;
}

export function cleanAmount(input: string | null): string {
  if (!input) return "0";
  let s = "";
  for (const ch of input) {
    if ((ch >= "0" && ch <= "9") || ch === "," || ch === "." ||
      ch === "-" || ch === "+") {
      s += ch;
    }
  }
  if (s.length === 0) return "0";
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const dotIsDecimal = lastDot >= 0 && s.length - lastDot - 1 >= 1
    && s.length - lastDot - 1 <= 2;
  const commaIsDecimal = lastComma >= 0 && s.length - lastComma - 1 >= 1
    && s.length - lastComma - 1 <= 2;
  let decimalAt: number;
  if (dotIsDecimal && commaIsDecimal) decimalAt = Math.max(lastDot, lastComma);
  else if (dotIsDecimal) decimalAt = lastDot;
  else if (commaIsDecimal) decimalAt = lastComma;
  else return s.replace(/,/g, "").replace(/\./g, "");
  const integerPart = s.slice(0, decimalAt).replace(/,/g, "").replace(/\./g, "");
  const fractionalPart = s.slice(decimalAt + 1);
  return integerPart.length === 0
    ? `0.${fractionalPart}` : `${integerPart}.${fractionalPart}`;
}

function normalizePhone(phone: string): string {
  let out = "";
  for (const c of phone) {
    if ((c >= "0" && c <= "9") || c === "+") out += c;
  }
  return out;
}

function isWorkbook(filename?: string | null): boolean {
  if (!filename) return false;
  const f = filename.toLowerCase();
  return f.endsWith(".xlsx") || f.endsWith(".xls") || f.endsWith(".xlsm");
}

// Parse a base64 workbook (.xlsx / .xls) into the same NormalizedTable shape
// the delimited reader produces, with the same header-row auto-detection.
function parseWorkbook(base64: string, sheetName?: string | null): NormalizedTable {
  const wb = XLSX.read(Buffer.from(base64, "base64"), {type: "buffer"});
  const name = sheetName && wb.SheetNames.includes(sheetName)
    ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return {headers: [], rows: [], headerRowIndex: 0};
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1, raw: false, defval: null, blankrows: false,
  });
  const grid: (string | null)[][] = aoa.map((row) =>
    row.map((c) => {
      if (c == null) return null;
      const s = String(c).trim();
      return s === "" ? null : s;
    }));
  if (grid.length === 0) return {headers: [], rows: [], headerRowIndex: 0};
  const h = detectHeaderRow(grid);
  return {
    headers: grid[h].map((x) => (x ?? "").trim()),
    rows: grid.slice(h + 1),
    headerRowIndex: h,
  };
}

export function unwrapCallerId(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const lt = raw.indexOf("<");
  const gt = raw.indexOf(">");
  const inner = lt >= 0 && gt > lt ? raw.slice(lt + 1, gt) : raw;
  return normalizePhone(inner);
}
