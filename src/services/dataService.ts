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

  async deleteAutoGeneratedLinks(
    linkTypes: SuspectLinkType[]
  ): Promise<number> {
    return this.db("suspect_links").whereIn("linkType", linkTypes).del();
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

  // Truncate every operational table inside one transaction (mirrors
  // ClearAllDataAsync). FK order: children before parents.
  async clearAllData(): Promise<void> {
    await this.db.transaction(async (trx) => {
      for (const t of ["evidence_entries", "bank_transactions", "call_records",
        "case_notes", "analysis_results", "suspect_links", "suspect_tags",
        "timeline_events", "chart_links", "chart_events", "chart_entities",
        "access_log_entries", "bank_accounts", "phone_numbers", "case_files",
        "suspects"]) {
        await trx(t).del();
      }
    });
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
