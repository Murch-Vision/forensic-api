import {REPORT_ANALYSIS_BYTES, base64Length} from "./reportGraphLimits";
import type {ReportGraph} from "./reportGraph";

export interface ReportFlow {
  from: string; to: string; amount: number; directed: boolean; soft: boolean;
  fromRed: boolean; toRed: boolean;
}
export interface ReportGraphAnalysis {
  version: 1;
  flow: ReportFlow[];
  flowImages: ReportGraph[];
  shared: {rows: string[][]; amounts?: number[]; image?: ReportGraph};
  red: {rows: string[][]; image?: ReportGraph};
}

// This is a captured, analyst-selected view, like the main chart attachment.
// Canonical case totals continue to come from the authorized server snapshot.
// No HTML, remote image URLs, executable content or durable storage is accepted.
export async function prepareGraphAnalysis(encoded: string,
  prepareImage: (base64: string, title: string, tall?: boolean) => Promise<ReportGraph>): Promise<ReportGraphAnalysis> {
  const fail = (): never => {throw Error("Зураглалын шинжилгээний хавсралт буруу эсвэл хэт том байна.");};
  if (!encoded || encoded.length > base64Length(REPORT_ANALYSIS_BYTES)
    || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) fail();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > REPORT_ANALYSIS_BYTES || bytes.toString("base64") !== encoded) fail();
  let raw: any;
  try {raw = JSON.parse(bytes.toString("utf8"));} catch {fail();}
  const text = (v: unknown): string => {
    if (typeof v !== "string" || v.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail();
    return v as string;
  };
  const bool = (v: unknown): boolean => {if (typeof v !== "boolean") fail(); return v as boolean;};
  const list = (v: unknown): any[] => {if (!Array.isArray(v) || v.length > 10000) fail(); return v as any[];};
  if (!raw || raw.version !== 1) fail();
  const flow: ReportFlow[] = list(raw.flow).map(r => {
    if (!r || typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount <= 0) fail();
    const result = {from: text(r.from), to: text(r.to), amount: r.amount,
      directed: bool(r.directed), soft: bool(r.soft), fromRed: bool(r.fromRed), toRed: bool(r.toRed)};
    if (result.from.length > 600 || result.to.length > 600 || (result.soft && result.directed)) fail();
    return result;
  });
  const section = async (value: any, cols: number, title: string, allowIsolates = false) => {
    if (!value) fail();
    const rows = list(value.rows).map(row => {
      if (!Array.isArray(row) || row.length !== cols) fail();
      return row.map(text);
    });
    if (rows.length > 0 && !value.image) fail();
    if (!rows.length && value.image && !allowIsolates) fail();
    return {rows, image: value.image
      ? await prepareImage(textImage(value.image), title) : undefined};
  };
  const textImage = (value: any): string => {
    if (!value || typeof value.imageBase64 !== "string") fail();
    return value.imageBase64;
  };
  const images = list(raw.flowImages);
  // New captures omit money images. Validate old v1 captures too, but report
  // renderers only include the main, shared and offender graphs.
  if (images.length > (flow.length ? 1 : 0)) fail();
  const flowImages: ReportGraph[] = [];
  for (const image of images) flowImages.push(await prepareImage(textImage(image), "Мөнгөн урсгалын нийт зураглал", true));
  const shared = await section(raw.shared, 4, "Дундын харилцааны зураглал");
  // Numeric amounts avoid ranking rounded display text. Older captures carry
  // formatted money in the evidence column, so they can still be ranked.
  const amounts = raw.shared.amounts === undefined
    ? shared.rows.map(row => Number((row[3].match(/([\d,]+)\s*₮/)?.[1] ?? "0").replace(/,/g, "")))
    : list(raw.shared.amounts);
  if (amounts.length !== shared.rows.length || amounts.some(n =>
    typeof n !== "number" || !Number.isFinite(n) || n < 0)) fail();
  const ranked = shared.rows.map((row, i) => ({row, amount: amounts[i], i}))
    .sort((a, b) => b.amount - a.amount || a.i - b.i).slice(0, 20);
  shared.rows = ranked.map(r => r.row);
  const red = await section(raw.red, 3, "Улаанаар тэмдэглэсэн этгээдийн харилцааны зураглал", true);
  return {version: 1, flow, flowImages, shared: {...shared, amounts: ranked.map(r => r.amount)}, red};
}
