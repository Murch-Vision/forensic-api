/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : caseSessionService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-07-05
 * Author      : jeefo
 * Purpose     :
 * Description : The case a user is working in, now PER-USER (was a single
 *               process-wide value, which meant every analyst shared one active
 *               case). The selection is persisted on users.activeCaseId so it
 *               survives restarts and is isolated between accounts. An
 *               unauthenticated context (no user) simply has no active case.
 *               Pins stay in-memory but keyed per user.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import type {CaseFile} from "../models/types";

// Per-user pinned suspect ids, surviving across the per-request session
// instances (which are created fresh on every GraphQL request).
const PINS = new Map<number, Set<number>>();

export class CaseSessionService {
  private readonly db: Knex;
  // The authenticated user this session belongs to (null = anonymous).
  private readonly userId: number | null;

  constructor(db: Knex, userId: number | null = null) {
    this.db = db;
    this.userId = userId;
  }

  async getCurrentCase(): Promise<CaseFile | null> {
    if (this.userId == null) return null;
    const u = await this.db<{activeCaseId: number | null}>("users")
      .where({id: this.userId}).first("activeCaseId");
    if (!u?.activeCaseId) return null;
    const row = await this.db<CaseFile>("case_files")
      .where({id: u.activeCaseId}).first();
    return row ?? null;
  }

  async setCurrentCase(caseFileId: number | null): Promise<CaseFile | null> {
    if (this.userId == null) return null;
    await this.db("users").where({id: this.userId})
      .update({activeCaseId: caseFileId,
        updatedAt: new Date().toISOString()});
    this.pinsForUser().clear();   // pins are per-case
    return this.getCurrentCase();
  }

  get hasActiveCase(): boolean {
    // Kept for API compatibility; callers that need certainty await
    // getCurrentCase() instead.
    return this.userId != null;
  }

  private pinsForUser(): Set<number> {
    const key = this.userId ?? -1;
    let set = PINS.get(key);
    if (!set) {
      set = new Set<number>();
      PINS.set(key, set);
    }
    return set;
  }

  pinnedSuspectIds(): number[] {
    return [...this.pinsForUser()];
  }

  isPinned(suspectId: number): boolean {
    return this.pinsForUser().has(suspectId);
  }

  togglePin(suspectId: number): number[] {
    const pins = this.pinsForUser();
    if (pins.has(suspectId)) pins.delete(suspectId);
    else pins.add(suspectId);
    return this.pinnedSuspectIds();
  }

  clearPins(): void {
    this.pinsForUser().clear();
  }
}
