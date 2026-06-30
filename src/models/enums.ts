/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : enums.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/

// Ported from Models/DomainEnums.cs. The C# enums persist via a custom
// converter as the canonical UPPERCASE / SNAKE_CASE string the database
// already stores ("HIGH", "ACTIVE", "FINANCIAL_TRANSFER"…). We model each
// enum directly as that canonical string union — it IS the stored form and
// the GraphQL enum value — and keep a `default` UNKNOWN member valued first
// so a fresh entity reads as "unset" rather than a misleading "Low".

export const SuspectStatus = [
  "UNKNOWN",
  "ACTIVE",
  "UNDER_INVESTIGATION",
  "CLOSED",
  "CLEARED",
] as const;
export type SuspectStatus = (typeof SuspectStatus)[number];

export const RiskLevel = [
  "UNKNOWN",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type RiskLevel = (typeof RiskLevel)[number];

export const CaseStatus = [
  "UNKNOWN",
  "OPEN",
  "ACTIVE",
  "CLOSED",
  "ARCHIVED",
] as const;
export type CaseStatus = (typeof CaseStatus)[number];

export const CasePriority = [
  "UNKNOWN",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type CasePriority = (typeof CasePriority)[number];

export const FlagStatus = [
  "UNKNOWN",
  "NORMAL",
  "SUSPICIOUS",
  "FLAGGED",
] as const;
export type FlagStatus = (typeof FlagStatus)[number];

export const SuspectLinkType = [
  "UNKNOWN",
  "FINANCIAL_TRANSFER",
  "PHONE_CONTACT",
  "SHARED_ADDRESS",
  "SHARED_DEVICE",
  "SHARED_IP",
  "MANUAL",
] as const;
export type SuspectLinkType = (typeof SuspectLinkType)[number];

export const LinkConfidence = [
  "UNKNOWN",
  "LOW",
  "MEDIUM",
  "HIGH",
] as const;
export type LinkConfidence = (typeof LinkConfidence)[number];

export const AlertSeverity = [
  "UNKNOWN",
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type AlertSeverity = (typeof AlertSeverity)[number];

export const EvidenceSourceType = [
  "UNKNOWN",
  "TRANSACTION",
  "SUSPECT",
  "CALL_RECORD",
  "BANK_ACCOUNT",
  "PHONE_NUMBER",
  "SUSPECT_LINK",
] as const;
export type EvidenceSourceType = (typeof EvidenceSourceType)[number];

// === EnumStringMap (ported from Models/DomainEnums.cs) =====================
// Maps any incoming representation (PascalCase "FinancialTransfer", canonical
// "FINANCIAL_TRANSFER", or lower-case) onto the canonical UPPERCASE form so
// existing rows continue to round-trip. Unknown / blank input falls back to
// the enum's first member (always "UNKNOWN").

function insertSnakeBreaks(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i > 0 ? s[i - 1] : "";
    const isUpper = c >= "A" && c <= "Z";
    const prevUpper = prev >= "A" && prev <= "Z";
    if (i > 0 && isUpper && !prevUpper) out += "_";
    out += c;
  }
  return out;
}

export function toCanonical(value: string): string {
  if (!value) return "";
  return insertSnakeBreaks(value).toUpperCase();
}

// Normalise `raw` to a member of `members`, defaulting to members[0]
// ("UNKNOWN") when it cannot be matched — mirrors FromCanonical's `default`.
export function fromCanonical<T extends string>(
  members: readonly T[],
  raw: string | null | undefined
): T {
  const fallback = members[0];
  if (!raw || !raw.trim()) return fallback;
  const canonical = toCanonical(raw.trim());
  const direct = members.find((m) => m === canonical);
  if (direct) return direct;
  // Case-insensitive match against the underscored form.
  const ci = members.find((m) => m.toLowerCase() === raw.trim().toLowerCase());
  return ci ?? fallback;
}
