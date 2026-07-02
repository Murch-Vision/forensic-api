/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : peopleService.ts
 * Created at  : 2026-07-02
 * Updated at  : 2026-07-02
 * Author      : autopilot
 * Purpose     : Global people database — groups suspect records that belong
 *               to the same human being across every case (matched by
 *               normalized name, shared phone number or national id) and
 *               aggregates cases, identifiers and activity per person.
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import type {
  BankAccount,
  CaseFile,
  EvidenceEntry,
  PhoneNumber,
  Suspect,
} from "../models/types";

export interface PersonCaseRef {
  caseFile      : CaseFile;
  suspectId     : number;
  exhibitNumber : number;
  severity      : string;
  taggedAtUtc   : string;
}

export interface GlobalPerson {
  key              : string;
  fullName         : string;
  aliases          : string[];
  riskLevel        : string;
  photoData        : string | null;
  occupation       : string | null;
  nationalId       : string | null;
  matchedBy        : string[];
  suspects         : Suspect[];
  cases            : PersonCaseRef[];
  phoneNumbers     : string[];
  accountNumbers   : string[];
  transactionCount : number;
  callRecordCount  : number;
}

const RISK_ORDER = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

// Match numbers on their local significant digits (country codes vary
// between imports of the same person).
function normalizePhone(num: string | null): string | null {
  if (!num) return null;
  const digits = num.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits.slice(-8);
}

// Minimal union-find over suspect ids.
class UnionFind {
  private parent = new Map<number, number>();

  find(x: number): number {
    let p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export class PeopleService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  async getGlobalPeople(): Promise<GlobalPerson[]> {
    const [suspects, phones, accounts, evidence, caseFiles] =
      await Promise.all([
        this.db<Suspect>("suspects").orderBy("fullName", "asc"),
        this.db<PhoneNumber>("phone_numbers"),
        this.db<BankAccount>("bank_accounts"),
        this.db<EvidenceEntry>("evidence_entries")
          .where({sourceType: "SUSPECT"}),
        this.db<CaseFile>("case_files"),
      ]);

    const txnCounts = await this.db("bank_transactions")
      .select("bankAccountId").count({n: "id"}).groupBy("bankAccountId");
    const callCounts = await this.db("call_records")
      .whereNotNull("suspectId")
      .select("suspectId").count({n: "id"}).groupBy("suspectId");

    const phonesBySuspect = new Map<number, PhoneNumber[]>();
    for (const p of phones) {
      if (p.suspectId == null) continue;
      const list = phonesBySuspect.get(p.suspectId) ?? [];
      list.push(p);
      phonesBySuspect.set(p.suspectId, list);
    }
    const accountsBySuspect = new Map<number, BankAccount[]>();
    for (const a of accounts) {
      if (a.suspectId == null) continue;
      const list = accountsBySuspect.get(a.suspectId) ?? [];
      list.push(a);
      accountsBySuspect.set(a.suspectId, list);
    }
    const txnByAccount = new Map<number, number>();
    for (const r of txnCounts as Array<{bankAccountId: number; n: number}>) {
      txnByAccount.set(Number(r.bankAccountId), Number(r.n));
    }
    const callsBySuspect = new Map<number, number>();
    for (const r of callCounts as Array<{suspectId: number; n: number}>) {
      callsBySuspect.set(Number(r.suspectId), Number(r.n));
    }
    const caseById = new Map<number, CaseFile>();
    for (const cf of caseFiles) caseById.set(cf.id, cf);

    // Group suspect records that describe the same human: identical
    // normalized name, shared phone number, or identical national id.
    const uf = new UnionFind();
    const matchReason = new Map<number, Set<string>>();
    const byKey = new Map<string, {suspectId: number; reason: string}>();

    const claim = (suspectId: number, key: string, reason: string): void => {
      const prior = byKey.get(key);
      if (!prior) { byKey.set(key, {suspectId, reason}); return; }
      uf.union(prior.suspectId, suspectId);
      for (const id of [prior.suspectId, suspectId]) {
        const set = matchReason.get(id) ?? new Set<string>();
        set.add(reason);
        matchReason.set(id, set);
      }
    };

    for (const s of suspects) {
      uf.find(s.id);
      claim(s.id, `name:${normalizeName(s.fullName)}`, "NAME");
      if (s.nationalId) claim(s.id, `nid:${s.nationalId.trim()}`, "NATIONAL_ID");
      const nums = new Set<string>();
      const primary = normalizePhone(s.primaryPhone);
      if (primary) nums.add(primary);
      for (const p of phonesBySuspect.get(s.id) ?? []) {
        const n = normalizePhone(p.number);
        if (n) nums.add(n);
      }
      for (const n of nums) claim(s.id, `phone:${n}`, "PHONE");
    }

    const groups = new Map<number, Suspect[]>();
    for (const s of suspects) {
      const root = uf.find(s.id);
      const list = groups.get(root) ?? [];
      list.push(s);
      groups.set(root, list);
    }

    const evidenceBySuspect = new Map<number, EvidenceEntry[]>();
    for (const e of evidence) {
      const list = evidenceBySuspect.get(e.sourceId) ?? [];
      list.push(e);
      evidenceBySuspect.set(e.sourceId, list);
    }

    const people: GlobalPerson[] = [];
    for (const [root, members] of groups) {
      const reasons = new Set<string>();
      const phoneSet = new Set<string>();
      const accountSet = new Set<string>();
      const aliasSet = new Set<string>();
      const cases: PersonCaseRef[] = [];
      const seenCaseIds = new Set<number>();
      let riskLevel = "UNKNOWN";
      let transactionCount = 0;
      let callRecordCount = 0;
      let photoData: string | null = null;
      let occupation: string | null = null;
      let nationalId: string | null = null;

      for (const s of members) {
        for (const r of matchReason.get(s.id) ?? []) reasons.add(r);
        if (s.aliases) aliasSet.add(s.aliases);
        if (s.primaryPhone) phoneSet.add(s.primaryPhone);
        if (!photoData && s.photoData) photoData = s.photoData;
        if (!occupation && s.occupation) occupation = s.occupation;
        if (!nationalId && s.nationalId) nationalId = s.nationalId;
        if (RISK_ORDER.indexOf(s.riskLevel) > RISK_ORDER.indexOf(riskLevel)) {
          riskLevel = s.riskLevel;
        }
        for (const p of phonesBySuspect.get(s.id) ?? []) {
          phoneSet.add(p.number);
        }
        for (const a of accountsBySuspect.get(s.id) ?? []) {
          accountSet.add(a.accountNumber);
          transactionCount += txnByAccount.get(a.id) ?? 0;
        }
        callRecordCount += callsBySuspect.get(s.id) ?? 0;
        for (const e of evidenceBySuspect.get(s.id) ?? []) {
          const cf = caseById.get(e.caseFileId);
          if (!cf || seenCaseIds.has(cf.id)) continue;
          seenCaseIds.add(cf.id);
          cases.push({
            caseFile      : cf,
            suspectId     : s.id,
            exhibitNumber : e.exhibitNumber,
            severity      : e.severity,
            taggedAtUtc   : e.taggedAtUtc,
          });
        }
      }

      cases.sort((a, b) => b.taggedAtUtc.localeCompare(a.taggedAtUtc));
      people.push({
        key            : `person-${root}`,
        fullName       : members[0].fullName,
        aliases        : [...aliasSet],
        riskLevel,
        photoData,
        occupation,
        nationalId,
        matchedBy      : [...reasons],
        suspects       : members,
        cases,
        phoneNumbers   : [...phoneSet],
        accountNumbers : [...accountSet],
        transactionCount,
        callRecordCount,
      });
    }

    // Cross-case people first, then the busiest.
    people.sort((a, b) =>
      b.cases.length - a.cases.length ||
      b.suspects.length - a.suspects.length ||
      a.fullName.localeCompare(b.fullName));
    return people;
  }
}
