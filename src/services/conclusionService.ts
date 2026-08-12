/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : conclusionService.ts
 * Created at  : 2026-08-13
 * Author      : jeefo
 * Purpose     : Дүгнэлт — read and store the examiner's written conclusions.
 * Description : One row per (case, account), plus one with a null account for
 *               the link analysis. Saving an empty string deletes the row, so a
 *               cleared box does not leave a stale conclusion in the report.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export interface CaseConclusion {
  id             : number;
  caseFileId     : number;
  bankAccountId  : number | null;
  text           : string;
  updatedAt      : string;
  updatedByUserId: number | null;
}

export class ConclusionService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  async getForCase(caseFileId: number): Promise<CaseConclusion[]> {
    return this.db<CaseConclusion>("case_conclusions")
      .where({caseFileId}).orderBy("bankAccountId", "asc");
  }

  // Upsert by (case, account). An empty text removes the row entirely.
  async save(
    caseFileId: number,
    bankAccountId: number | null,
    text: string,
    userId: number | null
  ): Promise<CaseConclusion | null> {
    const trimmed = text.trim();
    const where = bankAccountId == null
      ? this.db("case_conclusions").where({caseFileId}).whereNull("bankAccountId")
      : this.db("case_conclusions").where({caseFileId, bankAccountId});
    const existing = await where.clone().first();

    if (!trimmed) {
      if (existing) await where.clone().delete();
      return null;
    }

    const now = new Date().toISOString();
    if (existing) {
      await where.clone().update({
        text: trimmed, updatedAt: now, updatedByUserId: userId,
      });
    } else {
      await this.db("case_conclusions").insert({
        caseFileId, bankAccountId, text: trimmed,
        updatedByUserId: userId, createdAt: now, updatedAt: now,
      });
    }
    const row = await (bankAccountId == null
      ? this.db<CaseConclusion>("case_conclusions")
        .where({caseFileId}).whereNull("bankAccountId").first()
      : this.db<CaseConclusion>("case_conclusions")
        .where({caseFileId, bankAccountId}).first());
    return row ?? null;
  }
}
