/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : uploadBuffer.ts
 * Purpose     : Chunked upload staging for large import files.
 * Description : The preview proxy caps a single request body at ~1 MB, so a
 *               large workbook/CSV cannot travel in one GraphQL call. The
 *               client splits the (base64 or text) content into sub-MB chunks
 *               and streams them here; excelSheets / previewImport / importData
 *               then reference the assembled content by uploadId instead of
 *               carrying it inline.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/

// Process-wide staging area. The API runs as a single Node process, so a
// module-level map is shared across resolver calls. Buffers are short-lived:
// they exist only between uploadStart and the import/preview that consumes
// them, and a TTL sweep reclaims anything an abandoned upload leaves behind.

interface Staged {
  parts: string[];
  updatedAt: number;
}

const buffers = new Map<string, Staged>();
const TTL_MS = 15 * 60 * 1000; // abandoned uploads are dropped after 15 min
let seq = 0;

// new Date()/Date.now() are available here (server code); a monotonic-ish
// millisecond clock is all the TTL needs.
function now(): number {
  return new Date().getTime();
}

function sweep(): void {
  const cutoff = now() - TTL_MS;
  for (const [id, buf] of buffers) {
    if (buf.updatedAt < cutoff) buffers.delete(id);
  }
}

export function uploadStart(): string {
  sweep();
  seq += 1;
  const id = `upl_${now().toString(36)}_${seq.toString(36)}`;
  buffers.set(id, {parts: [], updatedAt: now()});
  return id;
}

// Append one chunk; returns the running number of chunks received so the
// client can sanity-check ordering. Throws on an unknown/expired id so the
// client surfaces the problem instead of silently importing a truncated file.
export function uploadAppend(uploadId: string, chunk: string): number {
  const buf = buffers.get(uploadId);
  if (!buf) throw new Error(`Unknown or expired uploadId: ${uploadId}`);
  buf.parts.push(chunk);
  buf.updatedAt = now();
  return buf.parts.length;
}

// Read assembled content WITHOUT discarding it — the same upload feeds
// excelSheets -> previewImport -> importData in sequence.
export function uploadContent(uploadId: string): string {
  const buf = buffers.get(uploadId);
  if (!buf) throw new Error(`Unknown or expired uploadId: ${uploadId}`);
  buf.updatedAt = now();
  return buf.parts.join("");
}

// Explicitly drop a finished upload (called after a successful import).
export function uploadRelease(uploadId: string): void {
  buffers.delete(uploadId);
}
