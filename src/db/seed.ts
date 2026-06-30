/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : seed.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import db from "./knex";
import {SuspectService} from "../services/suspectService";
import {AuditLogService} from "../services/auditLogService";
import type {Suspect} from "../models/types";

// Generates a small but analysis-rich dataset: suspects with shared
// addresses / counterparties so link generation, structuring, smurfing and
// transaction↔call correlation all surface something on every page.

function iso(year: number, month: number, day: number, hour = 12, min = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hour, min)).toISOString();
}

async function main(): Promise<void> {
  const svc = new SuspectService(db);
  const existing = await svc.getAllSuspects();
  if (existing.length > 0) {
    console.log(`Suspects already present (${existing.length}); skipping seed.`);
    await db.destroy();
    return;
  }

  const sharedAddress = "БГД, 1-р хороо, 12-р байр";
  const suspectsInput = [
    {fullName: "Болд Батбаяр", gender: "Male", city: "Улаанбаатар",
      country: "Монгол", primaryPhone: "+97699112233", address: sharedAddress,
      occupation: "Бизнес эрхлэгч", riskLevel: "HIGH",
      notes: "Санхүүгийн шилжүүлгийн сүлжээний гол зангилаа."},
    {fullName: "Гоё Должин", gender: "Female", city: "Дархан",
      country: "Монгол", primaryPhone: "+97688445566", address: sharedAddress,
      occupation: "Нягтлан бодогч", riskLevel: "CRITICAL",
      notes: "Олон данс хооронд эргэлдсэн гүйлгээ илэрсэн."},
    {fullName: "Тэмүүлэн Ганбат", gender: "Male", city: "Эрдэнэт",
      country: "Монгол", primaryPhone: "+97677889900", address: "Эрдэнэт, Баянгол",
      occupation: "Жолооч", riskLevel: "MEDIUM"},
  ];

  const suspects: Suspect[] = [];
  for (const s of suspectsInput) suspects.push(await svc.createSuspect(s));

  // Accounts — give each suspect one, with deterministic numbers.
  const accountNumbers = ["5001234001", "5001234002", "5001234003"];
  const accountIds: number[] = [];
  for (let i = 0; i < suspects.length; i++) {
    const [id] = await db("bank_accounts").insert({
      accountNumber     : accountNumbers[i],
      bankName          : "Хаан Банк",
      accountType       : "Current",
      currency          : "MNT",
      currentBalance    : 5_000_000 + i * 1_000_000,
      status            : "ACTIVE",
      suspectId         : suspects[i].id,
      accountHolderName : suspects[i].fullName,
      createdAt         : iso(2026, 1, 1),
    });
    accountIds.push(Number(id));
  }

  // Transactions — Bold's account receives smurfing-style small credits from
  // 3 sources and structures sub-threshold transfers to Goyo; a rapid burst.
  const txns: Record<string, unknown>[] = [];
  let running = 5_000_000;
  const push = (
    acct: number, ts: string, amount: number, type: string,
    counterparty: string | null, name: string | null, desc: string
  ) => {
    running += type === "credit" ? amount : -amount;
    txns.push({
      bankAccountId: acct, timestamp: ts, amount, type,
      category: type === "credit" ? "Орлого" : "Зарлага",
      description: desc, referenceNumber: `REF${txns.length + 1000}`,
      counterpartyAccount: counterparty, counterpartyName: name,
      channel: "Online", location: "Улаанбаатар", runningBalance: running,
      flagStatus: amount >= 17_000_000 ? "SUSPICIOUS" : "NORMAL",
    });
  };

  // Smurfing day: 4 small credits from distinct sources on 2026-03-02.
  push(accountIds[0], iso(2026, 3, 2, 9), 2_800_000, "credit", "9911", "Source A", "Орлого");
  push(accountIds[0], iso(2026, 3, 2, 10), 2_500_000, "credit", "9912", "Source B", "Орлого");
  push(accountIds[0], iso(2026, 3, 2, 11), 2_700_000, "credit", "9913", "Source C", "Орлого");
  push(accountIds[0], iso(2026, 3, 2, 12), 1_500_000, "credit", "9914", "Source D", "Орлого");
  // Structuring: 3 sub-threshold transfers to Goyo's account in one ISO week.
  push(accountIds[0], iso(2026, 3, 9, 14), 7_000_000, "debit", "5001234002", "Гоё Должин", "Шилжүүлэг");
  push(accountIds[0], iso(2026, 3, 10, 15), 7_500_000, "debit", "5001234002", "Гоё Должин", "Шилжүүлэг");
  push(accountIds[0], iso(2026, 3, 11, 16), 8_000_000, "debit", "5001234002", "Гоё Должин", "Шилжүүлэг");
  // Rapid burst (5 within 8 min) high-value.
  for (let k = 0; k < 5; k++) {
    push(accountIds[0], iso(2026, 3, 15, 2, k * 2), 1_500_000 + k * 100_000, "debit",
      `7${k}`, `Cp${k}`, "Шөнийн гүйлгээ");
  }
  // Routine txns for Goyo + Temuulen with varied leading digits.
  for (let m = 0; m < 25; m++) {
    push(accountIds[1], iso(2026, 2, (m % 27) + 1, 8 + (m % 10)),
      300_000 + (m * 137_000) % 4_000_000, m % 3 === 0 ? "credit" : "debit",
      "8800", "Зах зээл", "Гүйлгээ");
  }
  for (let m = 0; m < 20; m++) {
    push(accountIds[2], iso(2026, 2, (m % 27) + 1, 10 + (m % 8)),
      120_000 + (m * 91_000) % 2_000_000, m % 2 === 0 ? "credit" : "debit",
      "7700", "Тээвэр", "Гүйлгээ");
  }
  await db("bank_transactions").insert(txns);

  // Phones — Bold and Temuulen share an IMEI (shared-device link).
  const phoneIds: number[] = [];
  const phones = [
    {number: "+97699112233", provider: "Mobicom", imei: "356789104567890",
      phoneType: "Mobile", status: "ACTIVE", suspectId: suspects[0].id},
    {number: "+97688445566", provider: "Unitel", imei: "356789104567891",
      phoneType: "Mobile", status: "ACTIVE", suspectId: suspects[1].id},
    {number: "+97677889900", provider: "Mobicom", imei: "356789104567890",
      phoneType: "Mobile", status: "ACTIVE", suspectId: suspects[2].id},
  ];
  for (const p of phones) {
    const [id] = await db("phone_numbers").insert(p);
    phoneIds.push(Number(id));
  }

  // Calls — Bold↔Goyo calls, some near transaction times (correlation).
  const calls: Record<string, unknown>[] = [];
  const addCall = (
    phoneId: number, caller: string, called: string, ts: string, dur: number,
    location = "Улаанбаатар"
  ) => calls.push({
    callerNumber: caller, calledNumber: called, startTime: ts,
    durationSeconds: dur, callType: "Voice", direction: "Outgoing",
    location, phoneNumberId: phoneId,
    suspectId: phoneId === phoneIds[0] ? suspects[0].id : suspects[1].id,
  });
  // Call ~10 min before each structuring transfer → CRITICAL correlation.
  // This one is routed through Эрдэнэт while the money moved in Улаанбаатар →
  // also a travel-correlation hit (the suspect can't be in two places).
  addCall(phoneIds[0], "+97699112233", "+97688445566",
    iso(2026, 3, 9, 13, 50), 120, "Эрдэнэт");
  addCall(phoneIds[0], "+97699112233", "+97688445566", iso(2026, 3, 10, 14, 45), 95);
  addCall(phoneIds[1], "+97688445566", "+97699112233", iso(2026, 3, 11, 15, 40), 210);
  // A burst of 5 calls within 20 minutes from Bold.
  for (let k = 0; k < 5; k++) {
    addCall(phoneIds[0], "+97699112233", "+97670000000", iso(2026, 3, 20, 21, k * 4), 40);
  }
  await db("call_records").insert(calls);

  // Case file + audit trail.
  await db("case_files").insert({
    caseId: "CASE-0001", caseName: "Мөнгө угаах сүлжээ",
    description: "Болд Батбаярын удирдсан санхүүгийн сүлжээ.",
    status: "ACTIVE", priority: "HIGH", leadInvestigator: "Мөрдөгч Д.",
    caseType: "Money Laundering", createdAt: iso(2026, 1, 5),
    updatedAt: iso(2026, 3, 1),
  });
  // Write audit rows through the hash-chained service so the chain verifies.
  const audit = new AuditLogService(db);
  await audit.record("Case.Create", "CaseFile:1", "CASE-0001 үүсгэв",
    "INFO", "investigator");
  await audit.record("Import.Run", "BankTransaction", "Гүйлгээ импортлов",
    "INFO", "system");

  console.log(
    `Seeded ${suspects.length} suspects, ${accountIds.length} accounts, ` +
    `${txns.length} transactions, ${phones.length} phones, ${calls.length} calls.`
  );
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
