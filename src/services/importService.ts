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
  EMPTY_TABLE,
  parseDelimited,
  sliceTable,
  type NormalizedTable,
  type RowRange,
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
  // The rows this preview was cut from, so the screen can SHOW the decision it
  // made and let the analyst correct it instead of guessing what it did.
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  sheetRows: number;
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
  subjectNumber?    : string | null;
  mapping?          : ColumnMapping | null;
  // Which rows to read (1-based, as the spreadsheet numbers them). Null =
  // decide from the file.
  headerRow?        : number | null;
  startRow?         : number | null;
  endRow?           : number | null;
}

export interface ImportSummary {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  // Мөрүүд аль хэдийн санд байсан тул дахин ОРООГҮЙ тоо. Нэг файлыг хоёр
  // удаа оруулахад бүх мөр энд орно — алдаа биш, давхардал.
  duplicateRows: number;
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
    sheetName?: string | null,
    range: RowRange = {}
  ): NormalizedTable {
    if (isWorkbook(filename)) return parseWorkbook(content, sheetName, range);
    return parseDelimited(content, range);
  }

  excelSheets(content: string, filename?: string | null): string[] {
    if (!isWorkbook(filename)) return [];
    const wb = XLSX.read(Buffer.from(content, "base64"), {type: "buffer"});
    return wb.SheetNames;
  }

  preview(
    content: string,
    filename?: string | null,
    sheetName?: string | null,
    range: RowRange = {}
  ): ImportPreview {
    const table = this.buildTable(content, filename, sheetName, range);
    const det = detectProfile(table);
    return {
      headers: table.headers,
      sampleRows: table.rows.slice(0, 10),
      totalRows: table.rows.length,
      headerRow: table.headerRow,
      firstDataRow: table.firstDataRow,
      lastDataRow: table.lastDataRow,
      sheetRows: table.sheetRows,
      detectedProfile: det.profile?.displayName ?? null,
      domain: det.domain,
      confidence: det.confidence,
      mapping: Object.entries(det.proposedMapping)
        .map(([field, column]) => ({field, column})),
    };
  }

  async importData(opts: ImportOptions): Promise<ImportSummary> {
    const table = this.buildTable(opts.content, opts.filename, opts.sheetName, {
      headerRow: opts.headerRow, startRow: opts.startRow, endRow: opts.endRow,
    });
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
      return this.importCdr(table, det, map, opts.subjectSuspectId ?? null,
        opts.subjectNumber ?? null);
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

  // Данс дээр САНД БАЙГАА мөрүүдийн хурууны хээ, хэдэн удаа давтагдсанаар
  // нь. Данс бүрт нэг л удаа уншина. Энэ импортод шинээр орж буй мөрийг ЭНД
  // нэмэхгүй — тийм учраас нэг файл доторх жинхэнэ давхар мөрүүд хоёул орно.
  private async loadFingerprints(
    bankAccountId: number,
    cache: Map<number, Map<string, number>>
  ): Promise<Map<string, number>> {
    const hit = cache.get(bankAccountId);
    if (hit) return hit;
    const counts = new Map<string, number>();
    const rows = await this.db("bank_transactions")
      .where({bankAccountId})
      .select("timestamp", "amount", "type", "counterpartyAccount",
        "description");
    for (const r of rows) {
      const k = txnFingerprint(r);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    cache.set(bankAccountId, counts);
    return counts;
  }

  // A Регистрийн дугаар names a real person: reuse the person that already
  // has it or create one. A statement that carries only the registry number
  // still yields a person — an anonymous placeholder until a later row (or
  // the analyst) supplies the real name. Keeps people deduplicated across
  // imports.
  private async ensurePerson(
    nationalIdRaw: string,
    personName: string | null,
    cache: Map<string, number>
  ): Promise<number | null> {
    const nationalId = nationalIdRaw.trim().toUpperCase();
    if (!nationalId) return null;
    let suspectId = cache.get(nationalId) ?? null;
    if (suspectId == null) {
      const existing = await this.db("suspects")
        .whereRaw("UPPER(nationalId) = ?", [nationalId]).first();
      if (existing) {
        suspectId = Number(existing.id);
        // Upgrade an anonymous placeholder once a row finally names them.
        const anon = String(existing.fullName ?? "");
        if (personName?.trim()
          && (anon.startsWith("Тодорхойгүй") || anon === nationalId)) {
          await this.db("suspects").where({id: suspectId}).update({
            fullName: personName.trim(),
            updatedAt: new Date().toISOString(),
          });
        }
      } else {
        const now = new Date().toISOString();
        const [id] = await this.db("suspects").insert({
          suspectId: `IMP-${nationalId}`,
          fullName: personName?.trim() || `Тодорхойгүй (${nationalId})`,
          nationalId, riskLevel: "UNKNOWN", status: "ACTIVE",
          createdAt: now, updatedAt: now,
        });
        suspectId = Number(id);
      }
      cache.set(nationalId, suspectId);
    }
    return suspectId;
  }

  // Attach a still-unowned account to its person.
  private async attachAccountOwner(
    bankAccountId: number,
    suspectId: number,
    holderName: string | null
  ): Promise<void> {
    await this.db("bank_accounts")
      .where({id: bankAccountId}).whereNull("suspectId")
      .update({suspectId, accountHolderName: holderName?.trim() || null});
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
    const ownerCache = new Map<string, number>();
    const ownerIds = new Set<number>();
    // One attach attempt per (account, person) pair — not one per row.
    const attachTried = new Set<string>();
    let defaultAccountId: number | null = null;
    // Reference numbers are unique per account — collect existing + in-file
    // ones so a manual reference mapping can't trip the unique index.
    const seenRefs = new Set<string>();
    // Гүйлгээний дугааргүй хуулга ч давхардаж болно: данс бүрийн санд БАЙГАА
    // мөрүүдийн хурууны хээг (огноо+цаг · орлого/зарлага · дүн · харьцсан
    // данс · утга) тоолж хадгална. Файлын мөр тэдгээрийн нэгтэй таарвал
    // алгасна. Тоолж байгаа учир нь: жинхэнэ хуулга дээр яг ижил хоёр мөр
    // байж БОЛНО — тэгвэл хоёул орно, харин файлыг дахин оруулахад алгасна.
    const fpCache = new Map<number, Map<string, number>>();
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
        // The statement names its owner: find-or-create the person by
        // Регистрийн дугаар (dedupes people) and attach the account.
        const natId = get("nationalId");
        if (natId) {
          const sid = await this.ensurePerson(
            natId, get("ownerName"), ownerCache);
          if (sid != null) {
            ownerIds.add(sid);
            const attachKey = `${bankAccountId}|${sid}`;
            if (!attachTried.has(attachKey)) {
              attachTried.add(attachKey);
              await this.attachAccountOwner(
                bankAccountId, sid, get("ownerName"));
            }
          }
        }
        // The counterparty's registry number names a real person too:
        // find-or-create them (anonymous when unnamed) and, when the row
        // names their account, create/attach it — this is what lets link
        // generation connect statement owners to their counterparties.
        const cpNatId = get("counterpartyNationalId");
        if (cpNatId) {
          const cpSid = await this.ensurePerson(
            cpNatId, get("counterpartyName"), ownerCache);
          if (cpSid != null) {
            ownerIds.add(cpSid);
            const cpAcctRaw = get("counterpartyAccount");
            if (cpAcctRaw) {
              const cpAcctId =
                await this.findOrCreateAccount(cpAcctRaw, acctCache);
              const attachKey = `${cpAcctId}|${cpSid}`;
              if (!attachTried.has(attachKey)) {
                attachTried.add(attachKey);
                await this.attachAccountOwner(
                  cpAcctId, cpSid, get("counterpartyName"));
              }
            }
          }
        }
        const dateStr = get("date");
        if (!dateStr) {
          res.skippedRows++;
          continue;
        }
        const parsedDate = parseTimestamp(dateStr);
        if (!parsedDate) {
          res.skippedRows++;
          continue;
        }
        // Two shapes in the wild: one datetime cell, or a date cell plus a
        // separate "Цаг" column. Take the date cell's own clock when it has
        // one; otherwise (or when it reads midnight) let the time column fill
        // it in — an absent/unmapped time column leaves the date untouched.
        const date = parsedDate.hasTime
          && parsedDate.iso.slice(11, 19) !== "00:00:00"
          ? parsedDate.iso
          : applyTimeOfDay(parsedDate.iso, get("time") ?? "");
        const desc = get("description");
        if (desc && desc.includes("Эхний үлдэгдэл")) {
          res.skippedRows++;
          continue;
        }
        const ref = get("reference");
        if (ref) {
          const refKey = `${bankAccountId}|${ref}`;
          if (seenRefs.has(refKey)) {
            res.duplicateRows++;
            continue;
          }
          seenRefs.add(refKey);
        }
        const currencyRaw = get("currency");
        const txn: Record<string, unknown> = {
          bankAccountId, timestamp: date, description: desc,
          flagStatus: "NORMAL", counterpartyAccount: get("counterpartyAccount"),
          counterpartyName: get("counterpartyName"), runningBalance: 0,
          counterpartyNationalId: cpNatId
            ? cpNatId.trim().toUpperCase() : null,
          referenceNumber: ref || null, category: get("category"),
          channel: get("channel"),
          currency: currencyRaw ? currencyRaw.trim().toUpperCase() : "MNT",
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
        const seen = await this.loadFingerprints(bankAccountId, fpCache);
        const fp = txnFingerprint(txn);
        const already = seen.get(fp) ?? 0;
        if (already > 0) {
          // Санд байсан хувийг нь "ашиглав" гэж тэмдэглэнэ — ингэснээр файл
          // дээрх гурав дахь ижил мөр нь сангийн хоёрыг өнгөрөөд орж ирнэ.
          seen.set(fp, already - 1);
          res.duplicateRows++;
          continue;
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
    const suspectIds = new Set<number>(ownerIds);
    if (accountIds.size > 0) {
      for (const sid of await this.db("bank_accounts")
        .whereIn("id", [...accountIds]).whereNotNull("suspectId")
        .pluck("suspectId")) {
        suspectIds.add(Number(sid));
      }
    }
    res.touchedSuspectIds = [...suspectIds];
    return res;
  }

  private async importCdr(
    table: NormalizedTable,
    det: DetectionResult,
    map: ColumnMapping,
    subjectSuspectId: number | null,
    subjectNumberArg: string | null
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

    // The subject is the person these records belong to. Contact-frequency
    // exports list only the OTHER party, so the subject's own number becomes
    // the caller for every row that has no explicit caller column.
    // Subject number: the analyst-entered number wins; otherwise fall back to
    // whatever phone the subject already has registered.
    let subjectNumber = subjectNumberArg
      ? unwrapCallerId(subjectNumberArg) : null;
    if (!subjectNumber && subjectSuspectId != null) {
      const subj = await this.db("phone_numbers")
        .where({suspectId: subjectSuspectId}).first();
      subjectNumber = subj ? unwrapCallerId(String(subj.number)) : null;
    }
    // Register the subject's number to them so it is theirs going forward
    // (suspects rarely have a phone on file yet).
    if (subjectNumber && subjectSuspectId != null) {
      const ex = await this.db("phone_numbers")
        .where({number: subjectNumber}).first();
      if (!ex) {
        await this.db("phone_numbers").insert({
          number: subjectNumber, suspectId: subjectSuspectId,
          phoneType: "Mobile", status: "ACTIVE",
        });
      } else if (ex.suspectId == null) {
        await this.db("phone_numbers").where({id: ex.id})
          .update({suspectId: subjectSuspectId});
      }
    }
    // If the file carries no caller column, the caller identity has to come
    // from the subject. Without a subject number there is nothing to put in the
    // (required) caller field, so stop with a clear message.
    if (!map["caller"] && !subjectNumber) {
      res.errors.push(subjectSuspectId != null
        ? "Сэжигтний утасны дугаараа оруулна уу (дуудлагын эзний дугаар)."
        : "Дуудагчийн багана алга — сэжигтэн сонгоод дугаарыг нь оруулна уу "
          + "эсвэл “Дуудсан дугаар” баганаа заана уу.");
      return res;
    }

    // When a name column is mapped, match each row's name against known people
    // so a newly-seen number can be attached to that person's phone list.
    const nameToSuspect = new Map<string, number>();
    if (map["name"]) {
      for (const s of await this.db("suspects").select("id", "fullName")) {
        const n = String(s.fullName ?? "").trim().toLowerCase();
        if (n) nameToSuspect.set(n, Number(s.id));
      }
    }
    const phonesToAttach = new Map<string, number>(); // number -> suspectId

    // Давхардал. Дуудлагын файл хоёр төрөл байдаг тул таних арга нь ч хоёр:
    //   · Огноо/цагтай мөр — дуудагч · дуудуулагч · цаг · үргэлжлэх хугацаа.
    //   · Огноогүй (давтамжийн жагсаалт) мөр — цагийг нь бид өөрсдөө импортын
    //     мөчөөр тавьдаг тул цагаар нь таних БОЛОМЖГҮЙ: тэр нь дахин
    //     оруулах бүрд өөр байх учир юу ч таарахгүй. Ийм мөрийн мөн чанар нь
    //     "А хүн Б рүү N удаа" гэсэн ТОО, тиймээс хосоор нь тоолж, санд аль
    //     хэдийн байгаа хэсгийг нь дахин оруулахгүй.
    const knownCalls = new Map<string, number>();   // цагтай мөрүүд
    const knownPairs = new Map<string, number>();   // хос бүрийн нийт тоо
    for (const r of await this.db("call_records")
      .select("callerNumber", "calledNumber", "startTime", "durationSeconds")) {
      const caller = String(r.callerNumber ?? "");
      const called = String(r.calledNumber ?? "");
      const exact = `${caller}|${called}|${isoText(r.startTime)}`
        + `|${Number(r.durationSeconds ?? 0)}`;
      knownCalls.set(exact, (knownCalls.get(exact) ?? 0) + 1);
      const pair = `${caller}|${called}`;
      knownPairs.set(pair, (knownPairs.get(pair) ?? 0) + 1);
    }

    // No timestamp in the export → stamp every row with the import moment so
    // the required startTime is satisfied (time-based charts won't be meaningful
    // for such data, but the contact/frequency analysis will be).
    const importDate = new Date().toISOString();
    // Frequency expansion can multiply rows explosively; keep one import from
    // ever ballooning the table / stalling. Once the ceiling is hit each
    // remaining contact is still recorded once, just not multiplied.
    const MAX_CALLS = 200000;
    const PER_ROW_CAP = 500;
    let capped = false;

    for (const row of table.rows) {
      res.totalRows++;
      try {
        const get = (f: string) =>
          map[f] ? cell(table, row, map[f]) : null;
        const called = get("called");
        if (!called) {
          res.skippedRows++;
          continue;
        }
        // Caller: an explicit column wins; otherwise the chosen subject.
        const callerRaw = get("caller") ?? subjectNumber;
        if (!callerRaw) {
          res.skippedRows++;
          continue;
        }
        // Datetime is optional — fall back to the import moment. Bills split
        // it either way: one "callstart" cell or a date plus a "Цаг" column.
        const parsedDt = parseTimestamp(get("datetime") ?? "");
        const dated = parsedDt == null ? null
          : (parsedDt.hasTime && parsedDt.iso.slice(11, 19) !== "00:00:00"
            ? parsedDt.iso
            : applyTimeOfDay(parsedDt.iso, get("time") ?? ""));
        const dt = dated ?? importDate;
        let durationSeconds = 0;
        const durRaw = get("duration");
        if (durRaw) {
          const d = parseFloat(durRaw.replace(/,/g, ""));
          if (!Number.isNaN(d)) {
            durationSeconds = unit === "MINUTES"
              ? Math.round(d * 60) : Math.round(d);
          }
        }
        // Frequency: a "called N times" row expands into N call records so the
        // top-contact / frequency views reflect it (capped to avoid blow-ups).
        let times = 1;
        const freqRaw = get("frequency");
        if (freqRaw) {
          const f = parseInt(freqRaw.replace(/\D/g, ""), 10);
          if (!Number.isNaN(f) && f > 0) times = Math.min(f, PER_ROW_CAP);
        }
        // Never blow past the per-import ceiling: still record the contact once.
        if (rowsToInsert.length + times > MAX_CALLS) {
          times = 1;
          capped = true;
        }
        const callerNumber = unwrapCallerId(callerRaw);
        const calledNumber = unwrapCallerId(called);
        const suspectId = matchSuspect(callerNumber)
          ?? matchSuspect(calledNumber) ?? subjectSuspectId;
        // Аль хэдийн санд байгаа хувийг нь хасна. Цагтай мөрийг яг өөрөөр
        // нь, огноогүй мөрийг хосынх нь нийт тоогоор.
        let already = 0;
        if (dated) {
          const key = `${callerNumber}|${calledNumber}|${isoText(dt)}`
            + `|${durationSeconds}`;
          const left = knownCalls.get(key) ?? 0;
          already = Math.min(left, times);
          if (already > 0) knownCalls.set(key, left - already);
        } else {
          const pair = `${callerNumber}|${calledNumber}`;
          const left = knownPairs.get(pair) ?? 0;
          already = Math.min(left, times);
          if (already > 0) knownPairs.set(pair, left - already);
        }
        const toAdd = times - already;
        res.duplicateRows += already;
        for (let i = 0; i < toAdd; i++) {
          rowsToInsert.push({
            callerNumber, calledNumber,
            startTime: dt, durationSeconds, callType: "Voice",
            direction: "Outgoing", suspectId,
          });
        }
        // Name → person → remember the number for attachment.
        const nameRaw = get("name");
        if (nameRaw) {
          const hit = nameToSuspect.get(nameRaw.trim().toLowerCase());
          if (hit != null && calledNumber) phonesToAttach.set(calledNumber, hit);
        }
        res.importedRows += toAdd;
      } catch {
        res.skippedRows++;
      }
    }

    // Attach matched numbers to their people: claim an unowned existing row or
    // insert a new phone number; never steal a number already owned by someone.
    let attached = 0;
    for (const [number, sid] of phonesToAttach) {
      const existing = await this.db("phone_numbers").where({number}).first();
      if (existing) {
        if (existing.suspectId == null) {
          await this.db("phone_numbers").where({id: existing.id})
            .update({suspectId: sid});
          attached++;
        }
      } else {
        await this.db("phone_numbers").insert({
          number, suspectId: sid, phoneType: "Mobile", status: "ACTIVE",
        });
        attached++;
      }
    }
    if (attached > 0) res.messages.push(`${attached} дугаар хүнд холбогдлоо.`);
    if (capped) {
      res.messages.push(`Давтамжаар үржүүлэхэд хэт олон бичлэг үүсэх тул `
        + `${MAX_CALLS.toLocaleString()} дуудлагаар хязгаарлав.`);
    }
    // Everyone the import touched — call owners plus people who gained a phone —
    // so the resolver links them all to the active case.
    const touched = new Set<number>();
    for (const [, sid] of phonesToAttach) touched.add(sid);
    if (subjectSuspectId != null) touched.add(subjectSuspectId);
    if (rowsToInsert.length > 0) {
      const beforeRow = await this.db("call_records").max({m: "id"}).first();
      const beforeMax = Number(beforeRow?.m ?? 0);
      await this.db.batchInsert("call_records", rowsToInsert, 200);
      res.newCallRecordIds = (await this.db("call_records")
        .where("id", ">", beforeMax).pluck("id")).map(Number);
      for (const r of rowsToInsert) {
        if (r.suspectId != null) touched.add(Number(r.suspectId));
      }
    }
    res.touchedSuspectIds = [...touched];
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
        const parsedTs = parseTimestamp(get("timestamp") ?? "");
        if (!parsedTs) {
          res.skippedRows++;
          continue;
        }
        const ts = parsedTs.hasTime
          && parsedTs.iso.slice(11, 19) !== "00:00:00"
          ? parsedTs.iso
          : applyTimeOfDay(parsedTs.iso, get("time") ?? "");
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
    totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0,
    errors: [], messages,
    detectedProfile: det.profile?.displayName ?? null, domain: det.domain,
  };
}

function empty(message: string): ImportSummary {
  return {
    totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0,
    errors: [message], messages: [], detectedProfile: null, domain: null,
  };
}

// === helpers (ported from ImportService) ================================

// Огноог ижил хэлбэрт оруулна. SQLite нь хадгалсан текстээ буцаадаг бол
// Postgres нь Date объект буцаадаг — хоёрыг нь харьцуулах гэж байгаа тул
// секунд хүртэлх ISO текст болгож жигдэлнэ.
function isoText(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  return String(v ?? "").slice(0, 19);
}

// Нэг гүйлгээг таних хурууны хээ. Гүйлгээний дугаар байхгүй хуулгад ч
// ажиллах ёстой тул мөрийн УТГААР нь тодорхойлно. Үлдэгдэл орохгүй: банк
// тэрийг тооцоолж бичдэг тул нэг мөрийг хоёр хуулга дээр өөрөөр үзүүлж
// болно.
function txnFingerprint(t: Record<string, unknown>): string {
  return [
    isoText(t.timestamp),
    String(t.type ?? ""),
    Number(t.amount ?? 0).toFixed(2),
    String(t.counterpartyAccount ?? "").trim(),
    String(t.description ?? "").trim(),
  ].join("|");
}

// A serial small enough to be a date is still a plausible plain number, so the
// window is deliberately tight: 1950-01-01 .. 2100-01-01.
const SERIAL_MIN = 18264;
const SERIAL_MAX = 73051;

export interface ParsedTimestamp {
  // Always UTC. A value written without a zone is kept as its wall clock
  // (14:30 stays 14:30Z) — the statement's clock is what the analyst reads,
  // and shifting it by the server's local zone silently moved every night
  // transaction into the previous day.
  iso: string;
  // Did the cell actually carry a clock, or only a calendar day? The caller
  // needs this to decide whether a separate "Цаг" column still applies.
  hasTime: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

function buildIso(
  y: number, mo: number, d: number,
  h = 0, mi = 0, s = 0, ms = 0, offsetMinutes = 0
): string | null {
  if (y < 1900 || y > 2200) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMinutes * 60_000;
  const back = new Date(t);
  // Date.UTC rolls overflow over silently (Feb 31 → Mar 3); reject instead of
  // importing a transaction on a day the statement never mentions. Only safe
  // to compare when the value had no offset applied.
  if (offsetMinutes === 0) {
    if (back.getUTCFullYear() !== y || back.getUTCMonth() + 1 !== mo
      || back.getUTCDate() !== d) return null;
  }
  return back.toISOString();
}

// "14:30", "14:30:22", "14:30:22.500", "2:05 PM", "1430", "143022" → clock.
// Returns null when the text holds no clock at all.
function parseClock(raw: string): {h: number; mi: number; s: number; ms: number}
  | null {
  const t = raw.trim();
  if (!t) return null;
  const hms = /(\d{1,2})\s*[:.х]\s*(\d{1,2})(?:\s*[:.]\s*(\d{1,2}))?(?:[.,](\d{1,3}))?/
    .exec(t);
  if (hms) {
    let h = Number(hms[1]);
    const mi = Number(hms[2]);
    const s = Number(hms[3] ?? "0");
    const ms = Number((hms[4] ?? "0").padEnd(3, "0"));
    if (/p\.?m/i.test(t) && h < 12) h += 12;
    if (/a\.?m/i.test(t) && h === 12) h = 0;
    if (h > 23 || mi > 59 || s > 59) return null;
    return {h, mi, s, ms};
  }
  // Compact clock with no separator: HHmm / HHmmss.
  const compact = /^(\d{2})(\d{2})(\d{2})?$/.exec(t);
  if (compact) {
    const h = Number(compact[1]);
    const mi = Number(compact[2]);
    const s = Number(compact[3] ?? "0");
    if (h > 23 || mi > 59 || s > 59) return null;
    return {h, mi, s, ms: 0};
  }
  return null;
}

// A trailing zone: "Z", "+08:00", "-0500". Returns the offset in minutes and
// the text with the zone cut off.
function splitZone(text: string): {body: string; offset: number | null} {
  const z = /(?:\s*(Z)|\s*(GMT|UTC)?\s*([+-])(\d{2}):?(\d{2}))$/i.exec(text);
  if (!z) return {body: text, offset: null};
  if (z[1]) return {body: text.slice(0, z.index), offset: 0};
  const sign = z[3] === "-" ? -1 : 1;
  const offset = sign * (Number(z[4]) * 60 + Number(z[5]));
  return {body: text.slice(0, z.index), offset};
}

// Statements arrive with the clock in either shape: one "2024-01-15 14:30:22"
// cell, or a date cell plus a separate "Цаг" cell. Both have to import to the
// same instant, so ONE parser reads every form we have seen in the wild:
// ISO, "YYYY/MM/DD", "DD.MM.YYYY", "YYYYMMDD", "YYYYMMDDHHmmss", the Mongolian
// "2024 оны 01 сарын 15", Excel serials (whole days and day+fraction) and any
// of those with a trailing clock and/or zone.
export function parseTimestamp(input: string): ParsedTimestamp | null {
  let s = (input ?? "").trim();
  if (!s) return null;
  // Mongolian long form → "2024-01-15 [clock]".
  const mn = /^(\d{4})\s*он(?:ы)?\s*(\d{1,2})\s*(?:дугаар|дүгээр|-р|р)?\s*сар(?:ын)?\s*(\d{1,2})\s*(?:-н[ыий]|-ний|-ны)?\s*(?:өдөр)?/i
    .exec(s);
  if (mn) {
    s = `${mn[1]}-${pad(Number(mn[2]))}-${pad(Number(mn[3]))}`
      + s.slice(mn[0].length);
    s = s.trim();
  }

  const {body, offset} = splitZone(s);
  const text = body.trim();

  // Excel serial. Whole number = a day; a fraction carries the clock.
  if (/^\d{1,5}([.,]\d+)?$/.test(text)) {
    const serial = Number(text.replace(",", "."));
    if (Number.isFinite(serial) && serial >= SERIAL_MIN && serial <= SERIAL_MAX) {
      // Round to the nearest second: 0.6034722… days is 14:29:59.9997 raw.
      const ms = Math.round((Date.UTC(1899, 11, 30) + serial * 86_400_000)
        / 1000) * 1000;
      return {
        iso: new Date(ms).toISOString(),
        hasTime: Math.abs(serial - Math.round(serial)) > 1e-9,
      };
    }
  }

  // Compact: YYYYMMDD, optionally followed by HHmm / HHmmss.
  const compact = /^(\d{4})(\d{2})(\d{2})(?:[T\s]?(\d{2})(\d{2})(\d{2})?)?$/
    .exec(text);
  if (compact) {
    const hasTime = compact[4] != null;
    const iso = buildIso(
      Number(compact[1]), Number(compact[2]), Number(compact[3]),
      Number(compact[4] ?? "0"), Number(compact[5] ?? "0"),
      Number(compact[6] ?? "0"), 0, offset ?? 0);
    if (iso) return {iso, hasTime};
  }

  // Separated date, either order, with any of - / . separators.
  let y: number | null = null;
  let mo = 0;
  let d = 0;
  let rest = "";
  const ymd = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/.exec(text);
  if (ymd) {
    y = Number(ymd[1]);
    mo = Number(ymd[2]);
    d = Number(ymd[3]);
    rest = text.slice(ymd[0].length);
  } else {
    const dmy = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})/.exec(text);
    if (dmy) {
      const a = Number(dmy[1]);
      const b = Number(dmy[2]);
      y = Number(dmy[3]);
      if (y < 100) y += y < 70 ? 2000 : 1900;
      // Day-first is the local convention; only an impossible day (>12 in the
      // second slot, or a first slot that cannot be a month) settles it.
      if (a > 12 && b <= 12) {
        d = a;
        mo = b;
      } else if (b > 12 && a <= 12) {
        mo = a;
        d = b;
      } else {
        d = a;
        mo = b;
      }
      rest = text.slice(dmy[0].length);
    }
  }
  if (y != null) {
    const clock = parseClock(rest.replace(/^[T\s,]+/, ""));
    const iso = buildIso(y, mo, d, clock?.h ?? 0, clock?.mi ?? 0,
      clock?.s ?? 0, clock?.ms ?? 0, offset ?? 0);
    // A date that read cleanly but does not exist (2024-02-31) is a broken
    // row — never hand it to Date.parse, which would roll it into March.
    return iso ? {iso, hasTime: clock != null} : null;
  }

  // Last resort: whatever the runtime can read (e.g. "15 Jan 2024"). Naive
  // values are pinned to UTC so they match every branch above.
  const native = Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s} UTC`);
  if (!Number.isNaN(native)) {
    const iso = new Date(native).toISOString();
    return {iso, hasTime: parseClock(s) != null};
  }
  return null;
}

// Statements keep the clock in its own column ("Цаг"), so the date column alone
// parses to midnight. Reading only the date made EVERY transaction 00:00, which
// flattened the hourly activity chart to a single bar and would have reported
// 100% of transactions as "шөнийн гүйлгээ". Accepts "14:35", "14:35:22",
// "2:05 PM", "1435", a whole timestamp repeated in the time cell, and the
// Excel fraction-of-a-day a time cell arrives as.
export function applyTimeOfDay(isoDate: string, raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return isoDate;
  const day = isoDate.slice(0, 10);

  // A pure decimal below 1 is an Excel time cell (a fraction of one day) and a
  // decimal above the serial floor is a whole Excel datetime — neither is a
  // clock, and reading "0.5" as 00:05 instead of 12:00 was silently wrong.
  // Everything between them ("14.30") is a bank writing the clock with a dot.
  const rawDecimal = /^\d+[.,]\d+$/.test(t) ? Number(t.replace(",", ".")) : NaN;
  const decimal = Number.isFinite(rawDecimal)
    && (rawDecimal < 1 || rawDecimal >= SERIAL_MIN) ? rawDecimal : null;
  const clock = decimal == null ? parseClock(t) : null;
  if (clock) {
    return `${day}T${pad(clock.h)}:${pad(clock.mi)}:${pad(clock.s)}`
      + `.${String(clock.ms).padStart(3, "0")}Z`;
  }

  // Excel time cell: a fraction of one day (0.5 = 12:00). A full datetime
  // serial (45301.6) lands here too — only its fraction matters.
  const frac = decimal ?? Number(t.replace(",", "."));
  if (Number.isFinite(frac) && frac > 0) {
    const dayFraction = frac - Math.floor(frac);
    if (dayFraction === 0) return isoDate;
    const ms = Math.round(dayFraction * 86_400) * 1000;
    return new Date(Date.parse(`${day}T00:00:00.000Z`) + ms).toISOString();
  }
  return isoDate;
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
function parseWorkbook(
  base64     : string,
  sheetName? : string | null,
  range      : RowRange = {}
): NormalizedTable {
  const wb = XLSX.read(Buffer.from(base64, "base64"), {
    type: "buffer", cellDates: true,
  });
  const name = sheetName && wb.SheetNames.includes(sheetName)
    ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return EMPTY_TABLE;
  // blankrows: TRUE — a dropped blank row would shift every row number below
  // it, and then "мөр 12" here is not the мөр 12 on the analyst's screen. The
  // blanks are removed later, by sliceTable, after the range has been cut.
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1, raw: false, defval: null, blankrows: true,
  });
  // The formatted text of a real date cell is whatever number format the bank
  // saved it with — "1/15/24" and "15.01.24" are the same instant written two
  // ways, and the second one cannot be told from a US month-first date. Read
  // the typed values too and let a genuine Date win: it is unambiguous, and it
  // already carries the clock when the cell is a datetime.
  const typed = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, raw: true, defval: null, blankrows: true,
  });
  const grid: (string | null)[][] = aoa.map((row, r) =>
    (row ?? []).map((c, i) => {
      const t = (typed[r] ?? [])[i];
      if (t instanceof Date && !Number.isNaN(t.getTime())) {
        // SheetJS builds the Date in local time; keep the wall clock the
        // spreadsheet shows rather than shifting it by the server's zone.
        const wall = t.getTime() - t.getTimezoneOffset() * 60_000;
        // Serial → Date round-trips land a hair off the second (14:29:59.997);
        // statements never carry milliseconds, so snap to the second.
        return new Date(Math.round(wall / 1000) * 1000).toISOString();
      }
      if (c == null) return null;
      const s = String(c).trim();
      return s === "" ? null : s;
    }));
  return sliceTable(grid, range);
}

export function unwrapCallerId(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const lt = raw.indexOf("<");
  const gt = raw.indexOf(">");
  const inner = lt >= 0 && gt > lt ? raw.slice(lt + 1, gt) : raw;
  return normalizePhone(inner);
}
