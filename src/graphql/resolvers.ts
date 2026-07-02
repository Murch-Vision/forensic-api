/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : resolvers.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {SuspectInput, SuspectService} from "../services/suspectService";
import type {DataService} from "../services/dataService";
import type {AnalysisService} from "../services/analysisService";
import {computeBenfordObserved} from "../services/analysisService";
import type {GeospatialService} from "../services/geospatialService";
import type {ImportKind, ImportService} from "../services/importService";
import type {ReportService} from "../services/reportService";
import type {AuditLogService} from "../services/auditLogService";
import type {EvidenceService} from "../services/evidenceService";
import type {SanctionsService} from "../services/sanctionsService";
import type {SanctionsRefreshService} from "../services/sanctionsRefreshService";
import type {FawSettings, SettingsService} from "../services/settingsService";
import type {TravelCorrelationService} from "../services/travelCorrelationService";
import type {CaseSessionService} from "../services/caseSessionService";
import type {AnbService} from "../services/anbService";
import type {LocalizationService} from "../services/localizationService";
import type {TelemetryService} from "../services/telemetryService";
import type {AlertSeverity, EvidenceSourceType} from "../models/enums";
import {
  AmlThresholds,
  MongoliaDefault,
  UnitedStatesDefault,
} from "../services/amlThresholds";
import type {BankAccount, Suspect} from "../models/types";

export interface GraphQLContext {
  suspects : SuspectService;
  data     : DataService;
  analysis : AnalysisService;
  geo      : GeospatialService;
  imports  : ImportService;
  reports  : ReportService;
  audit    : AuditLogService;
  evidence : EvidenceService;
  sanctions : SanctionsService;
  sanctionsRefresh : SanctionsRefreshService;
  settings : SettingsService;
  travel   : TravelCorrelationService;
  session  : CaseSessionService;
  anb      : AnbService;
  i18n     : LocalizationService;
  telemetry : TelemetryService;
}

// Computed [NotMapped] Suspect.Initials — first letter of the first name part.
function initials(fullName: string): string {
  if (!fullName || !fullName.trim()) return "";
  const parts = fullName.split(" ").filter((p) => p.length > 0);
  if (parts.length >= 1) return parts[0].substring(0, 1).toUpperCase();
  return "";
}

// Computed [NotMapped] Suspect.Age — whole years since DateOfBirth.
function age(dateOfBirth: string | null): number {
  if (!dateOfBirth) return 0;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return 0;
  const days = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24);
  return Math.floor(days / 365.25);
}

// Computed [NotMapped] BankAccount.MaskedNumber.
function maskedNumber(accountNumber: string): string {
  if (!accountNumber) return "****";
  if (accountNumber.length > 4) {
    return "*".repeat(accountNumber.length - 4) + accountNumber.slice(-4);
  }
  return accountNumber;
}

export const resolvers = {
  Query: {
    suspects: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.suspects.getAllSuspects(),
    suspect: (_p: unknown, a: {id: number}, c: GraphQLContext) =>
      c.suspects.getSuspectById(a.id),
    dashboardStats: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getDashboardStats(),
    bankAccounts: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getAllBankAccounts(),
    transactions: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getAllTransactions(),
    callRecords: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getAllCallRecords(),
    suspectLinks: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getAllLinks(),
    caseFiles: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getAllCaseFiles(),
    analysisResults: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getAllAnalysisResults(),
    auditEvents: (_p: unknown, a: {limit?: number}, c: GraphQLContext) =>
      c.data.getAuditEvents(a.limit ?? 500),
    accessLogEntries: (_p: unknown, a: {suspectId?: number}, c: GraphQLContext) =>
      c.data.getAccessLogEntries(a.suspectId ?? null),
    patterns: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.analysis.detectPatterns(),
    correlations: (_p: unknown, a: {suspectId?: number}, c: GraphQLContext) =>
      c.analysis.correlateTimeline(a.suspectId ?? null),
    accountStatistics: (_p: unknown, a: {bankAccountId: number}, c: GraphQLContext) =>
      c.analysis.getAccountStatistics(a.bankAccountId),
    ruleEngine: (_p: unknown, a: {bankAccountId: number}, c: GraphQLContext) =>
      c.analysis.runRuleEngine(a.bankAccountId),
    networkFlow: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.analysis.analyzeNetworkFlow(),
    suspectLocations: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const suspects = await c.suspects.getAllSuspects();
      const active = await c.session.getCurrentCase();
      const scoped = active
        ? suspects.filter((s) => s.caseId === active.caseId) : suspects;
      return c.geo.resolveAll(scoped);
    },
    benfordObserved: async (
      _p: unknown,
      a: {bankAccountId: number},
      c: GraphQLContext
    ) => computeBenfordObserved(await c.data.getTransactionsForAccount(a.bankAccountId)),
    amlConfig: () => AmlThresholds.current,
    previewImport: (
      _p: unknown,
      a: {content: string; filename?: string; sheetName?: string},
      c: GraphQLContext
    ) => c.imports.preview(a.content, a.filename ?? null, a.sheetName ?? null),
    excelSheets: (
      _p: unknown,
      a: {content: string; filename: string},
      c: GraphQLContext
    ) => c.imports.excelSheets(a.content, a.filename),
    reportPdf: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const verdict = await c.audit.verify();
      const buf = await c.reports.generatePdf(verdict);
      await c.audit.record("Report.Generated", "File:ForensicReport.pdf");
      return {
        filename: "ForensicReport.pdf",
        mimeType: "application/pdf",
        base64: buf.toString("base64"),
      };
    },
    reportExcel: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const buf = await c.reports.generateExcel();
      await c.audit.record("Report.Generated", "File:ForensicData.xlsx");
      return {
        filename: "ForensicData.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument."
          + "spreadsheetml.sheet",
        base64: buf.toString("base64"),
      };
    },
    reportWord: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const buf = await c.reports.generateManualDocx();
      await c.audit.record("Report.Generated", "File:MANUAL.docx");
      return {
        filename: "MANUAL.docx",
        mimeType: "application/vnd.openxmlformats-officedocument."
          + "wordprocessingml.document",
        base64: buf.toString("base64"),
      };
    },
    screenSuspect: async (_p: unknown, a: {id: number}, c: GraphQLContext) => {
      const suspect = await c.suspects.getSuspectById(a.id);
      return suspect ? c.sanctions.screen(suspect) : [];
    },
    sanctionsStatus: (_p: unknown, _a: unknown, c: GraphQLContext) => {
      c.sanctions.load();
      return {
        loaded: c.sanctions.isLoaded,
        entryCount: c.sanctions.entryCount,
        loadedFrom: c.sanctions.loadedFrom,
      };
    },
    sanctionsRefreshLogs: (_p: unknown, a: {take?: number}, c: GraphQLContext) =>
      c.sanctionsRefresh.getHistory(a.take ?? 25),
    auditVerify: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.audit.verify(),
    evidenceForCase: (_p: unknown, a: {caseFileId: number}, c: GraphQLContext) =>
      c.evidence.getForCase(a.caseFileId),
    settings: (_p: unknown, _a: unknown, c: GraphQLContext) => c.settings.get(),
    travelCorrelations: (
      _p: unknown,
      a: {suspectId?: number; hourWindow?: number},
      c: GraphQLContext
    ) => {
      const window = a.hourWindow ?? 4;
      if (a.suspectId != null) {
        return c.travel.findCrossLocationPatterns(a.suspectId, window);
      }
      return c.suspects.getAllSuspects().then((all) =>
        c.travel.findCrossLocationPatternsForAll(all.map((s) => s.id), window));
    },
    activeCase: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.session.getCurrentCase(),
    pinnedSuspectIds: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.session.pinnedSuspectIds(),
    associationMatrix: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.anb.buildAssociationMatrix(),
    chartEntities: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.anb.getAllEntities(),
    chartLinks: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.anb.getAllChartLinks(),
    chartEvents: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.anb.getAllEvents(),
    localeStrings: (_p: unknown, a: {language?: string}, c: GraphQLContext) => {
      if (a.language) c.i18n.setLanguage(a.language);
      return Object.entries(c.i18n.all()).map(([key, value]) => ({key, value}));
    },
    telemetrySnapshot: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.telemetry.snapshot(),
    transactionDrillDown: (
      _p: unknown,
      a: {transactionId: number},
      c: GraphQLContext
    ) => c.analysis.buildTransactionDrillDown(a.transactionId),
    reportBundle: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const verdict = await c.audit.verify();
      const buf = await c.reports.generateBundle(verdict);
      await c.audit.record("Case.BundleExported", "File:CaseBundle.zip");
      return {
        filename: "CaseBundle.zip", mimeType: "application/zip",
        base64: buf.toString("base64"),
      };
    },
    anbExport: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const csv = await c.anb.exportCsv();
      const anx = await c.anb.exportAnx();
      return {entitiesCsv: csv.entitiesCsv, linksCsv: csv.linksCsv, anx};
    },
    dwellZones: async (_p: unknown, a: {suspectId: number}, c: GraphQLContext) => {
      const events = await c.data.getLocatedEventsForSuspect(a.suspectId);
      return c.geo.clusterDwellZones(events);
    },
    locationDensity: async (
      _p: unknown,
      a: {windowDays?: number},
      c: GraphQLContext
    ) => {
      const from = a.windowDays
        ? new Date(Date.now() - a.windowDays * 86_400_000).toISOString() : null;
      const rows = await c.data.getTransactionLocations(from);
      const points = [];
      for (const r of rows) {
        const loc = c.geo.resolveLocationString(r.location);
        if (loc) points.push({lat: loc.lat, lng: loc.lng, displayName: loc.displayName});
      }
      return c.geo.aggregateGrid(points, 5);
    },
    fraudWorkflow: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.analysis.fraudWorkflow(),
    auditSearch: (
      _p: unknown,
      a: {fromUtc?: string; toUtc?: string; actor?: string; action?: string;
        take?: number},
      c: GraphQLContext
    ) => c.audit.search({
      fromUtc: a.fromUtc, toUtc: a.toUtc, actor: a.actor, action: a.action,
      take: a.take,
    }),
  },

  Mutation: {
    createSuspect: async (
      _p: unknown,
      a: {input: SuspectInput},
      c: GraphQLContext
    ) => {
      const s = await c.suspects.createSuspect(a.input);
      await c.audit.record("Suspect.Create", `Suspect:${s.id}`, s.fullName);
      return s;
    },
    updateSuspect: async (
      _p: unknown,
      a: {id: number; input: SuspectInput},
      c: GraphQLContext
    ) => {
      const s = await c.suspects.updateSuspect(a.id, a.input);
      await c.audit.record("Suspect.Update", `Suspect:${a.id}`, s.fullName);
      return s;
    },
    deleteSuspect: async (_p: unknown, a: {id: number}, c: GraphQLContext) => {
      const ok = await c.suspects.deleteSuspect(a.id);
      if (ok) await c.audit.record("Suspect.Delete", `Suspect:${a.id}`);
      return ok;
    },
    generateLinks: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const links = await c.analysis.generateLinks();
      await c.audit.record("Link.Generate", null, `${links.length} links`);
      return links;
    },
    runAccountAnalysis: async (
      _p: unknown,
      a: {bankAccountId: number},
      c: GraphQLContext
    ) => {
      const result = await c.analysis.analyzeAccount(a.bankAccountId);
      const saved = await c.data.saveAnalysisResult(result);
      await c.audit.record("Analysis.Run", `BankAccount:${a.bankAccountId}`,
        saved.verdict ?? null);
      return saved;
    },
    setAmlJurisdiction: async (
      _p: unknown,
      a: {jurisdiction: string},
      c: GraphQLContext
    ) => {
      AmlThresholds.current = a.jurisdiction.toUpperCase() === "US"
        ? UnitedStatesDefault : MongoliaDefault;
      await c.audit.record("Settings.Update", "AML",
        `jurisdiction=${a.jurisdiction}`);
      return AmlThresholds.current;
    },
    importData: async (
      _p: unknown,
      a: {content: string; kind: ImportKind; bankAccountId?: number;
        filename?: string; sheetName?: string; subjectSuspectId?: number;
        mapping?: {field: string; column: string}[]},
      c: GraphQLContext
    ) => {
      const mapping = a.mapping
        ? Object.fromEntries(a.mapping.map((m) => [m.field, m.column]))
        : null;
      const sum = await c.imports.importData({
        content: a.content, kind: a.kind,
        bankAccountId: a.bankAccountId ?? null,
        filename: a.filename ?? null, sheetName: a.sheetName ?? null,
        subjectSuspectId: a.subjectSuspectId ?? null, mapping,
      });
      await c.audit.record("Import.Run", sum.domain,
        `${sum.importedRows}/${sum.totalRows} rows`);
      return sum;
    },
    tagEvidence: (
      _p: unknown,
      a: {caseFileId: number; sourceType: EvidenceSourceType; sourceId: number;
        description?: string; severity?: AlertSeverity},
      c: GraphQLContext
    ) => c.evidence.tag(a.caseFileId, a.sourceType, a.sourceId,
      a.description ?? null, a.severity ?? "INFO"),
    untagEvidence: async (_p: unknown, a: {id: number}, c: GraphQLContext) => {
      await c.evidence.untag(a.id);
      return true;
    },
    refreshSanctions: (_p: unknown, a: {url?: string}, c: GraphQLContext) =>
      c.sanctionsRefresh.refreshNow(a.url ?? undefined),
    updateSettings: async (
      _p: unknown,
      a: {input: FawSettings},
      c: GraphQLContext
    ) => {
      const saved = c.settings.save({...a.input, schemaVersion: 1});
      await c.audit.record("Settings.Update", "FawSettings",
        `language=${saved.language} currency=${saved.aml.currencySymbol}`);
      return saved;
    },
    setActiveCase: (_p: unknown, a: {caseFileId?: number}, c: GraphQLContext) =>
      c.session.setCurrentCase(a.caseFileId ?? null),
    togglePin: (_p: unknown, a: {suspectId: number}, c: GraphQLContext) =>
      c.session.togglePin(a.suspectId),
    generateAnbChart: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const res = await c.anb.generateFromSuspects();
      await c.audit.record("Anb.Generate", null,
        `${res.entities} entities, ${res.links} links`);
      return res;
    },
    createBankAccount: async (
      _p: unknown,
      a: {input: Record<string, unknown>},
      c: GraphQLContext
    ) => {
      const acc = await c.data.createBankAccount(a.input);
      await c.audit.record("BankAccount.Create", `BankAccount:${acc.id}`,
        acc.accountNumber);
      return acc;
    },
    createPhoneNumber: async (
      _p: unknown,
      a: {input: Record<string, unknown>},
      c: GraphQLContext
    ) => {
      const ph = await c.data.createPhoneNumber(a.input);
      await c.audit.record("PhoneNumber.Create", `PhoneNumber:${ph.id}`, ph.number);
      return ph;
    },
    createCaseFile: async (
      _p: unknown,
      a: {input: Record<string, unknown>},
      c: GraphQLContext
    ) => {
      const cf = await c.data.createCaseFile(a.input);
      await c.audit.record("CaseFile.Create", `CaseFile:${cf.id}`, cf.caseId);
      return cf;
    },
    setCaseStatus: async (
      _p: unknown,
      a: {caseFileId: number; status: string},
      c: GraphQLContext
    ) => {
      const cf = await c.data.setCaseStatus(a.caseFileId, a.status);
      await c.audit.record(
        "CaseFile.SetStatus", `CaseFile:${cf.id}`, a.status);
      return cf;
    },
    mergeCases: async (
      _p: unknown,
      a: {sourceCaseFileIds: number[]; targetCaseFileId: number},
      c: GraphQLContext
    ) => {
      const cf = await c.data.mergeCases(
        a.sourceCaseFileIds, a.targetCaseFileId);
      const current = await c.session.getCurrentCase();
      if (current && a.sourceCaseFileIds.includes(current.id)) {
        await c.session.setCurrentCase(cf.id);
      }
      await c.audit.record("CaseFile.Merge", `CaseFile:${cf.id}`,
        `sources=[${a.sourceCaseFileIds.join(",")}]`);
      return cf;
    },
    addCaseNote: async (
      _p: unknown,
      a: {input: {caseFileId?: number; suspectId?: number; content: string;
        noteType?: string; author?: string}},
      c: GraphQLContext
    ) => {
      const id = await c.data.addCaseNote(a.input);
      await c.audit.record("CaseNote.Add", `CaseNote:${id}`);
      return id;
    },
    clearAllData: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      await c.data.clearAllData();
      await c.audit.record("Database.Clear", null, "all operational tables", "HIGH");
      return true;
    },
  },

  Suspect: {
    initials: (s: Suspect) => initials(s.fullName),
    age: (s: Suspect) => age(s.dateOfBirth),
    bankAccounts: (s: Suspect, _a: unknown, c: GraphQLContext) =>
      c.suspects.getBankAccounts(s.id),
    phoneNumbers: (s: Suspect, _a: unknown, c: GraphQLContext) =>
      c.suspects.getPhoneNumbers(s.id),
    tags: (s: Suspect, _a: unknown, c: GraphQLContext) =>
      c.suspects.getTags(s.id),
    caseNotes: (s: Suspect, _a: unknown, c: GraphQLContext) =>
      c.suspects.getCaseNotes(s.id),
    links: (s: Suspect, _a: unknown, c: GraphQLContext) =>
      c.suspects.getLinks(s.id),
    recordCounts: (s: Suspect, _a: unknown, c: GraphQLContext) =>
      c.suspects.getRecordCounts(s.id),
  },

  BankAccount: {
    maskedNumber: (a: BankAccount) => maskedNumber(a.accountNumber),
  },
};
