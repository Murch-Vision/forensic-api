/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : bankLookupService.ts
 * Created at  : 2026-09-24
 * Updated at  : 2026-09-24
 * Author      : jeefo
 * Purpose     : Дансны дугаараар банк, бүтэн IBAN, эзэмшигчийн нэрийг
 *               Голомт банкны нийтийн IBAN лавлагаанаас (egolomt.mn/cam/check)
 *               тодорхойлж, банк нь эсвэл эзэмшигч нь тодорхойгүй дансыг
 *               нөхнө.
 * Description : Монгол IBAN = MN + check(2) + bank code(4) + данс 12 орон
 *               болтол 0-ээр дүүргэсэн. "MN00…" (check хэзээ ч 00 биш) эсвэл
 *               MN-гүй дугаар = банк нь тодорхойгүй импорт → бүх банкаар хайна.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";
import type {BankAccount, Suspect} from "../models/types";

const API = "https://egolomt.mn/api";
const TIMEOUT_MS = 15_000;

// "150000|GLMTMNUB" — the bank id the lookup form posts.
interface LookupBank {cmCode: string; cdDesc: string}

const GOLOMT: LookupBank = {cmCode: "150000|GLMTMNUB", cdDesc: "Голомт банк"};

// Banks to try first when the bank is unknown (most accounts are here).
const SEARCH_ORDER = ["AGMOMNUB", "GLMTMNUB", "TDBMMNUB", "CAXBMNUB",
  "STBMMNUB", "BOGDMNUB", "CHKHMNUB", "CPITMNUB", "ARGBMNUB", "MBNKMNUB",
  "TRDMMNUB", "NAIMMNUB"];

// Too short a number matches some random account in some bank.
const MIN_ACCOUNT_DIGITS = 6;

export interface BankLookupHit {
  iban       : string;
  bankName   : string;
  holderName : string;
}

export interface BankAccountVerification {
  accountNumber : string;
  found         : boolean;
  iban          : string | null;
  bankName      : string | null;
  holderName    : string | null;
  // The person's name was an account number / placeholder and got replaced.
  nameUpdated   : boolean;
  message       : string;
}

function ibanChecksum(bban: string): string {
  // MN → M=22, N=23; country + "00" moves to the end (ISO 13616 mod-97).
  const n = BigInt(`${bban}222300`) % 97n;
  return String(98 - Number(n)).padStart(2, "0");
}

// Valid Mongolian IBAN → {bankCode, account}; anything else → null.
export function parseMnIban(value: string):
  {iban: string; bankCode: string; account: string} | null {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^MN\d{18}$/.test(iban)) return null;
  if (ibanChecksum(iban.slice(4)) !== iban.slice(2, 4)) return null;
  return {iban, bankCode: iban.slice(4, 8), account: iban.slice(8)};
}

function isPlaceholder(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return !text || /^[-–—_.]+$/.test(text)
    || /^(unknown|null|n\/?a|тодорхойгүй)$/i.test(text);
}

// A person "name" that is really an account number / IBAN (what the import
// writes when the statement carries no owner name).
export function isNumberLikeName(name: string | null | undefined): boolean {
  if (isPlaceholder(name)) return true;
  return /^[A-Z]{0,2}\d[\d\s-]*$/i.test(String(name).trim());
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}?language=mn`, {
    method : body === undefined ? "GET" : "POST",
    headers: {"Content-Type": "application/json"},
    body   : body === undefined ? undefined : JSON.stringify({
      header: {languageId: "001", time: new Date().toISOString()}, body}),
    signal : AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null) as
    {header?: {code?: number; message?: string}; body?: T} | null;
  if (!res.ok || json?.header?.code !== 200) {
    throw new Error(`IBAN лавлагаа: ${json?.header?.message ?? res.status}`);
  }
  return json.body as T;
}

export class BankLookupService {
  private readonly db: Knex;
  private banks: Promise<LookupBank[]> | null = null;

  constructor(db: Knex) {
    this.db = db;
  }

  private fetchBanks(): Promise<LookupBank[]> {
    this.banks ??= call<LookupBank[]>("/utility/reference/public/OUB")
      .then((list) => [GOLOMT, ...list])
      .catch((e) => { this.banks = null; throw e; });
    return this.banks;
  }

  // One bank + account. null = the bank has no such account.
  private async lookup(bank: LookupBank, account: string):
    Promise<BankLookupHit | null> {
    const r = await call<{accountIban?: string; accountName?: string}>(
      "/account/cam/virtual", {value: account, bankId: bank.cmCode});
    if (!r?.accountIban) return null;
    return {iban: r.accountIban, bankName: bank.cdDesc,
      holderName: String(r.accountName ?? "").trim()};
  }

  // Unknown bank: try every bank (common ones first, 5 at a time).
  private async search(account: string): Promise<BankLookupHit | null> {
    const swift = (b: LookupBank) => b.cmCode.split("|")[1];
    const rank = (b: LookupBank) => {
      const i = SEARCH_ORDER.indexOf(swift(b));
      return i < 0 ? SEARCH_ORDER.length : i;
    };
    const banks = [...await this.fetchBanks()].sort((a, b) => rank(a) - rank(b));
    for (let i = 0; i < banks.length; i += 5) {
      const hits = await Promise.all(banks.slice(i, i + 5)
        .map((b) => this.lookup(b, account).catch(() => null)));
      const hit = hits.find((h): h is BankLookupHit => h !== null);
      if (hit) return hit;
    }
    return null;
  }

  // Any stored account number → bank, full IBAN and holder name.
  async resolve(accountNumber: string): Promise<BankLookupHit | null> {
    const parsed = parseMnIban(accountNumber);
    if (parsed) {
      // "0005" ↔ "050000|AGMOMNUB"
      const bank = (await this.fetchBanks()).find((b) =>
        parsed.bankCode.startsWith("00")
        && b.cmCode.slice(0, 2) === parsed.bankCode.slice(2));
      if (bank) {
        const hit = await this.lookup(bank, parsed.account);
        if (hit) return hit;
      }
    }
    // "MN00000005629169366", "000000005629169366", "5629169366" …
    const digits = accountNumber.replace(/\s+/g, "").toUpperCase()
      .replace(/^MN/, "").replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length < MIN_ACCOUNT_DIGITS) return null;
    return this.search(digits);
  }

  // Look the stored account up and fill in what is missing: bank, IBAN,
  // holder name — and the person's name when it is only a number.
  async verifyAccount(accountNumber: string): Promise<BankAccountVerification> {
    const account = await this.db<BankAccount>("bank_accounts")
      .where({accountNumber}).first();
    if (!account) throw new Error("Данс олдсонгүй.");

    const hit = await this.resolve(account.accountNumber);
    if (!hit) {
      return {accountNumber, found: false, iban: null, bankName: null,
        holderName: null, nameUpdated: false,
        message: "Аль ч банкнаас энэ данс олдсонгүй."};
    }

    let nameUpdated = false;
    await this.db.transaction(async (trx) => {
      const holderStale = isPlaceholder(account.accountHolderName)
        || isNumberLikeName(account.accountHolderName);
      await trx("bank_accounts").where({id: account.id}).update({
        iban    : hit.iban,
        bankName: hit.bankName,
        ...(holderStale && hit.holderName
          ? {accountHolderName: hit.holderName} : {}),
      });

      if (account.suspectId == null || !hit.holderName) return;
      const suspect = await trx<Suspect>("suspects")
        .where({id: account.suspectId}).first();
      if (!suspect || !isNumberLikeName(suspect.fullName)) return;

      const oldName = String(suspect.fullName ?? "").trim();
      await trx("suspects").where({id: suspect.id}).update({
        fullName : hit.holderName,
        updatedAt: new Date().toISOString(),
      });
      // Same rule as a manual rename: holder names that only mirrored the
      // old number-name follow the person.
      await trx("bank_accounts").where({suspectId: suspect.id})
        .where((q) => q.whereNull("accountHolderName")
          .orWhere("accountHolderName", "")
          .orWhere("accountHolderName", oldName)
          .orWhereRaw("trim(accountHolderName) = trim(accountNumber)"))
        .update({accountHolderName: hit.holderName});
      nameUpdated = true;
    });

    return {
      accountNumber,
      found     : true,
      iban      : hit.iban,
      bankName  : hit.bankName,
      holderName: hit.holderName || null,
      nameUpdated,
      message   : nameUpdated
        ? `${hit.bankName} · нэрийг "${hit.holderName}" болгож шинэчиллээ.`
        : `${hit.bankName} · ${hit.holderName}`,
    };
  }
}
