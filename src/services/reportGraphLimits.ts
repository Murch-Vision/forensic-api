// A PNG stays bounded independently. The analysis JSON contains up to three
// base64 PNGs (money/shared/offenders), plus UTF-8 labels and evidence rows.
export const REPORT_IMAGE_BYTES = 8 * 1024 * 1024;
export const REPORT_ANALYSIS_BYTES = 36 * 1024 * 1024;
export const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;
