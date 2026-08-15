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
  /**
   * Which rows of the FILE this table was cut from, numbered exactly as the
   * spreadsheet numbers them — 1-based, blank rows counted. The analyst reads
   * these numbers off their own screen, so an index that quietly skips blanks
   * would name a different row than the one they are pointing at.
   */
  headerRow    : number;
  firstDataRow : number;
  lastDataRow  : number;
  /** Rows in the sheet, so a caller can bound what it offers to pick. */
  sheetRows    : number;
}

/**
 * Which rows to read. Every field is optional and 1-based; null means "decide
 * it from the file" — the header by detection, the start right after it, the
 * end at the last row that holds anything.
 */
export interface RowRange {
  headerRow? : number | null;
  startRow?  : number | null;
  endRow?    : number | null;
}

export const EMPTY_TABLE: NormalizedTable = {
  headers: [], rows: [], headerRow: 0, firstDataRow: 0, lastDataRow: 0,
  sheetRows: 0,
};

const isBlankRow = (row: (string | null)[] | undefined): boolean =>
  !row || row.every((c) => c == null || c.trim() === "");

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(Math.trunc(n), lo), hi);

/**
 * Cut the header + data rows out of a raw grid, honouring whatever the caller
 * pinned down and deciding the rest.
 *
 * The END defaults to the last row holding data, not to the last row in the
 * sheet: statements routinely carry blank rows (or a stray cell left over from
 * editing) after the final entry, and reading to the physical end turns those
 * into failed rows in the summary.
 */
export function sliceTable(
  grid  : (string | null)[][],
  range : RowRange = {}
): NormalizedTable {
  if (grid.length === 0) return EMPTY_TABLE;
  let lastData = grid.length;
  while (lastData > 0 && isBlankRow(grid[lastData - 1])) lastData--;
  if (lastData === 0) return {...EMPTY_TABLE, sheetRows: grid.length};

  const header = clamp(range.headerRow ?? detectHeaderRow(grid) + 1,
    1, grid.length);
  // Data cannot start on or above its own header. An out-of-range start simply
  // yields no rows, which the summary then reports as zero imported.
  const start = clamp(range.startRow ?? header + 1, header + 1, grid.length + 1);
  const end   = clamp(range.endRow ?? lastData, start - 1, grid.length);
  return {
    headers: (grid[header - 1] ?? []).map((x) => (x ?? "").trim()),
    // Blank rows INSIDE the chosen range are dropped here rather than left for
    // the import loop to reject: they are not rows anybody meant to import.
    rows: grid.slice(start - 1, end).filter((r) => !isBlankRow(r)),
    headerRow: header,
    firstDataRow: start,
    lastDataRow: end,
    sheetRows: grid.length,
  };
}

const HEADER_SCAN_ROWS = 15;

function looksNumericOrDate(s: string): boolean {
  const t = s.trim();
  if (t.length > 0 && !Number.isNaN(Number(t.replace(/,/g, "")))) return true;
  if (!Number.isNaN(Date.parse(t))) return true;
  return false;
}

const filledCells = (row: (string | null)[] | undefined): number =>
  (row ?? []).filter((c) => c != null && c.trim() !== "").length;

// Pick the most header-like row: mostly non-empty, mostly non-numeric,
// distinct — and as WIDE as the table it heads.
export function detectHeaderRow(grid: (string | null)[][]): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  const scan = Math.min(HEADER_SCAN_ROWS, grid.length);
  // The widest row near the top is the table's own width. Without this a title
  // line above the table ("Тайлан: ХААН банк", one filled cell) scored a
  // perfect fill/text/distinct ratio, tied with the real header row and won on
  // being first — so the columns came out as a single nonsense header.
  let widest = 1;
  for (let r = 0; r < scan; r++) widest = Math.max(widest, filledCells(grid[r]));
  for (let r = 0; r < scan; r++) {
    const row = grid[r] ?? [];
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
    const widthRatio = nonEmpty / widest;
    const score = fillRatio * 1 + textRatio * 2 + distinctRatio * 1
      + widthRatio * 2;
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

export function parseDelimited(
  text  : string,
  range : RowRange = {}
): NormalizedTable {
  const raw = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Only the trailing newline's phantom line goes; every other blank line stays
  // so line 1 of the file is row 1 here, whatever the analyst types.
  const lines = raw.split("\n").filter((l, i, arr) =>
    !(i === arr.length - 1 && l.trim() === ""));
  if (lines.length === 0) return EMPTY_TABLE;
  const delim = detectDelimiter(lines);
  return sliceTable(lines.map((l) => splitLine(l, delim)), range);
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
