/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : sanctionsRefreshService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
import path from "path";
import {createHash} from "crypto";
import type {Knex} from "knex";
import type {SanctionsRefreshLog} from "../models/types";
import type {SanctionsService} from "./sanctionsService";
import type {AuditLogService} from "./auditLogService";

// Ported from Services/OpenSanctionsRefreshService.cs — downloads a JSONL
// sanctions dataset, hashes + writes it to data/sanctions.jsonl, logs the
// attempt to sanctions_refresh_logs, and marks the SanctionsService stale.

const TARGET = path.join(__dirname, "..", "..", "data", "sanctions.jsonl");
const DEFAULT_URL = process.env.SANCTIONS_URL
  || "https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json";

export class SanctionsRefreshService {
  private readonly db: Knex;
  private readonly sanctions: SanctionsService;
  private readonly audit: AuditLogService;

  constructor(db: Knex, sanctions: SanctionsService, audit: AuditLogService) {
    this.db = db;
    this.sanctions = sanctions;
    this.audit = audit;
  }

  async refreshNow(url: string = DEFAULT_URL): Promise<SanctionsRefreshLog> {
    const entry: Partial<SanctionsRefreshLog> = {
      fetchedAtUtc: new Date().toISOString(), sourceUrl: url,
      sha256Hex: "", byteCount: 0, entryCount: 0, success: false, note: null,
    };
    try {
      const res = await fetch(url, {
        headers: {"user-agent": "ForensicAnalystWorkstation/3.2"},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const bytes = Buffer.from(text, "utf8");
      entry.byteCount = bytes.length;
      entry.sha256Hex = createHash("sha256").update(bytes).digest("hex").toUpperCase();
      const lines = text.split("\n").filter((l) => l.trim());
      entry.entryCount = lines.length;
      fs.mkdirSync(path.dirname(TARGET), {recursive: true});
      fs.writeFileSync(TARGET, text, "utf8");
      this.sanctions.markStale();
      entry.success = true;
      entry.note = "refreshed";
    } catch (err) {
      entry.success = false;
      entry.note = String(err instanceof Error ? err.message : err).slice(0, 500);
    }
    const [id] = await this.db("sanctions_refresh_logs").insert(entry);
    await this.audit.record(
      entry.success ? "Sanctions.Refresh" : "Sanctions.RefreshFailed",
      `Url:${url}`, entry.note ?? null, entry.success ? "INFO" : "MEDIUM");
    const saved = await this.db<SanctionsRefreshLog>("sanctions_refresh_logs")
      .where({id: Number(id)}).first();
    return saved!;
  }

  getLatest(): Promise<SanctionsRefreshLog | undefined> {
    return this.db<SanctionsRefreshLog>("sanctions_refresh_logs")
      .orderBy("fetchedAtUtc", "desc").first();
  }

  getHistory(take = 25): Promise<SanctionsRefreshLog[]> {
    return this.db<SanctionsRefreshLog>("sanctions_refresh_logs")
      .orderBy("fetchedAtUtc", "desc").limit(take);
  }
}
