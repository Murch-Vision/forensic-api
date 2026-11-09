import type {ReportGraph} from "./reportGraph";

export interface ReportFlow {
  from: string; to: string; amount: number; directed: boolean; soft: boolean;
  fromRed: boolean; toRed: boolean;
}
export interface ReportGraphAnalysis {
  version: 1;
  flow: ReportFlow[];
  flowImages: ReportGraph[];
  shared: {rows: string[][]; image?: ReportGraph};
  red: {rows: string[][]; image?: ReportGraph};
}

// This is a captured, analyst-selected view, like the main chart attachment.
// Canonical case totals continue to come from the authorized server snapshot.
// No HTML, remote image URLs, executable content or durable storage is accepted.
export async function prepareGraphAnalysis(encoded: string,
  prepareImage: (base64: string, title: string, tall?: boolean) => Promise<ReportGraph>): Promise<ReportGraphAnalysis> {
  const fail = (): never => {throw Error("Зураглалын шинжилгээний хавсралт буруу эсвэл хэт том байна.");};
  if (!encoded || encoded.length > Math.ceil(8 * 1024 * 1024 / 3) * 4
    || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) fail();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 8 * 1024 * 1024 || bytes.toString("base64") !== encoded) fail();
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
  const section = async (value: any, cols: number, title: string) => {
    if (!value) fail();
    const rows = list(value.rows).map(row => {
      if (!Array.isArray(row) || row.length !== cols) fail();
      return row.map(text);
    });
    if (rows.length > 0 && !value.image) fail();
    if (!rows.length && value.image) fail();
    return {rows, image: value.image
      ? await prepareImage(textImage(value.image), title) : undefined};
  };
  const textImage = (value: any): string => {
    if (!value || typeof value.imageBase64 !== "string") fail();
    return value.imageBase64;
  };
  const images = list(raw.flowImages);
  if (images.length !== (flow.length ? 1 : 0)) fail();
  const flowImages: ReportGraph[] = [];
  for (const image of images) flowImages.push(await prepareImage(textImage(image), "Мөнгөн урсгалын нийт зураглал", true));
  const shared = await section(raw.shared, 4, "Дундын харилцааны зураглал");
  const red = await section(raw.red, 3, "Улаанаар тэмдэглэсэн этгээдийн харилцааны зураглал");
  return {version: 1, flow, flowImages, shared, red};
}
