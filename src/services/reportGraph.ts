import sharp from "sharp";

export interface ReportGraphInput {
  caseFileId: number;
  title: string;
  imageBase64: string;
  imageUploadId?: string | null;
}
export interface ReportGraph {
  title: string;
  imageBase64: string;
  width: number;
  height: number;
}

// A request-scoped attachment, never a persisted file or a remotely fetched URL.
// Decode and re-encode so only bounded, real PNG pixels reach PDF/Word/HTML.
export async function prepareReportGraph(input: ReportGraphInput): Promise<ReportGraph> {
  const maxBytes = 8 * 1024 * 1024;
  if (!input.imageBase64 || input.imageBase64.length > Math.ceil(maxBytes / 3) * 4
    || input.imageBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input.imageBase64)) {
    throw new Error("Зураглалын PNG зураг буруу эсвэл хэт том байна.");
  }
  const buffer = Buffer.from(input.imageBase64, "base64");
  if (buffer.length > maxBytes || buffer.toString("base64") !== input.imageBase64
    || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Зураглал PNG зураг байх шаардлагатай.");
  }
  try {
    const image = sharp(buffer, {limitInputPixels: 12_000_000});
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width > 4096
      || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) throw Error("dimensions");
    const png = await image.flatten({background: "#0b0e1a"}).png().toBuffer();
    return {title: input.title.trim().slice(0, 180) || "Нотлох баримтын сүлжээ",
      imageBase64: png.toString("base64"), width: metadata.width, height: metadata.height};
  } catch {
    throw new Error("Зураглалын PNG зургийг уншиж чадсангүй. Зургаа дахин сонгоно уу.");
  }
}
