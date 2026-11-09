import {randomUUID} from "node:crypto";
import {REPORT_IMAGE_BYTES, REPORT_ANALYSIS_BYTES, base64Length} from "./reportGraphLimits";

// Short-lived request transport for full-resolution charts above the proxy's
// 1 MB body limit. No disk writes, durable storage or timer/background process.
const MAX_TOTAL = 96 * 1024 * 1024;
type UploadKind = "IMAGE" | "ANALYSIS";
const TTL = 2 * 60 * 1000;
interface Upload {userId:number; caseFileId:number; parts:string[]; length:number; touched:number; limit:number}
const uploads = new Map<string, Upload>();
function sweep() {
  for (const [id, row] of uploads) if (Date.now() - row.touched > TTL) uploads.delete(id);
}
function owned(id:string, userId:number): Upload {
  sweep();
  const row = uploads.get(id);
  if (!row || row.userId !== userId) throw Error("Зураг дамжуулах хүсэлт дууссан байна. Дахин оролдоно уу.");
  return row;
}
export function beginGraphUpload(userId:number, caseFileId:number, kind: UploadKind = "IMAGE"): string {
  sweep();
  if (kind !== "IMAGE" && kind !== "ANALYSIS") throw Error("Зураг дамжуулалтын төрөл буруу байна.");
  if ([...uploads.values()].filter(r=>r.userId===userId).length >= 2) {
    throw Error("Өмнөх зураг дамжуулалт дуусахыг хүлээнэ үү.");
  }
  const id = randomUUID();
  uploads.set(id,{userId,caseFileId,parts:[],length:0,touched:Date.now(),
    limit:base64Length(kind === "ANALYSIS" ? REPORT_ANALYSIS_BYTES : REPORT_IMAGE_BYTES)});
  return id;
}
export function appendGraphUpload(id:string, userId:number, offset:number, chunk:string): number {
  const row = owned(id,userId);
  const total = [...uploads.values()].reduce((sum,r)=>sum+r.length,0);
  if (offset !== row.length || !chunk.length || chunk.length > 512_000
    || /[^A-Za-z0-9+/=]/.test(chunk) || row.length+chunk.length > row.limit
    || total+chunk.length > MAX_TOTAL) throw Error("Зураг дамжуулалт буруу эсвэл хэт том байна.");
  row.parts.push(chunk); row.length += chunk.length; row.touched=Date.now();
  return row.length;
}
export function takeGraphUpload(id:string, userId:number, caseFileId:number): string {
  const row = owned(id,userId);
  if (row.caseFileId !== caseFileId) throw Error("Зураглал өөр хэрэгт хамаарч байна.");
  uploads.delete(id);
  return row.parts.join("");
}
export function releaseGraphUpload(id:string, userId:number): boolean {
  const row=uploads.get(id);
  if (row && row.userId !== userId) throw Error("Зураг дамжуулалтад хандах эрхгүй.");
  uploads.delete(id);
  return true;
}
