/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : reportService.ts
 * Created at  : 2026-06-24
 * Updated at  : 2026-06-30
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
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
import {formatDateLike} from "./reportFormat";

// Ported from Services/ReportService.cs — the PDF (was QuestPDF) and Excel
// (was ClosedXML) exporters. Output is returned as an in-memory Buffer so the
// GraphQL layer can hand it to the browser as a base64 download.

const DARK_BLUE = "#0A1628";
const ACCENT_CYAN = "#00B8D0";

// A Unicode TTF is required for Cyrillic; pdfkit's built-in Helvetica is
// WinAnsi-only. Try common system fonts, else fall back to Helvetica (Latin).
const FONT_CANDIDATES = [
  process.env.REPORT_FONT,
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
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

    section(doc, "SUBJECT PROFILES");
    for (const s of suspects) {
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor(DARK_BLUE)
        .text(`${s.suspectId} — ${s.fullName}  [${s.riskLevel}]`);
      doc.fontSize(9).fillColor("#555555").text(
        `${s.occupation ?? ""} | ${s.organization ?? ""} | ` +
        `${s.city ?? ""}, ${s.country ?? ""}`);
      doc.text(`Phone: ${s.primaryPhone ?? "—"} | Accounts: ` +
        `${s.bankAccounts.length} | DOB: ${formatDateLike(s.dateOfBirth)}`);
      if (s.notes) doc.fontSize(8).fillColor("#666666").text(s.notes);
    }

    if (results.length > 0) {
      section(doc, "FORENSIC ANALYSIS RESULTS");
      doc.fontSize(8).fillColor("#333333");
      for (const r of results) {
        doc.text(
          `${acctById.get(r.bankAccountId) ?? "N/A"} | ${r.riskLevel} | ` +
          `Benford ${r.benfordPasses ? "PASS" : "FAIL"} | ` +
          `Near ${r.nearThresholdPercentage.toFixed(1)}% | ` +
          `Round ${r.roundNumberPercentage.toFixed(1)}% | ` +
          `OffHours ${r.offHoursPercentage.toFixed(1)}% | ${r.verdict ?? ""}`);
      }
    }

    if (links.length > 0) {
      section(doc, "NETWORK CONNECTIONS");
      doc.fontSize(9).fillColor("#333333");
      for (const l of links) {
        doc.text(
          `${nameById.get(l.sourceSuspectId) ?? l.sourceSuspectId} ` +
          `<-> ${nameById.get(l.targetSuspectId) ?? l.targetSuspectId}  ` +
          `[${l.linkType}]  ${l.description ?? ""}`);
      }
    }

    doc.addPage();
    doc.font(FONT);
    section(doc, "CHAIN OF CUSTODY — AUDIT LOG");
    if (verdict) {
      doc.fontSize(10);
      if (verdict.valid) {
        doc.fillColor("#1B7A3D").text(
          `HASH CHAIN INTEGRITY: VERIFIED (${audit.length} events, ` +
          "SHA-256 chain intact)");
      } else {
        doc.fillColor("#B00020").text(
          `HASH CHAIN INTEGRITY: BROKEN (chain breaks at row id ${verdict.brokenAt})`);
      }
      doc.moveDown(0.4);
    }
    doc.fontSize(8).fillColor("#333333");
    for (const ev of audit) {
      doc.text(
        `${formatDateLike(ev.timestampUtc, true)} | ${ev.actor} | ` +
        `${ev.action} | ${ev.target ?? "—"} | ${ev.severity}`);
    }

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
