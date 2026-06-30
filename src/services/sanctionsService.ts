/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : sanctionsService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
import path from "path";
import type {Suspect} from "../models/types";

// Ported from Services/SanctionsService.cs — local OpenSanctions / PEP
// screening. Reads a JSON-Lines dataset and fuzzy-matches suspect names.
// Prefers a refreshed file (data/sanctions.jsonl) over the bundled sample.

export interface SanctionsEntry {
  id: string;
  schema: string;
  caption: string;
  names: string[];
  aliases: string[];
  country: string | null;
  programs: string[];
  birthDate: string | null;
}

export interface SanctionsHit {
  entry: SanctionsEntry;
  score: number;
  reason: string;
}

// Writable refreshed dataset lives under DATA_DIR; the small bundled sample
// ships under ASSETS_DIR. Both fall back to the source-tree layout in dev.
const DATA_DIR = process.env.DATA_DIR
  || path.join(__dirname, "..", "..", "data");
const ASSETS_DIR = process.env.ASSETS_DIR
  || path.join(__dirname, "..", "..", "assets");
const LOCAL_FILE = path.join(DATA_DIR, "sanctions.jsonl");
const BUNDLED_FILE = path.join(ASSETS_DIR, "sanctions.jsonl");

export class SanctionsService {
  private entries: SanctionsEntry[] = [];
  private loaded = false;
  loadedFrom: string | null = null;

  get isLoaded(): boolean {
    return this.loaded;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  markStale(): void {
    this.loaded = false;
    this.entries = [];
    this.loadedFrom = null;
  }

  load(): void {
    if (this.loaded) return;
    const file = process.env.SANCTIONS_FILE
      || (fs.existsSync(LOCAL_FILE) ? LOCAL_FILE : BUNDLED_FILE);
    const parsed: SanctionsEntry[] = [];
    try {
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line);
          parsed.push({
            id: raw.id ?? "", schema: raw.schema ?? "", caption: raw.caption ?? "",
            names: raw.names ?? [], aliases: raw.aliases ?? [],
            country: raw.country ?? null, programs: raw.programs ?? [],
            birthDate: raw.birthDate ?? null,
          });
        } catch {
          /* skip malformed line */
        }
      }
      this.loadedFrom = file;
    } catch {
      this.loadedFrom = "(dataset missing)";
    }
    this.entries = parsed;
    this.loaded = true;
  }

  screen(suspect: Suspect): SanctionsHit[] {
    this.load();
    const hits: SanctionsHit[] = [];
    const names = [suspect.fullName ?? ""];
    if (suspect.aliases) {
      names.push(...suspect.aliases.split(/[;,|]/).map((s) => s.trim())
        .filter(Boolean));
    }
    for (const name of names.filter((n) => n.trim())) {
      for (const hit of this.screenName(name, suspect.country)) {
        if (!hits.some((h) => h.entry.id === hit.entry.id)) hits.push(hit);
      }
    }
    return hits.sort((a, b) => b.score - a.score);
  }

  screenName(name: string, country?: string | null): SanctionsHit[] {
    this.load();
    const needle = normalize(name);
    if (needle.length === 0) return [];
    const tokens = needle.split(" ").filter(Boolean);
    const out: SanctionsHit[] = [];
    for (const entry of this.entries) {
      let best = 0;
      let reason = "";
      for (const candidate of allNames(entry)) {
        const hay = normalize(candidate);
        if (hay.length === 0) continue;
        let s = 0;
        let r = "";
        if (hay === needle) {
          s = 1.0;
          r = `exact match on '${candidate}'`;
        } else if (tokenSetMatch(tokens, hay)) {
          s = 0.85;
          r = `token-set match on '${candidate}'`;
        } else if (hay.includes(needle) || needle.includes(hay)) {
          s = 0.7;
          r = `substring match on '${candidate}'`;
        } else if (levenshtein(hay, needle) <= 2) {
          s = 0.55;
          r = `<= 2 edits from '${candidate}'`;
        } else {
          continue;
        }
        if (s > best) {
          best = s;
          reason = r;
        }
      }
      if (best === 0) continue;
      if (country && entry.country
        && country.toLowerCase() === entry.country.toLowerCase()) {
        best = Math.min(1, best + 0.05);
        reason += " (+country match)";
      }
      out.push({entry, score: best, reason});
    }
    return out;
  }
}

function allNames(e: SanctionsEntry): string[] {
  const out: string[] = [];
  if (e.caption?.trim()) out.push(e.caption);
  for (const n of e.names) if (n?.trim()) out.push(n);
  for (const a of e.aliases) if (a?.trim()) out.push(a);
  return out;
}

function normalize(s: string): string {
  return [...s].filter((c) => c.charCodeAt(0) >= 32).join("")
    .trim().toLowerCase().replace(/ё/g, "е");
}

function tokenSetMatch(tokens: string[], hay: string): boolean {
  if (tokens.length === 0) return false;
  return tokens.every((t) => hay.includes(t));
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return Number.MAX_SAFE_INTEGER;
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d: number[][] = Array.from({length: n + 1}, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}
