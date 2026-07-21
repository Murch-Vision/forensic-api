/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : reportService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-30
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
import path from "path";
import {createHash} from "crypto";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from "docx";
import type {DataService} from "./dataService";
import type {AuditChainVerdict} from "./auditLogService";
import type {BankAccount, BankTransaction, Suspect} from "../models/types";
import {formatDateLike} from "./reportFormat";

// Ported from Services/ReportService.cs — the PDF (was QuestPDF) and Excel
// (was ClosedXML) exporters. Output is returned as an in-memory Buffer so the
// GraphQL layer can hand it to the browser as a base64 download.

const DARK_BLUE = "#0A1628";
const ACCENT_CYAN = "#00B8D0";
// Redesigned-report palette.
const INK = "#1F2937";
const MUTED = "#6B7280";
const GREEN = "#167C4A";
const RED = "#C0202A";
const ZEBRA = "#F3F6FA";
const TABLE_HEAD = "#16324F";
const GREEN_TINT = "#EAF5EE";
const RED_TINT = "#FBEBEC";
const BLUE_TINT = "#EAF1F8";
// A4 content geometry (margin 40).
const ML = 40;
const CW = 515;

// Mongolian risk labels + swatches for the report.
const RISK_MN: Record<string, string> = {
  UNKNOWN: "Тодорхойгүй", LOW: "Бага", MEDIUM: "Дунд",
  HIGH: "Өндөр", CRITICAL: "Ноцтой",
};
const RISK_HEX: Record<string, string> = {
  UNKNOWN: "#6B7280", LOW: "#167C4A", MEDIUM: "#B7791F",
  HIGH: "#C0202A", CRITICAL: "#8B1A1A",
};

interface LedgerCol {
  label: string;
  x: number;
  w: number;
  align: "left" | "right";
}
const LEDGER_COLS: LedgerCol[] = [
  {label: "Огноо", x: 40, w: 66, align: "left"},
  {label: "Төрөл", x: 106, w: 40, align: "left"},
  {label: "Харьцсан тал", x: 146, w: 104, align: "left"},
  {label: "Гүйлгээний утга", x: 250, w: 128, align: "left"},
  {label: "Дүн", x: 378, w: 88, align: "right"},
  {label: "Үлдэгдэл", x: 466, w: 89, align: "right"},
];

// A Unicode TTF is required for Cyrillic; pdfkit's built-in Helvetica is
// WinAnsi-only. Try common system fonts, else fall back to Helvetica (Latin).
const FONT_CANDIDATES = [
  process.env.REPORT_FONT,
  // Bundled with the repo — the only reliably-present Cyrillic font, since the
  // server container has no system Unicode fonts.
  path.join(__dirname, "../../assets/fonts/ReportSans.ttf"),
  path.join(process.cwd(), "assets/fonts/ReportSans.ttf"),
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  // Present on the (Debian) server and carry Cyrillic — without one of these
  // pdfkit falls back to Latin-only Helvetica and Mongolian text turns to mojibake.
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
].filter((p): p is string => !!p);

function resolveFont(): string | null {
  for (const p of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export class ReportService {
  private readonly db: DataService;

  constructor(db: DataService) {
    this.db = db;
  }

  async generatePdf(verdict?: AuditChainVerdict): Promise<Buffer> {
    const suspects = await this.db.getSuspectsWithRelations();
    const stats = await this.db.getDashboardStats();
    const results = await this.db.getAllAnalysisResults();
    const links = await this.db.getAllLinks();
    const accounts = await this.db.getAllBankAccounts();
    const audit = await this.db.getAuditEvents(200);
    const nameById = new Map(suspects.map((s) => [s.id, s.fullName]));
    const acctById = new Map(accounts.map((a) => [a.id, a.accountNumber]));

    const doc = new PDFDocument({size: "A4", margin: 40});
    const font = resolveFont();
    const FONT = font ? "Body" : "Helvetica";
    if (font) doc.registerFont("Body", font);
    doc.font(FONT);

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    // Header band
    doc.rect(0, 0, doc.page.width, 70).fill(DARK_BLUE);
    doc.fillColor(ACCENT_CYAN).fontSize(18)
      .text("FORENSIC ANALYST WORKSTATION", 40, 18);
    doc.fillColor("#FFFFFF").fontSize(11)
      .text("Intelligence Assessment Report", 40, 40);
    doc.fillColor("#B0B8C4").fontSize(8).text(
      `Generated: ${formatDateLike(new Date().toISOString(), true)} | CONFIDENTIAL`,
      40, 55);
    doc.fillColor("#333333").y = 90;
    doc.x = 40;

    section(doc, "EXECUTIVE SUMMARY");
    const summary: [string, string][] = [
      ["Suspects", String(stats.totalSuspects)],
      ["Bank Accounts", String(stats.totalBankAccounts)],
      ["Transactions", stats.totalTransactions.toLocaleString("en-US")],
      ["Call Records", stats.totalCallRecords.toLocaleString("en-US")],
      ["High Risk", String(stats.highRiskSuspects)],
      ["Flagged Txns", String(stats.flaggedTransactions)],
      ["Links Found", String(stats.totalLinks)],
      ["Open Cases", String(stats.openCases)],
    ];
    doc.fontSize(10).fillColor("#333333");
    for (const [k, v] of summary) {
      doc.text(`${k}: `, {continued: true}).fillColor(DARK_BLUE)
        .text(v).fillColor("#333333");
    }

    // Keep the brief SHORT: only the highest-risk subjects and strongest
    // connections, never a dump of every record (that produced a 10+ page mess).
    const RISK_ORDER: Record<string, number> = {
      CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0,
    };
    const topSuspects = [...suspects]
      .sort((a, b) =>
        (RISK_ORDER[b.riskLevel] ?? 0) - (RISK_ORDER[a.riskLevel] ?? 0))
      .slice(0, 8);
    section(doc, "TOP SUBJECTS OF INTEREST");
    for (const s of topSuspects) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor(DARK_BLUE)
        .text(`${s.fullName}  [${s.riskLevel}]`);
      doc.fontSize(8).fillColor("#555555").text(
        `${[s.occupation, s.organization, s.city].filter(Boolean).join(" · ")
          || "—"} · ${s.bankAccounts.length} данс · ` +
        `${s.phoneNumbers.length} утас`);
    }

    const flagged = results
      .filter((r) => r.riskLevel === "HIGH" || r.riskLevel === "CRITICAL")
      .slice(0, 10);
    if (flagged.length > 0) {
      section(doc, "KEY ANALYSIS FLAGS");
      doc.fontSize(8).fillColor("#333333");
      for (const r of flagged) {
        doc.text(`${acctById.get(r.bankAccountId) ?? "N/A"} · ` +
          `${r.riskLevel} · ${r.verdict ?? ""}`);
      }
    }

    if (links.length > 0) {
      section(doc, `TOP CONNECTIONS (${links.length} нийт)`);
      doc.fontSize(8).fillColor("#333333");
      const topLinks = [...links]
        .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0)).slice(0, 12);
      for (const l of topLinks) {
        doc.text(
          `${nameById.get(l.sourceSuspectId) ?? l.sourceSuspectId} ↔ ` +
          `${nameById.get(l.targetSuspectId) ?? l.targetSuspectId} · ` +
          `[${l.linkType}]`);
      }
    }

    section(doc, "CHAIN OF CUSTODY");
    if (verdict) {
      doc.fontSize(9).fillColor(verdict.valid ? "#1B7A3D" : "#B00020").text(
        verdict.valid
          ? `Audit hash chain VERIFIED — ${audit.length} events, `
            + "SHA-256 intact."
          : `Audit hash chain BROKEN at row ${verdict.brokenAt}.`);
    }

    doc.end();
    return done;
  }

  // Per-suspect financial report (Mongolian): the subject's profile, totals
  // cards, per-account summary and the full transaction ledger.
  async generateSuspectPdf(
    suspectId: number, minAmount = 0
  ): Promise<Buffer> {
    const suspect = await this.db.getSuspectById(suspectId);
    if (!suspect) throw new Error(`Suspect ${suspectId} not found`);
    const accounts = (await this.db.getAllBankAccounts())
      .filter((a) => a.suspectId === suspectId);
    const txns = (await this.db.getTransactionsForSuspect(suspectId))
      .filter((t) => t.amount >= minAmount);

    const {doc, done} = startDoc();
    formalHeader(doc, "Дансанд үзлэг хийсэн тухай тайлан");
    renderSuspect(doc, {...suspect, bankAccounts: accounts}, txns);
    drawFooters(doc);
    doc.end();
    return done;
  }

  // Marked-suspects report (Mongolian): every person flagged
  // UNDER_INVESTIGATION. Only transactions BETWEEN the marked suspects are
  // listed (ordered by time), with per-suspect totals, counts and date spans
  // and a cover breakdown table.
  async generateMarkedSuspectsPdf(minAmount = 0): Promise<Buffer> {
    const marked = (await this.db.getSuspectsWithRelations())
      .filter((s) => s.status === "UNDER_INVESTIGATION");
    if (marked.length === 0) {
      throw new Error(
        "Тэмдэглэсэн сэжигтэн алга. Эхлээд хүнийг сэжигтэн болгож тэмдэглэнэ үү.");
    }

    // Cross-reference index: which account numbers / national-ids / names
    // belong to a marked suspect, so a transaction's counterparty can be
    // resolved back to another marked suspect.
    const markedIds = new Set(marked.map((s) => s.id));
    const ownerByAccount = new Map<string, number>();
    for (const a of await this.db.getAllBankAccounts()) {
      if (a.suspectId != null && markedIds.has(a.suspectId)) {
        ownerByAccount.set(a.accountNumber, a.suspectId);
      }
    }
    const natIdToSuspect = new Map<string, number>();
    const nameToSuspect = new Map<string, number>();
    for (const s of marked) {
      if (s.nationalId) natIdToSuspect.set(s.nationalId, s.id);
      nameToSuspect.set(normName(s.fullName), s.id);
    }
    // A transaction is "between suspects" when its counterparty resolves to a
    // DIFFERENT marked suspect (by account, national-id or name).
    const counterpartySuspect = (t: BankTransaction, selfId: number): number
      | null => {
      if (t.counterpartyAccount) {
        const o = ownerByAccount.get(t.counterpartyAccount);
        if (o != null && o !== selfId) return o;
      }
      if (t.counterpartyNationalId) {
        const o = natIdToSuspect.get(t.counterpartyNationalId);
        if (o != null && o !== selfId) return o;
      }
      const byName = nameToSuspect.get(normName(t.counterpartyName));
      if (byName != null && byName !== selfId) return byName;
      return null;
    };

    // Per suspect: only inter-suspect transactions at/above the threshold,
    // kept ascending by time.
    const blocks = await Promise.all(marked.map(async (s) => {
      const all = await this.db.getTransactionsForSuspect(s.id);
      const txns = all.filter((t) =>
        t.amount >= minAmount && counterpartySuspect(t, s.id) != null);
      const {income, outgoing} = totals(txns);
      return {suspect: s, txns, income, outgoing, range: dateRange(txns)};
    }));

    const {doc, done} = startDoc();
    formalHeader(doc, "Дансанд үзлэг хийсэн тухай тайлан");

    // Report-level totals line (count + overall date span + threshold).
    const totalTxns = blocks.reduce((a, b) => a + b.txns.length, 0);
    const stamps = blocks.flatMap((b) => b.txns).map((t) => t.timestamp).sort();
    const span = stamps.length
      ? `${formatDateLike(stamps[0])} — ${formatDateLike(stamps[stamps.length - 1])}`
      : "—";
    const thresholdNote = minAmount > 0 ? `      Босго: ≥ ${mnt(minAmount)}` : "";
    doc.fontSize(9.5).fillColor(INK).text(
      `Тэмдэглэсэн сэжигтэн: ${marked.length}      ` +
      `Нийт хоорондын гүйлгээ: ${totalTxns}      Хугацаа: ${span}${thresholdNote}`,
      ML, doc.y, {width: CW, align: "center", lineBreak: false});
    doc.y += 20;

    // Cover breakdown table (no combined cards, no net — per request). Now
    // carries a bank-account count column.
    sectionBar(doc, `СЭЖИГТНҮҮД (${blocks.length})`);
    const summaryCols: LedgerCol[] = [
      {label: "Сэжигтэн", x: 40, w: 128, align: "left"},
      {label: "Данс", x: 168, w: 34, align: "right"},
      {label: "Гүйлгээ", x: 202, w: 40, align: "right"},
      {label: "Эхэлсэн", x: 242, w: 70, align: "left"},
      {label: "Дуусан", x: 312, w: 70, align: "left"},
      {label: "Орлого", x: 382, w: 87, align: "right"},
      {label: "Зарлага", x: 469, w: 86, align: "right"},
    ];
    drawTableHead(doc, summaryCols);
    blocks.forEach((b, i) => {
      const y = ensureRow(doc, summaryCols);
      if (i % 2 === 1) doc.rect(ML, y - 2, CW, 13).fill(ZEBRA);
      cell(doc, b.suspect.fullName, summaryCols[0], y, INK);
      cell(doc, String(b.suspect.bankAccounts.length), summaryCols[1], y, INK);
      cell(doc, String(b.txns.length), summaryCols[2], y, INK);
      cell(doc, b.range.from, summaryCols[3], y, MUTED);
      cell(doc, b.range.to, summaryCols[4], y, MUTED);
      cell(doc, mnt(b.income), summaryCols[5], y, GREEN);
      cell(doc, mnt(b.outgoing), summaryCols[6], y, RED);
      doc.y = y + 13;
    });
    // Grand-total row.
    const ty = ensureRow(doc, summaryCols);
    doc.moveTo(ML, ty - 2).lineTo(ML + CW, ty - 2).lineWidth(0.5)
      .strokeColor("#CBD5E1").stroke();
    cell(doc, "НИЙТ", summaryCols[0], ty, DARK_BLUE);
    cell(doc, String(blocks.reduce((a, b) => a + b.suspect.bankAccounts.length,
      0)), summaryCols[1], ty, DARK_BLUE);
    cell(doc, String(totalTxns), summaryCols[2], ty, DARK_BLUE);
    cell(doc, mnt(blocks.reduce((a, b) => a + b.income, 0)), summaryCols[5],
      ty, GREEN);
    cell(doc, mnt(blocks.reduce((a, b) => a + b.outgoing, 0)), summaryCols[6],
      ty, RED);
    doc.y = ty + 14;

    // One full section per suspect, each starting on a fresh page.
    for (const b of blocks) {
      doc.addPage();
      doc.y = 48;
      renderSuspect(doc, b.suspect, b.txns,
        {ledgerLabel: "СЭЖИГТНҮҮД ХООРОНДЫН ГҮЙЛГЭЭ"});
    }

    drawFooters(doc);
    doc.end();
    return done;
  }

  async generateExcel(): Promise<Buffer> {
    const suspects = await this.db.getSuspectsWithRelations();
    const transactions = await this.db.getAllTransactions();
    const calls = await this.db.getAllCallRecords();
    const results = await this.db.getAllAnalysisResults();
    const links = await this.db.getAllLinks();
    const accounts = await this.db.getAllBankAccounts();
    const acctById = new Map(accounts.map((a) => [a.id, a.accountNumber]));
    const nameById = new Map(suspects.map((s) => [s.id, s.fullName]));

    const wb = new ExcelJS.Workbook();

    addSheet(wb, "Suspects",
      ["SuspectId", "FullName", "Gender", "DOB", "Phone", "City", "Country",
        "Occupation", "Organization", "RiskLevel", "Status", "Accounts", "Phones"],
      suspects.map((s) => [s.suspectId, s.fullName, s.gender,
        formatDateLike(s.dateOfBirth), s.primaryPhone, s.city, s.country,
        s.occupation, s.organization, s.riskLevel, s.status,
        s.bankAccounts.length, s.phoneNumbers.length]));

    addSheet(wb, "Transactions",
      ["Account", "Timestamp", "Amount", "Type", "Category", "Description",
        "CounterpartyAccount", "CounterpartyName", "Channel", "RunningBalance",
        "FlagStatus"],
      transactions.map((t) => [acctById.get(t.bankAccountId) ?? "",
        t.timestamp, t.amount, t.type, t.category, t.description,
        t.counterpartyAccount, t.counterpartyName, t.channel,
        t.runningBalance, t.flagStatus]));

    addSheet(wb, "Call Records",
      ["Caller", "Called", "StartTime", "Duration(s)", "CallType",
        "Direction", "CellTower", "Location"],
      calls.map((c) => [c.callerNumber, c.calledNumber, c.startTime,
        c.durationSeconds, c.callType, c.direction, c.cellTower, c.location]));

    if (results.length > 0) {
      addSheet(wb, "Analysis",
        ["Account", "RiskLevel", "Risk", "Benford", "NearThreshold",
          "RoundNum", "OffHours", "AvgTxnPerDay", "Verdict"],
        results.map((r) => [acctById.get(r.bankAccountId) ?? "", r.riskLevel,
          r.overallRisk, r.benfordPasses ? "PASS" : "FAIL",
          `${r.nearThresholdPercentage.toFixed(1)}%`,
          `${r.roundNumberPercentage.toFixed(1)}%`,
          `${r.offHoursPercentage.toFixed(1)}%`, r.avgTransactionsPerDay,
          r.verdict]));
    }

    if (links.length > 0) {
      addSheet(wb, "Network Links",
        ["Source", "Target", "LinkType", "Strength", "TotalFinancialValue",
          "TotalCallCount", "FirstContact", "LastContact", "Confidence",
          "Description"],
        links.map((l) => [nameById.get(l.sourceSuspectId) ?? "",
          nameById.get(l.targetSuspectId) ?? "", l.linkType, l.strength,
          l.totalFinancialValue, l.totalCallCount, l.firstContact,
          l.lastContact, l.confidenceLevel, l.description]));
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }

  // W-1 · bundle report.pdf + workbook.xlsx + sha256sum.txt into one ZIP so a
  // receiving party can verify the contents against the audit log's hashes.
  async generateBundle(verdict?: AuditChainVerdict): Promise<Buffer> {
    const pdf = await this.generatePdf(verdict);
    const xlsx = await this.generateExcel();
    const sha = (b: Buffer) =>
      createHash("sha256").update(b).digest("hex").toLowerCase();
    const manifest = [
      `${sha(pdf)}  report.pdf`,
      `${sha(xlsx)}  workbook.xlsx`,
      "",
    ].join("\n");
    const zip = new JSZip();
    zip.file("report.pdf", pdf);
    zip.file("workbook.xlsx", xlsx);
    zip.file("sha256sum.txt", manifest);
    return zip.generateAsync({type: "nodebuffer"});
  }

  // Technical manual as a .docx — ported from ManualDocxGenerator.cs. Static
  // content (no DB access); cover page + table of contents + numbered sections.
  async generateManualDocx(): Promise<Buffer> {
    const children: Paragraph[] = [];

    // Cover page.
    children.push(centered("FORENSIC ANALYST WORKSTATION", 32, "000000"));
    children.push(centered("Complete Technical Manual", 20, "000000"));
    children.push(centered("Version FD_0212_v2 | February 12, 2026", 14,
      "666666"));
    children.push(centered(
      "Comprehensive documentation for forensic financial analysis "
      + "and fraud detection", 12, "666666"));
    children.push(new Paragraph({children: [new PageBreak()]}));

    // Table of contents.
    children.push(heading("TABLE OF CONTENTS", 28));
    MANUAL_SECTIONS.forEach((s, i) => {
      children.push(new Paragraph({
        indent: {left: 720},
        children: [new TextRun({text: `${i + 1}. ${s.title}`, bold: true,
          size: 24, font: "Arial"})],
      }));
      for (const sub of s.subsections) {
        children.push(new Paragraph({
          indent: {left: 360},
          children: [new TextRun({text: `   • ${sub.title}`, size: 20,
            color: "666666", font: "Arial"})],
        }));
      }
    });
    children.push(new Paragraph({children: [new PageBreak()]}));

    // Content sections.
    MANUAL_SECTIONS.forEach((s, i) => {
      children.push(heading(`${i + 1}. ${s.title.toUpperCase()}`, 24));
      for (const sub of s.subsections) {
        children.push(heading(sub.title, 18));
        for (const line of sub.lines) {
          if (line.startsWith("•")) {
            children.push(new Paragraph({
              bullet: {level: 0},
              children: [new TextRun({text: line.slice(1).trim(), size: 22,
                color: "E0E6ED", font: "Arial"})],
            }));
          } else {
            children.push(new Paragraph({
              children: [new TextRun({text: line, size: 22, font: "Arial"})],
            }));
          }
        }
        children.push(new Paragraph({text: ""}));
      }
      if (i < MANUAL_SECTIONS.length - 1) {
        children.push(new Paragraph({children: [new PageBreak()]}));
      }
    });

    const doc = new Document({sections: [{children}]});
    return Packer.toBuffer(doc);
  }
}

function centered(text: string, pt: number, color: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({text, bold: true, size: pt * 2, color,
      font: "Arial"})],
  });
}

function heading(text: string, pt: number): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: {before: 200, after: 100},
    children: [new TextRun({text, bold: true, size: pt * 2, color: "00E5FF",
      font: "Arial"})],
  });
}

// Group-format an amount as tugrik. The bundled report font DOES carry the ₮
// glyph (U+20AE), so use the proper symbol.
function mnt(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US")} ₮`;
}

// Status → Mongolian label for the profile block.
const STATUS_MN: Record<string, string> = {
  UNKNOWN: "Тодорхойгүй", ACTIVE: "Идэвхтэй",
  UNDER_INVESTIGATION: "Сэжигтэн (хянагдаж буй)",
  CLOSED: "Хаагдсан", CLEARED: "Цагаатгасан",
};

function totals(txns: BankTransaction[]): {income: number; outgoing: number} {
  let income = 0;
  let outgoing = 0;
  for (const t of txns) {
    if (t.type.toLowerCase() === "credit") income += t.amount;
    else outgoing += t.amount;
  }
  return {income, outgoing};
}

// A4 doc with the Cyrillic font and buffered pages (so footers can number them).
function startDoc(): {doc: PDFKit.PDFDocument; done: Promise<Buffer>} {
  const doc = new PDFDocument({size: "A4", margin: 40, bufferPages: true});
  const font = resolveFont();
  if (font) doc.registerFont("Body", font);
  doc.font(font ? "Body" : "Helvetica");
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  return {doc, done};
}

// Dark title band with the report title + subtitle.
// Where the report is issued — shown top-right of the formal header. Override
// with the REPORT_LOCATION env var (e.g. a different aimag/city).
const REPORT_LOCATION = process.env.REPORT_LOCATION || "Улаанбаатар хот";

// Current date in the formal Mongolian two-line form the template uses, e.g.
// "2026 оны 03 дугаар" / "Сарын 22-ны өдөр".
function mnDateLines(iso: string): [string, string] {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return [`${y} оны ${m} дугаар`, `Сарын ${d.getDate()}-ны өдөр`];
}

// Chronological span of an (asc-sorted) ledger as date-only strings.
function dateRange(txns: BankTransaction[]): {from: string; to: string} {
  if (txns.length === 0) return {from: "—", to: "—"};
  return {
    from: formatDateLike(txns[0].timestamp),
    to: formatDateLike(txns[txns.length - 1].timestamp),
  };
}

// Normalise a name for cross-referencing counterparties to suspects.
function normName(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

// Formal official-document header: centred title, then a three-column row of
// date (left) · number (centre) · location (right), matching the Mongolian
// протокол/тэмдэглэл template.
function formalHeader(
  doc: PDFKit.PDFDocument, title: string,
  opts: {number?: string; location?: string} = {}
): void {
  const number = opts.number ?? ".......";
  const location = opts.location ?? REPORT_LOCATION;

  // Title (centred, may wrap to two lines). Rendered as given — no forced
  // upper-casing, so sentence-case titles stay sentence-case.
  doc.fillColor("#111111").fontSize(15).text(title, ML, 46,
    {width: CW, align: "center", characterSpacing: 0.4});

  const y = doc.y + 16;
  const [d1, d2] = mnDateLines(new Date().toISOString());
  // Left — date.
  doc.fontSize(10.5).fillColor("#111111");
  doc.text(d1, ML, y, {width: 190, align: "left", lineBreak: false});
  doc.text(d2, ML, y + 15, {width: 190, align: "left", lineBreak: false});
  // Centre — document number.
  doc.text(`Дугаар ${number}`, ML, y + 7,
    {width: CW, align: "center", lineBreak: false});
  // Right — location (city name over "хот"/suffix).
  const parts = location.split(" ");
  const locTop = parts.length > 1 ? parts.slice(0, -1).join(" ") : location;
  const locBot = parts.length > 1 ? parts[parts.length - 1] : "";
  doc.text(locTop, ML, y, {width: CW, align: "right", lineBreak: false});
  if (locBot) {
    doc.text(locBot, ML, y + 15, {width: CW, align: "right", lineBreak: false});
  }

  const ry = y + 36;
  doc.moveTo(ML, ry).lineTo(ML + CW, ry).lineWidth(1)
    .strokeColor("#111111").stroke();
  doc.x = ML;
  doc.y = ry + 12;
  doc.fillColor(INK);
}

// Cyan-tab section heading.
function sectionBar(doc: PDFKit.PDFDocument, title: string): void {
  if (doc.y > doc.page.height - 110) {
    doc.addPage();
    doc.y = 48;
  }
  const y = doc.y + 6;
  doc.rect(ML, y, 4, 13).fill(ACCENT_CYAN);
  doc.fillColor(DARK_BLUE).fontSize(12)
    .text(title, ML + 10, y - 1, {lineBreak: false});
  doc.y = y + 22;
  doc.fillColor(INK);
}

// Two tinted summary cards: income / outgoing (net dropped per request).
function totalsCards(
  doc: PDFKit.PDFDocument, income: number, outgoing: number
): void {
  const gap = 12;
  const cw = (CW - gap) / 2;
  const h = 50;
  const y = doc.y;
  const cards = [
    {label: "Нийт орлого", value: mnt(income), fg: GREEN, bg: GREEN_TINT},
    {label: "Нийт зарлага", value: mnt(outgoing), fg: RED, bg: RED_TINT},
  ];
  cards.forEach((c, i) => {
    const x = ML + i * (cw + gap);
    doc.roundedRect(x, y, cw, h, 6).fill(c.bg);
    doc.fillColor(MUTED).fontSize(8.5)
      .text(c.label, x + 12, y + 10, {width: cw - 20, lineBreak: false});
    doc.fillColor(c.fg).fontSize(15)
      .text(c.value, x + 12, y + 26,
        {width: cw - 20, lineBreak: false, ellipsis: true});
  });
  doc.y = y + h + 10;
  doc.fillColor(INK);
}

// A coloured rounded pill (risk badge).
function pill(
  doc: PDFKit.PDFDocument, x: number, y: number, text: string, bg: string
): void {
  doc.fontSize(8);
  const w = doc.widthOfString(text) + 14;
  doc.roundedRect(x, y, w, 14, 7).fill(bg);
  doc.fillColor("#FFFFFF").fontSize(8).text(text, x + 7, y + 3.4,
    {lineBreak: false});
}

// One ledger cell with 6px padding on the aligned side. The text is
// hard-truncated to a single line (pdfkit's lineBreak:false/ellipsis still
// wraps long Cyrillic strings, so we clip manually).
function cell(
  doc: PDFKit.PDFDocument, text: string, c: LedgerCol, y: number, color: string
): void {
  const pad = 6;
  const maxW = c.w - pad;
  doc.fontSize(7.6);
  let s = text ?? "";
  if (doc.widthOfString(s) > maxW) {
    while (s.length > 1 && doc.widthOfString(`${s}…`) > maxW) {
      s = s.slice(0, -1);
    }
    s = `${s}…`;
  }
  const x = c.align === "right" ? c.x : c.x + pad;
  doc.fillColor(color).text(s, x, y,
    {width: maxW, align: c.align, lineBreak: false});
}

// Filled table header band.
function drawTableHead(doc: PDFKit.PDFDocument, cols: LedgerCol[]): void {
  const y = doc.y;
  doc.rect(ML, y, CW, 17).fill(TABLE_HEAD);
  for (const c of cols) {
    const pad = 6;
    const x = c.align === "right" ? c.x : c.x + pad;
    doc.fillColor("#FFFFFF").fontSize(8).text(c.label, x, y + 5,
      {width: c.w - pad, align: c.align, lineBreak: false});
  }
  doc.y = y + 20;
}

// Page-break guard for a table row; repeats the header on the new page.
function ensureRow(doc: PDFKit.PDFDocument, cols: LedgerCol[]): number {
  if (doc.y + 13 > doc.page.height - 46) {
    doc.addPage();
    doc.y = 48;
    drawTableHead(doc, cols);
  }
  return doc.y;
}

// A full per-suspect section: identity, profile, totals cards, accounts and the
// paginating transaction ledger. Assumes doc.y is positioned to start.
function renderSuspect(
  doc: PDFKit.PDFDocument,
  suspect: Suspect & {bankAccounts: BankAccount[]},
  txns: BankTransaction[],
  opts: {ledgerLabel?: string} = {}
): void {
  const {income, outgoing} = totals(txns);
  const {from, to} = dateRange(txns);
  const ledgerLabel = opts.ledgerLabel ?? "ГҮЙЛГЭЭ";

  // Name + risk pill (the pill is omitted for UNKNOWN risk so no
  // "Тодорхойгүй" label is shown).
  const nameY = doc.y;
  doc.fontSize(15).fillColor(DARK_BLUE)
    .text(suspect.fullName, ML, nameY, {lineBreak: false});
  if (suspect.riskLevel && suspect.riskLevel !== "UNKNOWN") {
    const nameW = doc.widthOfString(suspect.fullName);
    pill(doc, ML + nameW + 10, nameY + 2, RISK_MN[suspect.riskLevel]
      ?? suspect.riskLevel, RISK_HEX[suspect.riskLevel] ?? MUTED);
  }
  doc.y = nameY + 22;

  // Identity line — national id (labelled) + phone; the internal suspect code
  // is intentionally omitted.
  const idBits = [
    suspect.nationalId ? `Регистрийн дугаар: ${suspect.nationalId}` : null,
    suspect.primaryPhone,
  ].filter(Boolean).join("  ·  ");
  doc.fontSize(8.5).fillColor(MUTED)
    .text(idBits || "—", ML, doc.y, {width: CW, lineBreak: false,
      ellipsis: true});
  doc.y += 18;

  // Profile grid (two columns).
  const profile: [string, string][] = [];
  const add = (l: string, v: string | null | undefined) => {
    if (v) profile.push([l, v]);
  };
  add("Ажил", suspect.occupation);
  add("Байгууллага", suspect.organization);
  add("Хаяг", [suspect.address, suspect.city].filter(Boolean).join(", "));
  add("И-мэйл", suspect.email);
  add("Төлөв", STATUS_MN[suspect.status] ?? suspect.status);
  if (profile.length > 0) {
    const colW = CW / 2;
    const lineH = 15;
    const startY = doc.y;
    profile.forEach(([label, val], i) => {
      const x = ML + (i % 2) * colW;
      const y = startY + Math.floor(i / 2) * lineH;
      doc.fontSize(8.5).fillColor(MUTED)
        .text(`${label}:`, x, y, {width: 74, lineBreak: false});
      doc.fillColor(INK).text(val, x + 78, y,
        {width: colW - 84, lineBreak: false, ellipsis: true});
    });
    doc.y = startY + Math.ceil(profile.length / 2) * lineH + 4;
  }

  // Totals.
  sectionBar(doc, "САНХҮҮГИЙН ДҮН");
  totalsCards(doc, income, outgoing);
  doc.fontSize(8.5).fillColor(MUTED).text(
    `Нийт гүйлгээ: ${txns.length}      Хугацаа: ${from} — ${to}` +
    `      Данс: ${suspect.bankAccounts.length}`,
    ML, doc.y, {lineBreak: false});
  doc.y += 14;

  // Accounts (account number + bank + currency — balance omitted).
  if (suspect.bankAccounts.length > 0) {
    sectionBar(doc, "ДАНС");
    for (const a of suspect.bankAccounts) {
      doc.fontSize(8.5).fillColor(INK).text(
        `•  ${a.accountNumber}${a.bankName ? `  ·  ${a.bankName}` : ""}` +
        `  ·  ${a.currency || "MNT"}`,
        ML, doc.y, {width: CW, lineBreak: false, ellipsis: true});
      doc.y += 14;
    }
  }

  // Transaction ledger (ascending by time — as loaded).
  sectionBar(doc, `${ledgerLabel} (${txns.length})`);
  drawTableHead(doc, LEDGER_COLS);
  if (txns.length === 0) {
    doc.fontSize(8.5).fillColor(MUTED).text("Гүйлгээ алга", ML + 6, doc.y);
    doc.y += 14;
    return;
  }
  txns.forEach((t, i) => {
    const y = ensureRow(doc, LEDGER_COLS);
    if (i % 2 === 1) doc.rect(ML, y - 2, CW, 13).fill(ZEBRA);
    const credit = t.type.toLowerCase() === "credit";
    cell(doc, formatDateLike(t.timestamp, true), LEDGER_COLS[0], y, INK);
    cell(doc, credit ? "Орлого" : "Зарлага", LEDGER_COLS[1], y,
      credit ? GREEN : RED);
    cell(doc, t.counterpartyName || t.counterpartyAccount || "—",
      LEDGER_COLS[2], y, INK);
    cell(doc, t.description || t.category || "—", LEDGER_COLS[3], y, MUTED);
    cell(doc, `${credit ? "+" : "−"}${mnt(t.amount)}`, LEDGER_COLS[4], y,
      credit ? GREEN : RED);
    cell(doc, mnt(t.runningBalance), LEDGER_COLS[5], y, MUTED);
    doc.y = y + 13;
  });
}

// Numbered footer on every buffered page. The footer sits in the bottom
// margin; pdfkit would otherwise auto-append a blank page whenever text is
// written below the page's max-Y, so we temporarily drop the bottom margin to
// zero on each page while writing (this was the cause of trailing blank pages).
function drawFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  const ts = formatDateLike(new Date().toISOString(), true);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 30;
    doc.moveTo(ML, y - 6).lineTo(ML + CW, y - 6).lineWidth(0.5)
      .strokeColor("#E2E8F0").stroke();
    doc.fontSize(7).fillColor(MUTED).text(
      `Forensic Analyst Workstation  ·  НУУЦ  ·  ${ts}`, ML, y,
      {width: 360, align: "left", lineBreak: false});
    doc.fontSize(7).fillColor(MUTED).text(
      `Хуудас ${i + 1} / ${range.count}`, ML, y,
      {width: CW, align: "right", lineBreak: false});
    doc.page.margins.bottom = savedBottom;
  }
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.8);
  doc.fontSize(13).fillColor(DARK_BLUE).text(title);
  const y = doc.y + 2;
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).lineWidth(1.5)
    .strokeColor(ACCENT_CYAN).stroke();
  doc.moveDown(0.4);
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
): void {
  const ws = wb.addWorksheet(name);
  ws.addRow(headers);
  ws.getRow(1).font = {bold: true};
  for (const r of rows) ws.addRow(r.map((v) => v ?? ""));
}

interface ManualSection {
  title: string;
  subsections: {title: string; lines: string[]}[];
}

// Static technical-manual content rendered into MANUAL.docx.
const MANUAL_SECTIONS: ManualSection[] = [
  {title: "Introduction", subsections: [
    {title: "Purpose", lines: [
      "Forensic Analyst Workstation is an offline analytical platform for "
      + "financial-crime investigation: bank statements, call records, "
      + "geolocation and OSINT in one case file.",
      "• Import bank/CDR/access-log data from CSV and Excel.",
      "• Detect fraud with a configurable rule engine and ML scoring.",
      "• Build link charts, timelines and money-flow diagrams.",
    ]},
  ]},
  {title: "Dashboard", subsections: [
    {title: "Overview", lines: [
      "The dashboard summarises the active case: key metrics, risk "
      + "distribution, monthly volume, money-flow Sankey, category treemap, "
      + "hourly heatmap and channel breakdown.",
    ]},
  ]},
  {title: "Suspects", subsections: [
    {title: "Managing subjects", lines: [
      "• Add, edit and delete suspects with photos, accounts and phones.",
      "• Review per-suspect access logs and tag records as evidence.",
    ]},
  ]},
  {title: "Data Import", subsections: [
    {title: "Workflow", lines: [
      "Select a subject, choose a file (CSV/TSV/XLSX/XLS), pick the Excel "
      + "sheet, preview the auto-detected profile, correct the column mapping "
      + "for bank statements, then import.",
      "• Domains: bank statement, call records (CDR), access log.",
      "• Imported call/access rows are attributed to the chosen subject.",
    ]},
  ]},
  {title: "Transactions", subsections: [
    {title: "Analysis", lines: [
      "Filter by account, type and flag. Charts: amount-vs-time scatter, "
      + "value violin, daily volume with running balance, category waterfall, "
      + "sunburst and hourly distribution. Click a row to drill down and tag "
      + "it as evidence.",
    ]},
  ]},
  {title: "Call Records", subsections: [
    {title: "CDR analysis", lines: [
      "Filter by suspect. Charts: day×hour heatmap, top contacts, call-type "
      + "breakdown, duration distribution and hourly frequency. Night, short "
      + "and long calls are flagged.",
    ]},
  ]},
  {title: "Timeline", subsections: [
    {title: "Event sequence", lines: [
      "Merged transaction and call timeline with correlation and travel "
      + "panels, scoped per suspect and toggled per source.",
    ]},
  ]},
  {title: "Link Chart", subsections: [
    {title: "Network", lines: [
      "Force-directed graph of suspects and their links, plus a money-flow "
      + "Sankey and a link list.",
    ]},
  ]},
  {title: "Intelligence Board", subsections: [
    {title: "ANB", lines: [
      "Entity-link chart, entities and events tabs, and a colour-coded "
      + "association matrix. Export to CSV and i2 ANX.",
    ]},
  ]},
  {title: "Map", subsections: [
    {title: "Geospatial", lines: [
      "Suspect markers and a transaction-location heatmap, scoped to the "
      + "active case, with a configurable time window.",
    ]},
  ]},
  {title: "Analysis", subsections: [
    {title: "Account scoring", lines: [
      "Per-account Benford, radar and metric cards plus a multi-dimensional "
      + "risk profile and risk-score histogram.",
    ]},
  ]},
  {title: "Fraud Workflow", subsections: [
    {title: "Rule engine", lines: [
      "Composite scoring combines rule violations and an ML model into a "
      + "BLOCK / HOLD / MONITOR / ALLOW decision per account.",
      "• Base score = sum of violation scores (capped at 1.0).",
      "• Rule boost = critical×0.10 + high×0.05.",
    ]},
  ]},
  {title: "OSINT", subsections: [
    {title: "Sanctions", lines: [
      "Screen suspects against the loaded sanctions dataset and review the "
      + "active dataset's integrity (SHA-256 and byte count).",
    ]},
  ]},
  {title: "Audit", subsections: [
    {title: "Chain of custody", lines: [
      "Every action is written to a hash-chained audit log that can be "
      + "verified for tampering and exported to CSV.",
    ]},
  ]},
  {title: "Reports", subsections: [
    {title: "Exports", lines: [
      "Generate a PDF report, an Excel workbook, a signed ZIP bundle and "
      + "this Word technical manual.",
    ]},
  ]},
  {title: "Settings", subsections: [
    {title: "Configuration", lines: [
      "AML thresholds (with Mongolia/US presets), OSINT auto-refresh, "
      + "language and theme, plus a danger-zone data wipe.",
    ]},
  ]},
];
