/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : evidenceService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import type {AlertSeverity, EvidenceSourceType} from "../models/enums";
import type {EvidenceEntry} from "../models/types";
import type {AuditLogService} from "./auditLogService";

// Ported from Services/EvidenceService.cs — operator-driven evidence tagging.
// Attaches a permanent "Exhibit #N" pointer to any row; (case, exhibit-number)
// is unique and auto-increments per case. Tagging is idempotent.

export class EvidenceService {
  private readonly db: Knex;
  private readonly audit: AuditLogService;

  constructor(db: Knex, audit: AuditLogService) {
    this.db = db;
    this.audit = audit;
  }

  async tag(
    caseFileId: number,
    sourceType: EvidenceSourceType,
    sourceId: number,
    description: string | null = null,
    severity: AlertSeverity = "INFO"
  ): Promise<EvidenceEntry> {
    if (sourceType === "UNKNOWN") throw new Error("SourceType is required");
    if (sourceId <= 0) throw new Error("SourceId is required");

    const existing = await this.db<EvidenceEntry>("evidence_entries")
      .where({caseFileId, sourceType, sourceId}).first();
    if (existing) return existing;

    // Retry on the (caseFileId, exhibitNumber) unique-index race.
    const maxAttempts = 8;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const maxRow = await this.db("evidence_entries")
        .where({caseFileId}).max({m: "exhibitNumber"}).first();
      const nextNumber = Number(maxRow?.m ?? 0) + 1;
      const entry = {
        caseFileId, exhibitNumber: nextNumber, sourceType, sourceId,
        description, severity, taggedBy: "operator",
        taggedAtUtc: new Date().toISOString(),
      };
      try {
        const [id] = await this.db("evidence_entries").insert(entry);
        await this.audit.record("Evidence.Tagged", `${sourceType}:${sourceId}`,
          `Case=${caseFileId} Exhibit=#${nextNumber}`, severity);
        const saved = await this.db<EvidenceEntry>("evidence_entries")
          .where({id: Number(id)}).first();
        return saved!;
      } catch (err) {
        lastErr = err;
      }
    }
    await this.audit.record("Evidence.TagFailed", `${sourceType}:${sourceId}`,
      `Case=${caseFileId} retries=${maxAttempts}`, "HIGH");
    throw new Error(
      `Could not assign a unique ExhibitNumber for case ${caseFileId} ` +
      `after ${maxAttempts} attempts: ${String(lastErr)}`);
  }

  async untag(evidenceEntryId: number): Promise<void> {
    const row = await this.db<EvidenceEntry>("evidence_entries")
      .where({id: evidenceEntryId}).first();
    if (!row) return;
    await this.db("evidence_entries").where({id: evidenceEntryId}).del();
    await this.audit.record("Evidence.Untagged",
      `${row.sourceType}:${row.sourceId}`,
      `Case=${row.caseFileId} Exhibit=#${row.exhibitNumber}`, "INFO");
  }

  getForCase(caseFileId: number): Promise<EvidenceEntry[]> {
    return this.db<EvidenceEntry>("evidence_entries")
      .where({caseFileId}).orderBy("exhibitNumber", "asc");
  }

  find(
    caseFileId: number,
    sourceType: EvidenceSourceType,
    sourceId: number
  ): Promise<EvidenceEntry | undefined> {
    return this.db<EvidenceEntry>("evidence_entries")
      .where({caseFileId, sourceType, sourceId}).first();
  }
}
