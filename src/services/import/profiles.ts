/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : profiles.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-24
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {NormalizedTable} from "./tabularReader";

// Ported from Services/Import/{ImportProfile,ProfileDetector,BankProfiles,
// CdrProfiles,AccessLogProfiles}.cs.

export type ImportDomain = "BANK" | "CDR" | "ACCESS_LOG";
export type AmountStyle = "SIGNED" | "SPLIT_CREDIT_DEBIT";
export type DurationUnit = "SECONDS" | "MINUTES";

export interface ImportProfile {
  id: string;
  displayName: string;
  domain: ImportDomain;
  requiredHeaders: string[];
  optionalHeaders: string[];
  fieldMap: Record<string, string[]>;
  amountStyle?: AmountStyle;
  durationUnit?: DurationUnit;
}

export interface DetectionResult {
  profile: ImportProfile | null;
  domain: ImportDomain | null;
  confidence: "LOW" | "HIGH";
  proposedMapping: Record<string, string>;
  reasons: string[];
}

const BANK_PROFILES: ImportProfile[] = [
  {
    id: "Mn-17col-Signed", displayName: "Дансны хуулга (17 багана)",
    domain: "BANK", amountStyle: "SIGNED",
    requiredHeaders: ["Гүйлгээний огноо", "Гүйлгээний дүн", "Гүйлгээний утга",
      "Регистрийн дугаар"],
    optionalHeaders: ["Харьцсан регистрийн дугаар", "Журнал", "Гүйлгээний дугаар"],
    fieldMap: {
      date: ["Гүйлгээний огноо"], amount: ["Гүйлгээний дүн"],
      description: ["Гүйлгээний утга"], counterpartyAccount: ["Харьцсан данс"],
      counterpartyName: ["Харьцсан харилцагчийн нэр"],
      account: ["Данс", "Дансны дугаар"],
    },
  },
  {
    id: "Mn-16col-Signed", displayName: "Дансны хуулга (16 багана)",
    domain: "BANK", amountStyle: "SIGNED",
    requiredHeaders: ["Гүйлгээний огноо", "Гүйлгээний дүн", "Цаг"],
    optionalHeaders: [],
    fieldMap: {
      date: ["Гүйлгээний огноо"], amount: ["Гүйлгээний дүн"],
      description: ["Гүйлгээний утга"], counterpartyAccount: ["Харьцсан данс"],
      counterpartyName: ["Харьцсан харилцагчийн нэр"],
      account: ["Данс", "Дансны дугаар"],
    },
  },
  {
    id: "En-Operative", displayName: "Operative statement (EN)",
    domain: "BANK", amountStyle: "SIGNED",
    requiredHeaders: ["tranDate", "amount", "balance"],
    optionalHeaders: [],
    fieldMap: {
      date: ["tranDate"], amount: ["amount"], description: ["description"],
      balance: ["balance"], counterpartyAccount: ["relatedAccount"],
      account: ["account", "accountNumber"],
    },
  },
  {
    id: "Mn-Split-Simple", displayName: "Орлого/Зарлага хуулга",
    domain: "BANK", amountStyle: "SPLIT_CREDIT_DEBIT",
    requiredHeaders: ["Гүйлгээний огноо", "Орлого", "Зарлага", "Үлдэгдэл"],
    optionalHeaders: [],
    fieldMap: {
      date: ["Гүйлгээний огноо"], credit: ["Орлого"], debit: ["Зарлага"],
      balance: ["Үлдэгдэл"], description: ["Гүйлгээний утга"],
      counterpartyAccount: ["Харьцсан данс"],
      account: ["Данс", "Дансны дугаар"],
    },
  },
  {
    id: "Mn-Xac-Merged", displayName: "ХасБанк хуулга (нэгтгэсэн)",
    domain: "BANK", amountStyle: "SPLIT_CREDIT_DEBIT",
    requiredHeaders: ["Огноо", "Орлого", "Зарлага", "Гүйлгээний утга"],
    optionalHeaders: [],
    fieldMap: {
      date: ["Огноо"], credit: ["Орлого"], debit: ["Зарлага"],
      balance: ["Үлдэгдэл"], description: ["Гүйлгээний утга"],
      counterpartyAccount: ["Харьцсан данс"],
      counterpartyName: ["Харьцсан дансны нэр"],
      account: ["Данс", "Дансны дугаар"],
    },
  },
];

const CDR_PROFILES: ImportProfile[] = [
  {
    id: "Call-Bill", displayName: "Ярианы билл (CDR)", domain: "CDR",
    durationUnit: "MINUTES",
    requiredHeaders: ["callstart", "callerid", "callednum"],
    optionalHeaders: [],
    fieldMap: {
      caller: ["callerid", "caller", "calling"],
      called: ["callednum", "called"],
      datetime: ["callstart", "datetime", "starttime"],
      duration: ["duration_min", "duration", "duration minut", "minut"],
      direction: ["direction", "call direction"],
    },
  },
];

const ACCESS_LOG_PROFILES: ImportProfile[] = [
  {
    id: "Web-Access-Log", displayName: "IP-тай данс (web access)",
    domain: "ACCESS_LOG",
    requiredHeaders: ["Transaction Time", "User", "IP Address"],
    optionalHeaders: [],
    fieldMap: {
      timestamp: ["Transaction Time"], accountId: ["User"],
      fullName: ["Full Name"], uuid: ["UUID"], fingerprint: ["fingerprint"],
      userAgent: ["userAgent"], ip: ["IP Address"],
    },
  },
  {
    id: "Device-Log", displayName: "Төхөөрөмжийн лог (УТАС)",
    domain: "ACCESS_LOG",
    requiredHeaders: ["DEVICE_ID", "USER_ID", "ORIGINATION"],
    optionalHeaders: [],
    fieldMap: {
      timestamp: ["CREATE_TS", "ST_TM"], accountId: ["USER_ID"],
      uuid: ["DEVICE_ID"], ip: ["ORIGINATION"],
      deviceModel: ["MODEL", "DEVICE_NAME"], deviceMake: ["MAKE"],
      os: ["OS"], osVersion: ["OS_VERSION"],
    },
  },
];

const ALL_PROFILES = [...BANK_PROFILES, ...CDR_PROFILES, ...ACCESS_LOG_PROFILES];

const norm = (s: string) => (s ?? "").trim().toLowerCase();

function score(p: ImportProfile, headers: Set<string>): number {
  const req = p.requiredHeaders.length;
  const reqHit = p.requiredHeaders.filter((h) => headers.has(norm(h))).length;
  if (req > 0 && reqHit < req) return (reqHit / req) * 0.5;
  if (p.optionalHeaders.length === 0) return 0.8;
  const optHit = p.optionalHeaders.filter((h) => headers.has(norm(h))).length;
  return 0.8 + 0.2 * (optHit / p.optionalHeaders.length);
}

function resolveMapping(
  p: ImportProfile,
  headers: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  const normToActual = new Map<string, string>();
  for (const h of headers) {
    if (!normToActual.has(norm(h))) normToActual.set(norm(h), h);
  }
  for (const [field, aliases] of Object.entries(p.fieldMap)) {
    for (const alias of aliases) {
      const actual = normToActual.get(norm(alias));
      if (actual) {
        result[field] = actual;
        break;
      }
    }
  }
  return result;
}

export function detectProfile(table: NormalizedTable): DetectionResult {
  const headerSet = new Set(table.headers.map(norm));
  let best: ImportProfile | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const p of ALL_PROFILES) {
    const s = score(p, headerSet);
    if (s > bestScore) {
      secondScore = bestScore;
      bestScore = s;
      best = p;
    } else if (s > secondScore) {
      secondScore = s;
    }
  }
  if (!best || bestScore < 0.6) {
    return {
      profile: null, domain: null, confidence: "LOW", proposedMapping: {},
      reasons: ["No profile cleared the confidence floor."],
    };
  }
  const mapping = resolveMapping(best, table.headers);
  const clear = bestScore >= 0.8 && bestScore - secondScore >= 0.15;
  return {
    profile: best, domain: best.domain,
    confidence: clear ? "HIGH" : "LOW",
    proposedMapping: mapping,
    reasons: [`Best '${best.id}' score=${bestScore.toFixed(2)}, ` +
      `runner-up=${secondScore.toFixed(2)}`],
  };
}
