/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : telemetryService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
import path from "path";
import type {SettingsService} from "./settingsService";

// Ported from Services/TelemetryService.cs — local-first, off-by-default
// metrics. Nothing is recorded unless settings.telemetryEnabled is true; rows
// append to data/telemetry/<date>.jsonl. No data ever leaves the box.

const DATA_DIR = process.env.DATA_DIR
  || path.join(__dirname, "..", "..", "data");
const DIR = path.join(DATA_DIR, "telemetry");

export class TelemetryService {
  private readonly settings: SettingsService;
  private readonly counts = new Map<string, number>();

  constructor(settings: SettingsService) {
    this.settings = settings;
  }

  get isEnabled(): boolean {
    return this.settings.get().telemetryEnabled;
  }

  recordPageOpen(pageName: string): void {
    this.recordEvent("page_open", {page: pageName});
  }

  recordLatency(action: string, ms: number): void {
    this.recordEvent("latency", {action, ms});
  }

  recordEvent(kind: string, payload: Record<string, unknown>): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    if (!this.isEnabled) return;
    try {
      fs.mkdirSync(DIR, {recursive: true});
      const day = new Date().toISOString().slice(0, 10);
      const line = JSON.stringify({ts: new Date().toISOString(), kind, ...payload});
      fs.appendFileSync(path.join(DIR, `${day}.jsonl`), line + "\n", "utf8");
    } catch {
      /* telemetry must never break the request */
    }
  }

  snapshot(): {kind: string; count: number}[] {
    return [...this.counts.entries()].map(([kind, count]) => ({kind, count}));
  }
}
