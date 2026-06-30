/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : tabularReader.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/

// Ported from Services/Import/TabularReader*.cs — flattens delimited text
// (CSV / TSV / semicolon / pipe) into a header row + stringified data rows,
// auto-detecting the delimiter and the most header-like row.

export interface NormalizedTable {
  headers: string[];
  rows: (string | null)[][];
  headerRowIndex: number;
}

const HEADER_SCAN_ROWS = 15;

function looksNumericOrDate(s: string): boolean {
  const t = s.trim();
  if (t.length > 0 && !Number.isNaN(Number(t.replace(/,/g, "")))) return true;
  if (!Number.isNaN(Date.parse(t))) return true;
  return false;
}

// Pick the most header-like row: mostly non-empty, mostly non-numeric, distinct.
export function detectHeaderRow(grid: (string | null)[][]): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  const scan = Math.min(HEADER_SCAN_ROWS, grid.length);
  for (let r = 0; r < scan; r++) {
    const row = grid[r];
    let nonEmpty = 0;
    let numericish = 0;
    const seen = new Set<string>();
    for (const cell of row) {
      if (cell == null || cell.trim() === "") continue;
      nonEmpty++;
      seen.add(cell.trim().toLowerCase());
      if (looksNumericOrDate(cell)) numericish++;
    }
    if (nonEmpty === 0) continue;
    const fillRatio = nonEmpty / Math.max(1, row.length);
    const textRatio = 1 - numericish / nonEmpty;
    const distinctRatio = seen.size / nonEmpty;
    const score = fillRatio * 1 + textRatio * 2 + distinctRatio * 1;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  return bestIdx;
}

// Detect the delimiter by counting candidates on the first non-empty lines.
function detectDelimiter(lines: string[]): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    let count = 0;
    for (const line of lines.slice(0, 10)) {
      count += line.split(d).length - 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

// Minimal RFC-4180-ish field splitter handling quoted fields + escaped quotes.
function splitLine(line: string, delim: string): (string | null)[] {
  const out: (string | null)[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur.trim() === "" ? null : cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim() === "" ? null : cur.trim());
  return out;
}

export function parseDelimited(text: string): NormalizedTable {
  const raw = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter((l, i, arr) =>
    !(i === arr.length - 1 && l.trim() === ""));
  if (lines.length === 0) return {headers: [], rows: [], headerRowIndex: 0};
  const delim = detectDelimiter(lines);
  const grid = lines.map((l) => splitLine(l, delim));
  const h = detectHeaderRow(grid);
  return {
    headers: grid[h].map((x) => (x ?? "").trim()),
    rows: grid.slice(h + 1),
    headerRowIndex: h,
  };
}

// Cell value by header name (case/space-insensitive); null if absent/empty.
export function cell(
  table: NormalizedTable,
  row: (string | null)[],
  header: string
): string | null {
  for (let i = 0; i < table.headers.length && i < row.length; i++) {
    if (table.headers[i].trim().toLowerCase() === header.trim().toLowerCase()) {
      const v = row[i];
      return v == null || v.trim() === "" ? null : v;
    }
  }
  return null;
}
