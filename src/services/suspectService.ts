/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : suspectService.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import {fromCanonical, RiskLevel, SuspectStatus} from "../models/enums";
import type {
  BankAccount,
  CaseNote,
  PhoneNumber,
  Suspect,
  SuspectLink,
  SuspectTag,
} from "../models/types";

// Ported from Services/DatabaseService.cs — the suspect-facing slice. EF's
// .Include() eager loads become explicit follow-up queries keyed by FK.

export interface SuspectInput {
  fullName     : string;
  aliases?     : string | null;
  nationalId?  : string | null;
  passportNumber? : string | null;
  dateOfBirth? : string | null;
  gender?      : string | null;
  address?     : string | null;
  city?        : string | null;
  country?     : string | null;
  primaryPhone? : string | null;
  email?       : string | null;
  occupation?  : string | null;
  organization? : string | null;
  riskLevel?   : string | null;
  notes?       : string | null;
  photoData?   : string | null;
  status?      : string | null;
}

export class SuspectService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  // === reads ==============================================================

  async getAllSuspects(): Promise<Suspect[]> {
    return this.db<Suspect>("suspects").orderBy("fullName", "asc");
  }

  async getSuspectById(id: number): Promise<Suspect | null> {
    const row = await this.db<Suspect>("suspects").where({id}).first();
    return row ?? null;
  }

  async getBankAccounts(suspectId: number): Promise<BankAccount[]> {
    return this.db<BankAccount>("bank_accounts")
      .where({suspectId})
      .orderBy("id", "asc");
  }

  async getPhoneNumbers(suspectId: number): Promise<PhoneNumber[]> {
    return this.db<PhoneNumber>("phone_numbers")
      .where({suspectId})
      .orderBy("id", "asc");
  }

  async getTags(suspectId: number): Promise<SuspectTag[]> {
    return this.db<SuspectTag>("suspect_tags")
      .where({suspectId})
      .orderBy("id", "asc");
  }

  async getCaseNotes(suspectId: number): Promise<CaseNote[]> {
    const rows = await this.db<CaseNote>("case_notes")
      .where({suspectId})
      .orderBy("createdAt", "desc");
    return rows.map((r) => ({...r, isPinned: Boolean(r.isPinned)}));
  }

  /// Links where this suspect is the source OR the target — mirrors EF's
  /// LinksAsSource + LinksAsTarget includes used by the detail panel.
  async getLinks(suspectId: number): Promise<SuspectLink[]> {
    return this.db<SuspectLink>("suspect_links")
      .where({sourceSuspectId: suspectId})
      .orWhere({targetSuspectId: suspectId})
      .orderBy("createdAt", "desc");
  }

  /// (TransactionCount, CallRecordCount) for the selected suspect — joins
  /// through bank_accounts / phone_numbers exactly like the C# original.
  async getRecordCounts(
    suspectId: number
  ): Promise<{transactionCount: number; callRecordCount: number}> {
    const accountIds = (await this.db("bank_accounts")
      .where({suspectId}).pluck("id")) as number[];
    const phoneIds = (await this.db("phone_numbers")
      .where({suspectId}).pluck("id")) as number[];

    const transactionCount = accountIds.length
      ? Number((await this.db("bank_transactions")
          .whereIn("bankAccountId", accountIds).count({c: "*"}).first())?.c ?? 0)
      : 0;
    const callRecordCount = phoneIds.length
      ? Number((await this.db("call_records")
          .whereIn("phoneNumberId", phoneIds).count({c: "*"}).first())?.c ?? 0)
      : 0;

    return {transactionCount, callRecordCount};
  }

  // === writes =============================================================

  async createSuspect(input: SuspectInput): Promise<Suspect> {
    const now = new Date().toISOString();
    const suspectId = await this.generateSuspectId();
    const row = {
      suspectId,
      fullName     : input.fullName,
      aliases      : nullIfBlank(input.aliases),
      nationalId   : nullIfBlank(input.nationalId),
      passportNumber : nullIfBlank(input.passportNumber),
      dateOfBirth  : input.dateOfBirth ?? null,
      gender       : input.gender ?? "Male",
      address      : nullIfBlank(input.address),
      city         : nullIfBlank(input.city),
      country      : nullIfBlank(input.country),
      primaryPhone : nullIfBlank(input.primaryPhone),
      email        : nullIfBlank(input.email),
      occupation   : nullIfBlank(input.occupation),
      organization : nullIfBlank(input.organization),
      riskLevel    : fromCanonical(RiskLevel, input.riskLevel),
      notes        : nullIfBlank(input.notes),
      photoData    : input.photoData ?? null,
      status       : fromCanonical(SuspectStatus, input.status ?? "ACTIVE"),
      createdAt    : now,
      updatedAt    : now,
    };
    const [id] = await this.db("suspects").insert(row);
    const created = await this.getSuspectById(Number(id));
    if (!created) throw new Error("Failed to create suspect");
    return created;
  }

  async updateSuspect(id: number, input: SuspectInput): Promise<Suspect> {
    const existing = await this.getSuspectById(id);
    if (!existing) throw new Error(`Suspect ${id} not found`);
    await this.db("suspects").where({id}).update({
      fullName     : input.fullName,
      aliases      : input.aliases ?? null,
      nationalId   : input.nationalId ?? null,
      passportNumber : input.passportNumber ?? null,
      dateOfBirth  : input.dateOfBirth ?? null,
      gender       : input.gender ?? null,
      address      : input.address ?? null,
      city         : input.city ?? null,
      country      : input.country ?? null,
      primaryPhone : input.primaryPhone ?? null,
      email        : input.email ?? null,
      occupation   : input.occupation ?? null,
      organization : input.organization ?? null,
      riskLevel    : fromCanonical(RiskLevel, input.riskLevel),
      notes        : input.notes ?? null,
      photoData    : input.photoData ?? existing.photoData,
      updatedAt    : new Date().toISOString(),
    });
    const updated = await this.getSuspectById(id);
    if (!updated) throw new Error(`Suspect ${id} not found`);
    return updated;
  }

  // Update ONLY the photo (null clears it) — leaves every other field intact,
  // unlike updateSuspect which does a full replace.
  async setPhoto(id: number, photoData: string | null): Promise<Suspect> {
    const existing = await this.getSuspectById(id);
    if (!existing) throw new Error(`Suspect ${id} not found`);
    await this.db("suspects").where({id}).update({
      photoData,
      updatedAt: new Date().toISOString(),
    });
    const updated = await this.getSuspectById(id);
    if (!updated) throw new Error(`Suspect ${id} not found`);
    return updated;
  }

  // Update ONLY the status (e.g. mark a person UNDER_INVESTIGATION) — leaves
  // every other field intact, unlike updateSuspect which does a full replace.
  async setStatus(id: number, status: SuspectStatus): Promise<Suspect> {
    const existing = await this.getSuspectById(id);
    if (!existing) throw new Error(`Suspect ${id} not found`);
    await this.db("suspects").where({id}).update({
      status,
      updatedAt: new Date().toISOString(),
    });
    const updated = await this.getSuspectById(id);
    if (!updated) throw new Error(`Suspect ${id} not found`);
    return updated;
  }

  async deleteSuspect(id: number): Promise<boolean> {
    const count = await this.db("suspects").where({id}).del();
    return count > 0;
  }

  /// Allocate the next SUBJ-NNNN id. Uses MAX(numeric suffix)+1 rather than
  /// Count+1 so deletions never cause a collision (ported verbatim intent).
  async generateSuspectId(): Promise<string> {
    const existing = (await this.db("suspects")
      .where("suspectId", "like", "SUBJ-%")
      .pluck("suspectId")) as string[];
    let max = 0;
    for (const sid of existing) {
      const dash = sid.lastIndexOf("-");
      if (dash >= 0) {
        const n = parseInt(sid.slice(dash + 1), 10);
        if (!Number.isNaN(n) && n > max) max = n;
      }
    }
    return `SUBJ-${String(max + 1).padStart(4, "0")}`;
  }
}

function nullIfBlank(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v.trim().length === 0 ? null : v;
}
