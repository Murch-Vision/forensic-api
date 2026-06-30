/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : caseSessionService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import type {CaseFile} from "../models/types";

// Ported from Services/CaseSessionService.cs (W-1) — process-wide active-case
// session: the CaseFile the analyst is working in plus pinned suspect ids.
// Pinning is per-case and cleared when the active case changes.

export class CaseSessionService {
  private readonly db: Knex;
  private currentCaseId: number | null = null;
  private readonly pinned = new Set<number>();

  constructor(db: Knex) {
    this.db = db;
  }

  async getCurrentCase(): Promise<CaseFile | null> {
    if (this.currentCaseId == null) return null;
    const row = await this.db<CaseFile>("case_files")
      .where({id: this.currentCaseId}).first();
    return row ?? null;
  }

  async setCurrentCase(caseFileId: number | null): Promise<CaseFile | null> {
    if (caseFileId !== this.currentCaseId) {
      this.currentCaseId = caseFileId;
      this.pinned.clear(); // pins are per-case
    }
    return this.getCurrentCase();
  }

  get hasActiveCase(): boolean {
    return this.currentCaseId != null;
  }

  pinnedSuspectIds(): number[] {
    return [...this.pinned];
  }

  isPinned(suspectId: number): boolean {
    return this.pinned.has(suspectId);
  }

  togglePin(suspectId: number): number[] {
    if (this.pinned.has(suspectId)) this.pinned.delete(suspectId);
    else this.pinned.add(suspectId);
    return this.pinnedSuspectIds();
  }

  clearPins(): void {
    this.pinned.clear();
  }
}
