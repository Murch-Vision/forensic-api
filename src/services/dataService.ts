/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : dataService.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import type {
  AccessLogEntry,
  AnalysisResult,
  AuditEvent,
  BankAccount,
  BankTransaction,
  CallRecord,
  CaseFile,
  PhoneNumber,
  Suspect,
  SuspectLink,
} from "../models/types";
import type {SuspectLinkType} from "../models/enums";

// Read/write helpers ported from the relevant slices of
// Services/DatabaseService.cs. EF .Include() eager loads become explicit
// follow-up queries; SQLite booleans (0/1) are coerced to JS booleans.

export interface SuspectWithRelations extends Suspect {
  bankAccounts: BankAccount[];
  phoneNumbers: PhoneNumber[];
}

export interface DashboardStats {
  totalSuspects        : number;
  activeSuspects       : number;
  totalBankAccounts    : number;
  totalTransactions    : number;
  totalPhoneNumbers    : number;
  totalCallRecords     : number;
  totalLinks           : number;
  openCases            : number;
  highRiskSuspects     : number;
  flaggedTransactions  : number;
  earliestTransaction  : string | null;
  latestTransaction    : string | null;
  totalTransactionVolume : number;
  earliestCall         : string | null;
  latestCall           : string | null;
}

export class DataService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  // === demo / sample data ===============================================
  // Populate the given (case-scoped) suspects with a lifelike call + device
  // network so the analytics charts and the connection graph become
  // meaningful. This FABRICATES values (spread-out times, durations, extra
  // calls between people) purely for demonstration — it is an explicit analyst
  // action, never automatic, and only touches degenerate/zero-duration rows.
  async generateSampleData(suspectIds: number[]): Promise<{
    enrichedCalls: number; networkCalls: number; phonesEnsured: number;
  }> {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const isSqlite = String(
      (this.db.client as {config?: {client?: string}}).config?.client ?? "")
      .includes("sqlite");
    if (suspectIds.length === 0) {
      return {enrichedCalls: 0, networkCalls: 0, phonesEnsured: 0};
    }

    // Pin the fabricated calls to the SAME time window as this case's bank
    // transactions, so the call charts line up with the money timeline and
    // call→transaction correlation is possible (falls back to the last 60 days
    // when the case has no transactions).
    const acctIds = await this.db("bank_accounts")
      .whereIn("suspectId", suspectIds).pluck("id");
    let minMs = Date.now() - 60 * 86400 * 1000;
    let maxMs = Date.now();
    if (acctIds.length) {
      const span = await this.db("bank_transactions")
        .whereIn("bankAccountId", acctIds)
        .min({mn: "timestamp"}).max({mx: "timestamp"}).first();
      const mn = span?.mn ? new Date(String(span.mn)).getTime() : NaN;
      const mx = span?.mx ? new Date(String(span.mx)).getTime() : NaN;
      if (!Number.isNaN(mn) && !Number.isNaN(mx) && mx > mn) {
        minMs = mn; maxMs = mx;
      }
    }
    const randTime = () => new Date(minMs + rnd(maxMs - minMs + 1)).toISOString();
    const minEpoch = Math.floor(minMs / 1000);
    const rangeSec = Math.max(1, Math.floor((maxMs - minMs) / 1000));

    // Re-running is idempotent: drop the calls a previous run fabricated
    // (flagStatus='SAMPLE') before making new ones.
    await this.db("call_records").whereIn("suspectId", suspectIds)
      .where({flagStatus: "SAMPLE"}).del();

    // 1. Re-spread ALL of the case's real calls across that window with real
    //    durations so the time & duration charts come alive. All Voice — the
    //    source CDR data has no SMS.
    const cnt = await this.db("call_records")
      .whereIn("suspectId", suspectIds).count({c: "*"}).first();
    const enrichedCalls = Number(cnt?.c ?? 0);
    const ph = suspectIds.map(() => "?").join(",");
    if (isSqlite) {
      await this.db.raw(
        `UPDATE call_records SET
           startTime = strftime('%Y-%m-%dT%H:%M:%SZ', ?, 'unixepoch',
             '+' || (abs(random()) % ?) || ' seconds'),
           durationSeconds = (abs(random()) % 1140) + 20,
           callType = 'Voice',
           direction = CASE WHEN abs(random()) % 2 = 0 THEN 'Outgoing'
             ELSE 'Incoming' END
         WHERE suspectId IN (${ph})`,
        [minEpoch, rangeSec, ...suspectIds]);
    } else {
      const ids = await this.db("call_records")
        .whereIn("suspectId", suspectIds).pluck("id");
      for (const id of ids) {
        await this.db("call_records").where({id}).update({
          startTime: randTime(), durationSeconds: rnd(1140) + 20,
          callType: "Voice",
          direction: rnd(2) === 0 ? "Outgoing" : "Incoming",
        });
      }
    }

    // 2. Give up to a dozen of the case's people a phone number so calls can
    //    run BETWEEN them (that is what the connection graph links on).
    const pick = suspectIds.slice(0, 12);
    const phoneOf = new Map<number, string>();
    let phonesEnsured = 0;
    for (const sid of pick) {
      const existing = await this.db("phone_numbers")
        .where({suspectId: sid}).first();
      if (existing) { phoneOf.set(sid, String(existing.number)); continue; }
      let num = "";
      for (let t = 0; t < 6 && !num; t++) {
        const cand = "9" + String(10000000 + rnd(89999999)).slice(-7);
        const clash = await this.db("phone_numbers")
          .where({number: cand}).first();
        if (!clash) num = cand;
      }
      if (!num) continue;
      await this.db("phone_numbers").insert({
        number: num, suspectId: sid, phoneType: "Mobile", status: "ACTIVE"});
      phoneOf.set(sid, num);
      phonesEnsured++;
    }

    // 3. A shared handset between one pair → a SHARED_DEVICE link for variety.
    const picks = [...phoneOf.keys()];
    if (picks.length >= 2) {
      const imei = "35" + String(rnd(1e12)).padStart(13, "0");
      await this.db("phone_numbers").where({suspectId: picks[0]})
        .update({imei});
      await this.db("phone_numbers").where({suspectId: picks[1]})
        .update({imei});
    }

    // 4. Weave calls between those people (a realistic partial mesh, not a
    //    complete graph) so PHONE_CONTACT links form a legible network.
    const nums = picks.map((sid) => ({sid, num: phoneOf.get(sid)!}));
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        if (rnd(10) < 4) continue; // ~60% of pairs are connected
        const k = 1 + rnd(12);
        for (let c = 0; c < k; c++) {
          const out = rnd(2) === 0;
          const a = out ? nums[i] : nums[j];
          const b = out ? nums[j] : nums[i];
          rows.push({
            callerNumber: a.num, calledNumber: b.num,
            startTime: randTime(), durationSeconds: rnd(1140) + 20,
            callType: "Voice", direction: "Outgoing", suspectId: a.sid,
            flagStatus: "SAMPLE",
          });
        }
      }
    }

    // 5. Plant a call a few minutes BEFORE some of the picked people's real
    //    transactions so the "Дуудлагын дараах гүйлгээ" (post-call money) panel
    //    has genuine hits (a call shortly before money moves).
    if (nums.length >= 2) {
      const pickAccts = await this.db("bank_accounts")
        .whereIn("suspectId", picks).select("id", "suspectId");
      const acctToSid = new Map(
        pickAccts.map((a) => [Number(a.id), Number(a.suspectId)]));
      const txns = acctToSid.size
        ? await this.db("bank_transactions")
          .whereIn("bankAccountId", [...acctToSid.keys()])
          .select("bankAccountId", "timestamp").limit(400)
        : [];
      for (const t of txns) {
        if (rnd(2) === 0) continue; // roughly half get a preceding call
        const sid = acctToSid.get(Number(t.bankAccountId));
        const caller = sid != null ? phoneOf.get(sid) : undefined;
        if (sid == null || !caller) continue;
        const others = nums.filter((n) => n.sid !== sid);
        if (!others.length) continue;
        const b = others[rnd(others.length)];
        const before = new Date(new Date(String(t.timestamp)).getTime()
          - (5 + rnd(20)) * 60000).toISOString();
        rows.push({
          callerNumber: caller, calledNumber: b.num, startTime: before,
          durationSeconds: rnd(600) + 30, callType: "Voice",
          direction: "Outgoing", suspectId: sid, flagStatus: "SAMPLE",
        });
      }
    }

    if (rows.length) await this.db.batchInsert("call_records", rows, 200);
    return {enrichedCalls, networkCalls: rows.length, phonesEnsured};
  }

  // === suspects (with nav, for analysis) =================================
  async getSuspectsWithRelations(): Promise<SuspectWithRelations[]> {
    const suspects = await this.db<Suspect>("suspects").orderBy("fullName");
    const accounts = await this.db<BankAccount>("bank_accounts");
    const phones = await this.db<PhoneNumber>("phone_numbers");
    const accBySuspect = new Map<number, BankAccount[]>();
    for (const a of accounts) {
      if (a.suspectId == null) continue;
      const list = accBySuspect.get(a.suspectId) ?? [];
      list.push(a);
      accBySuspect.set(a.suspectId, list);
    }
    const phBySuspect = new Map<number, PhoneNumber[]>();
    for (const p of phones) {
      if (p.suspectId == null) continue;
      const list = phBySuspect.get(p.suspectId) ?? [];
      list.push(p);
      phBySuspect.set(p.suspectId, list);
    }
    return suspects.map((s) => ({
      ...s,
      bankAccounts: accBySuspect.get(s.id) ?? [],
      phoneNumbers: phBySuspect.get(s.id) ?? [],
    }));
  }

  async getSuspectById(id: number): Promise<Suspect | null> {
    const row = await this.db<Suspect>("suspects").where({id}).first();
    return row ?? null;
  }

  // === bank accounts / transactions ======================================
  getAllBankAccounts(): Promise<BankAccount[]> {
    return this.db<BankAccount>("bank_accounts").orderBy("id");
  }

  getAllTransactions(): Promise<BankTransaction[]> {
    return this.db<BankTransaction>("bank_transactions")
      .orderBy("timestamp", "desc");
  }

  getTransactionsForAccount(accountId: number): Promise<BankTransaction[]> {
    return this.db<BankTransaction>("bank_transactions")
      .where({bankAccountId: accountId})
      .orderBy("timestamp");
  }

  // All transactions across the suspect's accounts (via FK join).
  async getTransactionsForSuspect(suspectId: number): Promise<BankTransaction[]> {
    const accountIds = (await this.db("bank_accounts")
      .where({suspectId}).pluck("id")) as number[];
    if (accountIds.length === 0) return [];
    return this.db<BankTransaction>("bank_transactions")
      .whereIn("bankAccountId", accountIds).orderBy("timestamp");
  }

  // All call records across the suspect's phone numbers (via FK join).
  async getCallRecordsForSuspect(suspectId: number): Promise<CallRecord[]> {
    const phoneIds = (await this.db("phone_numbers")
      .where({suspectId}).pluck("id")) as number[];
    if (phoneIds.length === 0) return [];
    return this.db<CallRecord>("call_records")
      .whereIn("phoneNumberId", phoneIds).orderBy("startTime");
  }

  getAllBankAccountIds(): Promise<number[]> {
    return this.db("bank_accounts").pluck("id") as Promise<number[]>;
  }

  async getTransactionById(id: number): Promise<BankTransaction | null> {
    const row = await this.db<BankTransaction>("bank_transactions")
      .where({id}).first();
    return row ?? null;
  }

  // The ±window-minute neighbours on the same account (excluding the target).
  getTransactionsAround(
    bankAccountId: number, timestamp: string, windowMinutes: number,
    excludeId: number
  ): Promise<BankTransaction[]> {
    const t = new Date(timestamp).getTime();
    const lo = new Date(t - windowMinutes * 60000).toISOString();
    const hi = new Date(t + windowMinutes * 60000).toISOString();
    return this.db<BankTransaction>("bank_transactions")
      .where({bankAccountId})
      .whereNot({id: excludeId})
      .whereBetween("timestamp", [lo, hi])
      .orderBy("timestamp");
  }

  async createBankAccount(input: Partial<BankAccount>): Promise<BankAccount> {
    const row = {
      accountNumber: input.accountNumber, bankName: input.bankName ?? null,
      branchCode: input.branchCode ?? null, iban: input.iban ?? null,
      accountType: input.accountType ?? "Current", currency: input.currency ?? "MNT",
      currentBalance: input.currentBalance ?? 0, status: input.status ?? "ACTIVE",
      suspectId: input.suspectId ?? null,
      accountHolderName: input.accountHolderName ?? null,
      createdAt: new Date().toISOString(),
    };
    const [id] = await this.db("bank_accounts").insert(row);
    return (await this.db<BankAccount>("bank_accounts")
      .where({id: Number(id)}).first())!;
  }

  async createPhoneNumber(input: Partial<PhoneNumber>): Promise<PhoneNumber> {
    const row = {
      number: input.number, provider: input.provider ?? null,
      imei: input.imei ?? null, imsi: input.imsi ?? null,
      phoneType: input.phoneType ?? "Mobile", status: input.status ?? "ACTIVE",
      suspectId: input.suspectId ?? null,
      subscriberName: input.subscriberName ?? null,
    };
    const [id] = await this.db("phone_numbers").insert(row);
    return (await this.db<PhoneNumber>("phone_numbers")
      .where({id: Number(id)}).first())!;
  }

  // Paged transactions across a suspect's accounts (mirrors the C# paged API).
  async getSuspectTransactionsPaged(
    suspectId: number, page = 1, pageSize = 50
  ): Promise<{transactions: BankTransaction[]; totalCount: number}> {
    const accountIds = (await this.db("bank_accounts")
      .where({suspectId}).pluck("id")) as number[];
    if (accountIds.length === 0) return {transactions: [], totalCount: 0};
    const totalRow = await this.db("bank_transactions")
      .whereIn("bankAccountId", accountIds).count({c: "*"}).first();
    const transactions = await this.db<BankTransaction>("bank_transactions")
      .whereIn("bankAccountId", accountIds)
      .orderBy("timestamp", "desc")
      .limit(pageSize).offset((page - 1) * pageSize);
    return {transactions, totalCount: Number(totalRow?.c ?? 0)};
  }

  // Located (timestamp, location, kind) events for a suspect — txns via
  // accounts, calls via phones — used by the dwell-zone clustering.
  async getLocatedEventsForSuspect(
    suspectId: number
  ): Promise<{timestamp: string; location: string | null; kind: string}[]> {
    const accountIds = (await this.db("bank_accounts")
      .where({suspectId}).pluck("id")) as number[];
    const phoneIds = (await this.db("phone_numbers")
      .where({suspectId}).pluck("id")) as number[];
    const out: {timestamp: string; location: string | null; kind: string}[] = [];
    if (accountIds.length > 0) {
      const txns = await this.db("bank_transactions")
        .whereIn("bankAccountId", accountIds)
        .whereNotNull("location").whereNot("location", "")
        .select("timestamp", "location");
      for (const t of txns) {
        out.push({timestamp: t.timestamp, location: t.location, kind: "TXN"});
      }
    }
    if (phoneIds.length > 0) {
      const calls = await this.db("call_records")
        .whereIn("phoneNumberId", phoneIds)
        .whereNotNull("location").whereNot("location", "")
        .select("startTime", "location");
      for (const c of calls) {
        out.push({timestamp: c.startTime, location: c.location, kind: "CALL"});
      }
    }
    return out;
  }

  // All transaction locations (optionally within a UTC window) for the map
  // density layer.
  async getTransactionLocations(
    fromUtc?: string | null
  ): Promise<{location: string; timestamp: string}[]> {
    const q = this.db("bank_transactions")
      .whereNotNull("location").whereNot("location", "")
      .select("location", "timestamp");
    if (fromUtc) q.where("timestamp", ">=", fromUtc);
    return q as Promise<{location: string; timestamp: string}[]>;
  }

  // === phones / calls =====================================================
  getAllPhoneNumbers(): Promise<PhoneNumber[]> {
    return this.db<PhoneNumber>("phone_numbers").orderBy("id");
  }

  getAllCallRecords(): Promise<CallRecord[]> {
    return this.db<CallRecord>("call_records").orderBy("startTime", "desc");
  }

  getDistinctCallerNumbers(): Promise<string[]> {
    return this.db("call_records").distinct("callerNumber")
      .pluck("callerNumber") as Promise<string[]>;
  }

  // === links ==============================================================
  getAllLinks(): Promise<SuspectLink[]> {
    return this.db<SuspectLink>("suspect_links").orderBy("strength", "desc");
  }

  async createLink(link: Partial<SuspectLink>): Promise<SuspectLink> {
    const row = {...link, createdAt: link.createdAt ?? new Date().toISOString()};
    const [id] = await this.db("suspect_links").insert(row);
    const created = await this.db<SuspectLink>("suspect_links")
      .where({id: Number(id)}).first();
    return created!;
  }

  // Edit an existing link (used for analyst-curated MANUAL connections —
  // relabel the relationship or change its confidence).
  async updateLink(
    id: number, patch: Partial<SuspectLink>
  ): Promise<SuspectLink> {
    await this.db("suspect_links").where({id}).update(patch);
    const updated = await this.db<SuspectLink>("suspect_links")
      .where({id}).first();
    if (!updated) throw new Error(`Link ${id} not found`);
    return updated;
  }

  // Delete a single link by id (MANUAL connection removal). Returns whether a
  // row was actually removed.
  async deleteLink(id: number): Promise<boolean> {
    const n = await this.db("suspect_links").where({id}).del();
    return n > 0;
  }

  async deleteAutoGeneratedLinks(
    linkTypes: SuspectLinkType[]
  ): Promise<number> {
    return this.db("suspect_links").whereIn("linkType", linkTypes).del();
  }

  // Adopt every unassigned (default-view) MANUAL connection into a board — used
  // when the analyst saves the current graph as a new board.
  async claimUnassignedManualLinks(caseGraphId: number): Promise<number> {
    return this.db("suspect_links")
      .where({linkType: "MANUAL", caseGraphId: null})
      .update({caseGraphId});
  }

  // Remove the MANUAL connections owned by a board (called when it's deleted).
  async deleteManualLinksForGraph(caseGraphId: number): Promise<number> {
    return this.db("suspect_links")
      .where({linkType: "MANUAL", caseGraphId})
      .del();
  }

  // === cases ==============================================================
  getAllCaseFiles(): Promise<CaseFile[]> {
    return this.db<CaseFile>("case_files").orderBy("createdAt", "desc");
  }

  async createCaseFile(input: Partial<CaseFile>): Promise<CaseFile> {
    const now = new Date().toISOString();
    const row = {
      caseId: input.caseId, caseName: input.caseName,
      description: input.description ?? null, status: input.status ?? "OPEN",
      priority: input.priority ?? "MEDIUM",
      leadInvestigator: input.leadInvestigator ?? null,
      caseType: input.caseType ?? null, createdAt: now, updatedAt: now,
      closedAt: null,
      ownerUserId: input.ownerUserId ?? null,
    };
    const [id] = await this.db("case_files").insert(row);
    return (await this.db<CaseFile>("case_files").where({id: Number(id)}).first())!;
  }

  // Edit the case's descriptive fields; caseId (identifier) and status
  // (setCaseStatus) are managed elsewhere on purpose.
  async updateCaseFile(
    id: number,
    input: Partial<CaseFile>
  ): Promise<CaseFile | null> {
    await this.db("case_files").where({id}).update({
      caseName: input.caseName,
      description: input.description ?? null,
      priority: input.priority,
      leadInvestigator: input.leadInvestigator ?? null,
      updatedAt: new Date().toISOString(),
    });
    return (await this.db<CaseFile>("case_files").where({id}).first()) ?? null;
  }

  // Status lifecycle: closedAt stamps when a case leaves the active pipeline
  // (CLOSED / ARCHIVED) and clears again if the case is reopened.
  async setCaseStatus(caseFileId: number, status: string): Promise<CaseFile> {
    const now = new Date().toISOString();
    const closedAt = status === "CLOSED" || status === "ARCHIVED" ? now : null;
    await this.db("case_files").where({id: caseFileId})
      .update({status, closedAt, updatedAt: now});
    const row = await this.db<CaseFile>("case_files")
      .where({id: caseFileId}).first();
    if (!row) throw new Error(`CaseFile ${caseFileId} not found`);
    return row;
  }

  // Merge: evidence and notes move to the target (exhibits renumbered after
  // the target's own, entries for an already-tagged source dropped); the
  // drained source cases are archived with a pointer to the target.
  async mergeCases(sourceIds: number[], targetId: number): Promise<CaseFile> {
    const sources = [...new Set(sourceIds)].filter((id) => id !== targetId);
    const target = await this.db<CaseFile>("case_files")
      .where({id: targetId}).first();
    if (!target) throw new Error(`CaseFile ${targetId} not found`);
    if (sources.length === 0) return target;
    const now = new Date().toISOString();
    await this.db.transaction(async (trx) => {
      const targetEv = await trx("evidence_entries")
        .where({caseFileId: targetId});
      const seen = new Set(
        targetEv.map((e) => `${e.sourceType}:${e.sourceId}`));
      let next = targetEv.reduce(
        (m, e) => Math.max(m, Number(e.exhibitNumber)), 0);
      const rows = await trx("evidence_entries")
        .whereIn("caseFileId", sources)
        .orderBy(["caseFileId", "exhibitNumber"]);
      for (const row of rows) {
        const key = `${row.sourceType}:${row.sourceId}`;
        if (seen.has(key)) {
          await trx("evidence_entries").where({id: row.id}).delete();
        } else {
          seen.add(key);
          next += 1;
          await trx("evidence_entries").where({id: row.id})
            .update({caseFileId: targetId, exhibitNumber: next});
        }
      }
      await trx("case_notes").whereIn("caseFileId", sources)
        .update({caseFileId: targetId});
      for (const id of sources) {
        const src = await trx<CaseFile>("case_files").where({id}).first();
        if (!src) continue;
        const note = `Нэгтгэсэн → ${target.caseId}`;
        await trx("case_files").where({id}).update({
          status: "ARCHIVED", closedAt: now, updatedAt: now,
          description: src.description
            ? `${src.description}\n${note}` : note,
        });
      }
      await trx("case_files").where({id: targetId}).update({updatedAt: now});
    });
    return (await this.db<CaseFile>("case_files")
      .where({id: targetId}).first())!;
  }

  async addCaseNote(input: {
    caseFileId?: number | null; suspectId?: number | null; content: string;
    noteType?: string; author?: string | null;
  }): Promise<number> {
    const [id] = await this.db("case_notes").insert({
      caseFileId: input.caseFileId ?? null, suspectId: input.suspectId ?? null,
      content: input.content, noteType: input.noteType ?? "GENERAL",
      author: input.author ?? null, createdAt: new Date().toISOString(),
      isPinned: false,
    });
    return Number(id);
  }

  // === analysis results ===================================================
  async getAllAnalysisResults(): Promise<AnalysisResult[]> {
    const rows = await this.db<AnalysisResult>("analysis_results")
      .orderBy("analyzedAt", "desc");
    return rows.map((r) => ({...r, benfordPasses: Boolean(r.benfordPasses)}));
  }

  async saveAnalysisResult(
    result: Partial<AnalysisResult>
  ): Promise<AnalysisResult> {
    const [id] = await this.db("analysis_results").insert(result);
    const row = await this.db<AnalysisResult>("analysis_results")
      .where({id: Number(id)}).first();
    return {...row!, benfordPasses: Boolean(row!.benfordPasses)};
  }

  // === audit / access logs ================================================
  getAuditEvents(limit = 500): Promise<AuditEvent[]> {
    return this.db<AuditEvent>("audit_events")
      .orderBy("timestampUtc", "desc")
      .limit(limit);
  }

  getAccessLogEntries(suspectId?: number | null): Promise<AccessLogEntry[]> {
    const q = this.db<AccessLogEntry>("access_log_entries")
      .orderBy("timestamp", "desc");
    if (suspectId != null) q.where({suspectId});
    return q;
  }

  // === dashboard ==========================================================
  async getDashboardStats(): Promise<DashboardStats> {
    const count = async (
      table: string,
      where?: (q: Knex.QueryBuilder) => void
    ): Promise<number> => {
      const q = this.db(table);
      if (where) where(q);
      const row = await q.count({c: "*"}).first();
      return Number(row?.c ?? 0);
    };

    const stats: DashboardStats = {
      totalSuspects       : await count("suspects"),
      activeSuspects      : await count("suspects",
        (q) => q.where({status: "ACTIVE"})),
      totalBankAccounts   : await count("bank_accounts"),
      totalTransactions   : await count("bank_transactions"),
      totalPhoneNumbers   : await count("phone_numbers"),
      totalCallRecords    : await count("call_records"),
      totalLinks          : await count("suspect_links"),
      openCases           : await count("case_files",
        (q) => q.whereIn("status", ["OPEN", "ACTIVE"])),
      highRiskSuspects    : await count("suspects",
        (q) => q.whereIn("riskLevel", ["HIGH", "CRITICAL"])),
      flaggedTransactions : await count("bank_transactions",
        (q) => q.whereIn("flagStatus", ["FLAGGED", "SUSPICIOUS"])),
      earliestTransaction : null,
      latestTransaction   : null,
      totalTransactionVolume : 0,
      earliestCall        : null,
      latestCall          : null,
    };

    if (stats.totalTransactions > 0) {
      const agg = await this.db("bank_transactions")
        .min({mn: "timestamp"}).max({mx: "timestamp"})
        .sum({sm: "amount"}).first();
      stats.earliestTransaction = (agg?.mn as string) ?? null;
      stats.latestTransaction = (agg?.mx as string) ?? null;
      stats.totalTransactionVolume = Number(agg?.sm ?? 0);
    }
    if (stats.totalCallRecords > 0) {
      const agg = await this.db("call_records")
        .min({mn: "startTime"}).max({mx: "startTime"}).first();
      stats.earliestCall = (agg?.mn as string) ?? null;
      stats.latestCall = (agg?.mx as string) ?? null;
    }
    return stats;
  }
}
