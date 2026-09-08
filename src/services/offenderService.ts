/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : offenderService.ts
 * Created at  : 2026-09-08
 * Author      : jeefo
 * Purpose     : Хэрэгтний бүртгэл — гаднаас ирсэн регистрийн жагсаалт.
 * Description : ⛔ Багана СОНГОХГҮЙ. Энэ файлын багана бүр нь тусдаа ЖАГСААЛТ
 *               (Яллагдагч2019, ШШГЕГЯЛ2020, Зөрчил2021 …), нүд бүр нь нэг
 *               регистр. Тийм болохоор баганы нэрийг шошго болгож, доорх бүх
 *               нүдийг уншина — хэдэн ч багана, ямар ч нэртэй байсан ажиллана.
 *
 *               Нэг хүн олон жагсаалтад орсон байж болно; түүнийг НЭГ мөрөнд
 *               шошгуудтай нь нэгтгэнэ.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import * as XLSX from "xlsx";
import type {Knex} from "knex";

export interface KnownOffender {
  id         : number;
  nationalId : string;
  labels     : string[];
  sourceFile : string | null;
  createdAt  : string;
  updatedAt  : string;
}

export interface OffenderImportSummary {
  /** Файлаас уншсан нүдний тоо (хоосныг оруулаагүй). */
  readCells    : number;
  /** Регистрийн хэлбэрт нийцсэн нүд. */
  validCells   : number;
  /** Нийцээгүй нүд (нэр, огноо, гадаад паспорт, буруу бичсэн регистр). */
  invalidCells : number;
  /** Файл дахь ДАВХАРДААГҮЙ регистр. */
  uniquePeople : number;
  /** Бүртгэлд ШИНЭЭР нэмэгдсэн хүн. */
  added        : number;
  /** Өмнө нь байсан ч шинэ жагсаалт нэмэгдсэн хүн. */
  updated      : number;
  /** Импортын дараах нийт хүн. */
  total        : number;
  /** Аль баганаас хэдэн регистр орсон бэ. */
  labels       : {label: string; count: number}[];
  /** Нийцээгүй утгуудын жишээ — файлаа засахад л хэрэгтэй. */
  invalidSample: string[];
}

// Монгол регистр: кирилл хоёр үсэг + найман орон.
const REGISTER = /^[А-ЯЁӨҮ]{2}\d{8}$/;

/**
 * Нэг нүдийг регистр болгон цэвэрлэнэ; регистр биш бол null.
 * Файлд тохиолддог бодит бохирдол: тасрахгүй зай (U+00A0), жижиг үсэг,
 * «РД:» угтвар, цэг таслал.
 */
export function normalizeRegister(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw)
    .replace(/ /g, " ")
    .trim()
    .replace(/^РД\s*:?\s*/iu, "")
    .replace(/[\s.,;:_-]/g, "")
    .toUpperCase();
  return REGISTER.test(text) ? text : null;
}

export class OffenderService {
  private db: Knex;
  // Тулгалт хуудас бүрт хэдэн зуун мөр дээр давтагдана — бүртгэлийг санах
  // ойд барина. Бичилт болгонд хүчингүй болно.
  private cache: Set<string> | null = null;

  constructor(db: Knex) {
    this.db = db;
  }

  private drop(): void {
    this.cache = null;
  }

  /** Бүх регистрийн олонлог — улаанаар ялгах шалгалт үүгээр явна. */
  async registerSet(): Promise<Set<string>> {
    if (this.cache) return this.cache;
    const rows = await this.db("known_offenders").select("nationalId");
    this.cache = new Set(rows.map((r: {nationalId: string}) => r.nationalId));
    return this.cache;
  }

  /** Хэрэгтэн эсэх — регистр цэвэрлэгдээгүй байж болно. */
  async isOffender(nationalId: string | null | undefined): Promise<boolean> {
    const id = normalizeRegister(nationalId);
    if (!id) return false;
    return (await this.registerSet()).has(id);
  }

  async importWorkbook(
    base64: string, filename: string,
  ): Promise<OffenderImportSummary> {
    const wb = XLSX.read(Buffer.from(base64, "base64"), {type: "buffer"});
    const summary: OffenderImportSummary = {
      readCells: 0, validCells: 0, invalidCells: 0, uniquePeople: 0,
      added: 0, updated: 0, total: 0, labels: [], invalidSample: [],
    };
    // регистр → тухайн файлаас олдсон шошгууд.
    const found = new Map<string, Set<string>>();
    const perLabel = new Map<string, number>();

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
        header: 1, raw: false, defval: null, blankrows: true,
      });
      if (!grid.length) continue;
      const headers = (grid[0] ?? []).map((h, i) => {
        const text = String(h ?? "").replace(/ /g, " ").trim();
        // Толгойгүй багана ч жагсаалт хэвээр: хаягаар нь нэрлэнэ.
        return text || `${sheetName} · ${XLSX.utils.encode_col(i)}`;
      });
      // ⚠️ Эхний мөр нь ТОЛГОЙ биш, шууд регистр байх тохиолдол: тэр үед
      // толгойг алдалгүй жагсаалтад оруулна.
      grid[0]?.forEach((cell, index) => {
        const id = normalizeRegister(cell);
        if (!id) return;
        headers[index] = `${sheetName} · ${XLSX.utils.encode_col(index)}`;
        summary.readCells++;
        summary.validCells++;
        add(found, perLabel, id, headers[index]);
      });

      for (let r = 1; r < grid.length; r++) {
        const row = grid[r] ?? [];
        for (let c = 0; c < row.length; c++) {
          const cell = row[c];
          if (cell == null || String(cell).trim() === "") continue;
          summary.readCells++;
          const id = normalizeRegister(cell);
          if (!id) {
            summary.invalidCells++;
            if (summary.invalidSample.length < 12) {
              summary.invalidSample.push(String(cell).trim().slice(0, 40));
            }
            continue;
          }
          summary.validCells++;
          add(found, perLabel, id, headers[c] ?? String(c));
        }
      }
    }

    summary.uniquePeople = found.size;
    if (found.size) {
      const now = new Date().toISOString();
      const existing = await this.db<{
        id: number; nationalId: string; labels: string;
      }>("known_offenders").select("id", "nationalId", "labels");
      const byId = new Map(existing.map((row) => [row.nationalId, row]));
      const inserts: Record<string, unknown>[] = [];
      const updates: {id: number; labels: string}[] = [];
      for (const [nationalId, labels] of found) {
        const row = byId.get(nationalId);
        if (!row) {
          inserts.push({
            nationalId, labels: JSON.stringify([...labels].sort()),
            sourceFile: filename, createdAt: now, updatedAt: now,
          });
          continue;
        }
        const before = parseLabels(row.labels);
        const merged = new Set([...before, ...labels]);
        if (merged.size !== before.length) {
          updates.push({id: row.id, labels: JSON.stringify([...merged].sort())});
        }
      }
      // SQLite нэг мэдэгдэлд 999 хувьсагч авдаг тул багцлан бичнэ.
      for (let i = 0; i < inserts.length; i += 100) {
        await this.db("known_offenders").insert(inserts.slice(i, i + 100));
      }
      for (const u of updates) {
        await this.db("known_offenders").where({id: u.id})
          .update({labels: u.labels, updatedAt: now});
      }
      summary.added = inserts.length;
      summary.updated = updates.length;
    }

    summary.labels = [...perLabel.entries()]
      .map(([label, count]) => ({label, count}))
      .sort((a, b) => b.count - a.count);
    summary.total = await this.count();
    this.drop();
    return summary;
  }

  async count(): Promise<number> {
    const [row] = await this.db("known_offenders").count({c: "*"});
    return Number((row as {c: number | string}).c);
  }

  /** Жагсаалт — хайлт (регистр) ба шошгоор шүүнэ. */
  async list(opts: {search?: string | null; label?: string | null;
    take?: number | null; skip?: number | null}): Promise<{
      rows: KnownOffender[]; total: number;
    }> {
    const search = normalizeRegister(opts.search)
      ?? (opts.search ?? "").replace(/ /g, " ").trim().toUpperCase();
    const label = (opts.label ?? "").trim();
    const take = Math.min(Math.max(opts.take ?? 100, 1), 500);
    const skip = Math.max(opts.skip ?? 0, 0);
    let q = this.db<{
      id: number; nationalId: string; labels: string;
      sourceFile: string | null; createdAt: string; updatedAt: string;
    }>("known_offenders");
    if (search) q = q.whereRaw("UPPER(nationalId) LIKE ?", [`%${search}%`]);
    // Шошго нь JSON массив дотор байгаа тул мөрийн хайлт. Хэмжээ нь мянган
    // мөр — индекс шаардахааргүй.
    if (label) q = q.whereRaw("labels LIKE ?", [`%"${label}"%`]);
    const [countRow] = await q.clone().count({c: "*"});
    const rows = await q.clone()
      .orderBy("nationalId").limit(take).offset(skip);
    return {
      total: Number((countRow as {c: number | string}).c),
      rows: rows.map((r) => ({
        id: r.id, nationalId: r.nationalId, labels: parseLabels(r.labels),
        sourceFile: r.sourceFile, createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  /** Бүртгэл дэх жагсаалт бүр хэдэн хүнтэй вэ. */
  async labelCounts(): Promise<{label: string; count: number}[]> {
    const rows = await this.db("known_offenders").select("labels");
    const counts = new Map<string, number>();
    for (const row of rows as {labels: string}[]) {
      for (const label of parseLabels(row.labels)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([label, count]) => ({label, count}))
      .sort((a, b) => b.count - a.count);
  }

  async remove(id: number): Promise<boolean> {
    const n = await this.db("known_offenders").where({id}).delete();
    this.drop();
    return n > 0;
  }

  async clear(): Promise<number> {
    const n = await this.db("known_offenders").delete();
    this.drop();
    return n;
  }
}

function add(found: Map<string, Set<string>>,
  perLabel: Map<string, number>, id: string, label: string): void {
  const set = found.get(id) ?? new Set<string>();
  set.add(label);
  found.set(id, set);
  perLabel.set(label, (perLabel.get(label) ?? 0) + 1);
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
