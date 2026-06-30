/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : auditLogService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import {createHash} from "crypto";
import type {Knex} from "knex";
import type {AlertSeverity} from "../models/enums";
import type {AuditEvent} from "../models/types";

// Ported from Services/AuditLogService.cs — append-only SHA-256 hash-chained
// chain-of-custody log. Each row's chainHash includes the previous row's
// hash, so any insertion / reordering / deletion breaks the chain downstream.

const TOOL_VERSION = "3.2.0-rc4";

export interface AuditChainVerdict {
  valid: boolean;
  brokenAt: number | null;
}

function secondsIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function computeChainHash(
  previousHash: string | null,
  row: {timestampUtc: string; actor: string; action: string;
    target: string | null; detail: string | null; severity: string;
    toolVersion: string}
): string {
  const payload = [
    previousHash ?? "", row.timestampUtc, row.actor, row.action,
    row.target ?? "", row.detail ?? "", row.severity, row.toolVersion ?? "",
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").toUpperCase();
}

export class AuditLogService {
  private readonly db: Knex;
  private gate: Promise<unknown> = Promise.resolve();

  constructor(db: Knex) {
    this.db = db;
  }

  // Serialise hash-chain appends so each new row chains off the true tip.
  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gate.then(fn, fn);
    this.gate = run.then(() => undefined, () => undefined);
    return run;
  }

  async record(
    action: string,
    target: string | null = null,
    detail: string | null = null,
    severity: AlertSeverity = "INFO",
    actor = "operator"
  ): Promise<number> {
    if (!action || !action.trim()) throw new Error("Action is required");
    return this.serialise(async () => {
      const timestampUtc = secondsIso(new Date());
      const row = {
        timestampUtc, actor, action: action.trim(),
        target: target?.trim() || null, detail: detail?.trim() || null,
        severity, toolVersion: TOOL_VERSION, chainHash: "",
      };
      const prev = await this.db<AuditEvent>("audit_events")
        .orderBy("id", "desc").select("chainHash").first();
      row.chainHash = computeChainHash(prev?.chainHash ?? null, row);
      const [id] = await this.db("audit_events").insert(row);
      return Number(id);
    });
  }

  readAll(): Promise<AuditEvent[]> {
    return this.db<AuditEvent>("audit_events").orderBy("id", "asc");
  }

  search(opts: {
    fromUtc?: string; toUtc?: string; actor?: string; action?: string;
    take?: number;
  }): Promise<AuditEvent[]> {
    const q = this.db<AuditEvent>("audit_events");
    if (opts.fromUtc) q.where("timestampUtc", ">=", opts.fromUtc);
    if (opts.toUtc) q.where("timestampUtc", "<=", opts.toUtc);
    if (opts.actor) q.where("actor", "like", `%${opts.actor}%`);
    if (opts.action) q.where("action", "like", `%${opts.action}%`);
    return q.orderBy("id", "desc")
      .limit(Math.min(Math.max(opts.take ?? 1000, 1), 50_000));
  }

  // Walk the chain; return the first tampered row id, or null if intact.
  async verify(): Promise<AuditChainVerdict> {
    const rows = await this.readAll();
    let previous: string | null = null;
    for (const row of rows) {
      const expected = computeChainHash(previous, {
        timestampUtc: row.timestampUtc, actor: row.actor, action: row.action,
        target: row.target, detail: row.detail, severity: row.severity,
        toolVersion: row.toolVersion ?? "",
      });
      if (expected !== row.chainHash) {
        return {valid: false, brokenAt: row.id};
      }
      previous = row.chainHash;
    }
    return {valid: true, brokenAt: null};
  }

  static toCsv(rows: AuditEvent[]): string {
    const esc = (s: string) =>
      /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const lines = [
      "Id,TimestampUtc,Actor,Action,Target,Detail,Severity,ToolVersion,ChainHash",
    ];
    for (const r of rows) {
      lines.push([
        r.id, r.timestampUtc, esc(r.actor), esc(r.action), esc(r.target ?? ""),
        esc(r.detail ?? ""), r.severity, esc(r.toolVersion ?? ""),
        esc(r.chainHash ?? ""),
      ].join(","));
    }
    return lines.join("\n");
  }
}
