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
import {
  uploadStart, uploadAppend, uploadContent, uploadRelease,
} from "../services/import/uploadBuffer";
import type {ReportService} from "../services/reportService";
import type {AuditLogService} from "../services/auditLogService";
import type {EvidenceService} from "../services/evidenceService";
import type {PeopleService} from "../services/peopleService";
import type {SanctionsService} from "../services/sanctionsService";
import type {SanctionsRefreshService} from "../services/sanctionsRefreshService";
import type {FawSettings, SettingsService} from "../services/settingsService";
import type {TravelCorrelationService} from "../services/travelCorrelationService";
import type {CaseSessionService} from "../services/caseSessionService";
import type {AnbService} from "../services/anbService";
import type {LocalizationService} from "../services/localizationService";
import type {TelemetryService} from "../services/telemetryService";
import type {NoiseFilter, NoiseFilterService}
  from "../services/noiseFilterService";
import type {CaseGraphService} from "../services/caseGraphService";
import type {AuthService, AuthUser} from "../services/authService";
import type {UpdateService} from "../services/updateService";
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
  people   : PeopleService;
  sanctions : SanctionsService;
  sanctionsRefresh : SanctionsRefreshService;
  settings : SettingsService;
  travel   : TravelCorrelationService;
  session  : CaseSessionService;
  anb      : AnbService;
  i18n     : LocalizationService;
  telemetry : TelemetryService;
  noise    : NoiseFilterService;
  graphs   : CaseGraphService;
  auth     : AuthService;
  update   : UpdateService;
  // The authenticated caller (null when the request carries no valid token).
  user     : AuthUser | null;
  // The raw bearer token, so logout can revoke exactly this session.
  token    : string | null;
}

// Require any logged-in user, or throw a clean auth error.
function requireUser(c: GraphQLContext): AuthUser {
  if (!c.user) throw new Error("Нэвтрэх шаардлагатай");
  return c.user;
}

// Require the ADMIN (department boss) role.
function requireAdmin(c: GraphQLContext): AuthUser {
  const u = requireUser(c);
  if (u.role !== "ADMIN") throw new Error("Зөвхөн админ энэ үйлдлийг хийнэ");
  return u;
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

// CASE SCOPE — when the analyst has an active case, the evidence list queries
// (suspects, bankAccounts, transactions, callRecords, correlations) return
// only that case's records. Membership comes from evidence_entries:
// SUSPECT entries (КЕЙСТ ТЭМДЭГЛЭХ; suspects.caseId is a legacy fallback)
// chain suspect → accounts/phones → txns/calls, and imports link their data
// directly with BANK_ACCOUNT / CALL_RECORD entries so freshly imported rows
// are visible in the case they were imported into. null = no active case.
interface CaseScope {
  suspectIds : Set<number>;
  accountIds : Set<number>;
  txnIds     : Set<number>;
  callIds    : Set<number>;
}

async function caseScope(c: GraphQLContext): Promise<CaseScope | null> {
  const active = await c.session.getCurrentCase();
  if (!active) return null;
  const entries = await c.evidence.getForCase(active.id);
  const by = (t: string) => new Set(
    entries.filter((e) => e.sourceType === t).map((e) => e.sourceId));
  const tagged = by("SUSPECT");
  const all = await c.suspects.getAllSuspects();
  const suspectIds = new Set(
    all.filter((s) => tagged.has(s.id) || s.caseId === active.caseId)
      .map((s) => s.id)
  );
  return {
    suspectIds,
    accountIds: by("BANK_ACCOUNT"),
    txnIds: by("TRANSACTION"),
    callIds: by("CALL_RECORD"),
  };
}

async function scopedAccounts(c: GraphQLContext): Promise<BankAccount[]> {
  const accounts = await c.data.getAllBankAccounts();
  const scope = await caseScope(c);
  if (!scope) return accounts;
  return accounts.filter((a) =>
    (a.suspectId != null && scope.suspectIds.has(a.suspectId))
    || scope.accountIds.has(a.id));
}

function matchesDescRules(
  description: string | null, rules: {mode: string; text: string}[]
): boolean {
  if (!rules.length) return false;
  const d = (description ?? "").toLowerCase();
  return rules.some((r) => {
    const t = r.text.toLowerCase();
    return r.mode === "starts" ? d.startsWith(t)
      : r.mode === "ends" ? d.endsWith(t) : d.includes(t);
  });
}

// Every transaction id the analyst marked "unimportant" for the active case —
// individual ids, sub-threshold amounts, description rules and pair removals
// combined. Applied to EVERY analysis (timeline, correlations, links, charts)
// so removed noise never resurfaces anywhere, not just on the Transactions page.
async function ignoredTxnIds(c: GraphQLContext): Promise<Set<number>> {
  const active = await c.session.getCurrentCase();
  if (!active) return new Set();
  const nf = await c.noise.getForCase(active.id);
  const ignored = new Set<number>(nf.ignoredTxns);
  const hasRules = nf.descRules.length > 0;
  const hasPairs = nf.ignoredPairs.length > 0;
  if (nf.minAmount <= 0 && !hasRules && !hasPairs) return ignored;
  const pairs = new Set(nf.ignoredPairs);
  for (const t of await c.data.getAllTransactions()) {
    if (ignored.has(t.id)) continue;
    if (nf.minAmount > 0 && t.amount < nf.minAmount) { ignored.add(t.id); continue; }
    if (hasRules && matchesDescRules(t.description, nf.descRules)) {
      ignored.add(t.id); continue;
    }
    if (hasPairs) {
      const cp = t.counterpartyAccount?.trim();
      if (cp && pairs.has(`${t.bankAccountId}→${cp}`)) ignored.add(t.id);
    }
  }
  return ignored;
}

export const resolvers = {
  Query: {
    suspects: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const all = await c.suspects.getAllSuspects();
      const scope = await caseScope(c);
      return scope ? all.filter((s) => scope.suspectIds.has(s.id)) : all;
    },
    suspect: (_p: unknown, a: {id: number}, c: GraphQLContext) =>
      c.suspects.getSuspectById(a.id),
    dashboardStats: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getDashboardStats(),
    appVersion: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.update.version(),
    bankAccounts: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      scopedAccounts(c),
    transactions: async (
      _p: unknown, a: {includeRemoved?: boolean}, c: GraphQLContext
    ) => {
      const txns = await c.data.getAllTransactions();
      const scope = await caseScope(c);
      let scoped = txns;
      if (scope) {
        const accountIds = new Set((await scopedAccounts(c)).map((x) => x.id));
        scoped = txns.filter((t) =>
          accountIds.has(t.bankAccountId) || scope.txnIds.has(t.id));
      }
      // Removed-as-noise transactions are hidden EVERYWHERE by default; only
      // the Transactions page asks for them (includeRemoved) so it can manage /
      // restore them.
      if (a.includeRemoved) return scoped;
      const ignored = await ignoredTxnIds(c);
      return ignored.size
        ? scoped.filter((t) => !ignored.has(t.id)) : scoped;
    },
    callRecords: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const calls = await c.data.getAllCallRecords();
      const scope = await caseScope(c);
      if (!scope) return calls;
      return calls.filter((r) =>
        (r.suspectId != null && scope.suspectIds.has(r.suspectId))
        || scope.callIds.has(r.id));
    },
    suspectLinks: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const links = await c.data.getAllLinks();
      const scope = await caseScope(c);
      if (!scope) return links;
      return links.filter((l) =>
        scope.suspectIds.has(l.sourceSuspectId)
        && scope.suspectIds.has(l.targetSuspectId));
    },
    caseFiles: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const all = await c.data.getAllCaseFiles();
      const user = c.user;
      // Unauthenticated → nothing. ADMIN → every case. DETECTIVE → only the
      // cases they own or were granted access to.
      if (!user) return [];
      const ids = await c.auth.accessibleCaseIds(user);
      return ids === null ? all : all.filter((cf) => ids.has(cf.id));
    },
    // The logged-in account (null when unauthenticated) — the frontend uses
    // this to gate the app behind login and to show admin-only UI.
    me: (_p: unknown, _a: unknown, c: GraphQLContext) => c.user,
    // All accounts — the boss's user-management list. Admin only.
    users: (_p: unknown, _a: unknown, c: GraphQLContext) => {
      requireAdmin(c);
      return c.auth.listUsers();
    },
    // Detectives explicitly granted access to a case (admin only).
    caseMembers: (_p: unknown, a: {caseFileId: number}, c: GraphQLContext) => {
      requireAdmin(c);
      return c.auth.caseMembers(a.caseFileId);
    },
    globalPeople: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.people.getGlobalPeople(),
    analysisResults: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.data.getAllAnalysisResults(),
    auditEvents: (_p: unknown, a: {limit?: number}, c: GraphQLContext) =>
      c.data.getAuditEvents(a.limit ?? 500),
    accessLogEntries: (_p: unknown, a: {suspectId?: number}, c: GraphQLContext) =>
      c.data.getAccessLogEntries(a.suspectId ?? null),
    patterns: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.analysis.detectPatterns(),
    correlations: async (_p: unknown, a: {suspectId?: number}, c: GraphQLContext) => {
      const ignored = await ignoredTxnIds(c);
      const hits = await c.analysis.correlateTimeline(a.suspectId ?? null,
        ignored);
      const scope = await caseScope(c);
      return scope
        ? hits.filter((h) => scope.suspectIds.has(h.suspectId)) : hits;
    },
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
      a: {content: string; filename?: string; sheetName?: string;
        uploadId?: string},
      c: GraphQLContext
    ) => c.imports.preview(
      a.uploadId ? uploadContent(a.uploadId) : a.content,
      a.filename ?? null, a.sheetName ?? null),
    excelSheets: (
      _p: unknown,
      a: {content: string; filename: string; uploadId?: string},
      c: GraphQLContext
    ) => c.imports.excelSheets(
      a.uploadId ? uploadContent(a.uploadId) : a.content, a.filename),
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
    reportSuspectPdf: async (
      _p: unknown, a: {suspectId: number; minAmount?: number}, c: GraphQLContext
    ) => {
      const suspect = await c.suspects.getSuspectById(a.suspectId);
      const buf = await c.reports.generateSuspectPdf(
        a.suspectId, a.minAmount ?? 0);
      const safe = (suspect?.suspectId ?? `Suspect-${a.suspectId}`)
        .replace(/[^A-Za-z0-9_-]/g, "");
      const filename = `Suspect-${safe}.pdf`;
      await c.audit.record("Report.Generated", `File:${filename}`,
        suspect?.fullName ?? null);
      return {
        filename,
        mimeType: "application/pdf",
        base64: buf.toString("base64"),
      };
    },
    reportMarkedSuspectsPdf: async (
      _p: unknown, a: {minAmount?: number}, c: GraphQLContext
    ) => {
      const buf = await c.reports.generateMarkedSuspectsPdf(a.minAmount ?? 0);
      const filename = "MarkedSuspects-Transactions.pdf";
      await c.audit.record("Report.Generated", `File:${filename}`,
        "Marked suspects transaction report");
      return {filename, mimeType: "application/pdf", base64: buf.toString("base64")};
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
    caseNoiseFilter: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const active = await c.session.getCurrentCase();
      if (!active) {
        return {minAmount: 0, ignoredPairs: [], ignoredTxns: [], descRules: []};
      }
      return c.noise.getForCase(active.id);
    },
    caseGraphs: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const active = await c.session.getCurrentCase();
      return active ? c.graphs.listForCase(active.id) : [];
    },
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
    selfUpdate: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      requireAdmin(c);
      const r = await c.update.selfUpdate();
      await c.audit.record(
        "System.SelfUpdate",
        `${r.previousCommit}→${r.newCommit}`,
        r.message,
        r.updated ? "HIGH" : "INFO"
      );
      return r;
    },
    createSuspect: async (
      _p: unknown,
      a: {input: SuspectInput},
      c: GraphQLContext
    ) => {
      const s = await c.suspects.createSuspect(a.input);
      await c.audit.record("Suspect.Create", `Suspect:${s.id}`, s.fullName);
      return s;
    },
    markAsSuspect: async (
      _p: unknown, a: {id: number; marked: boolean}, c: GraphQLContext
    ) => {
      const status = a.marked ? "UNDER_INVESTIGATION" : "ACTIVE";
      const s = await c.suspects.setStatus(a.id, status);
      await c.audit.record(
        a.marked ? "Suspect.Marked" : "Suspect.Unmarked",
        `Suspect:${s.id}`, s.fullName, a.marked ? "HIGH" : "INFO");
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
    setSuspectPhoto: async (
      _p: unknown,
      a: {id: number; photoData?: string | null},
      c: GraphQLContext
    ) => {
      const s = await c.suspects.setPhoto(a.id, a.photoData ?? null);
      await c.audit.record("Suspect.Photo", `Suspect:${a.id}`,
        a.photoData ? "set" : "cleared");
      return s;
    },
    deleteSuspect: async (_p: unknown, a: {id: number}, c: GraphQLContext) => {
      const ok = await c.suspects.deleteSuspect(a.id);
      if (ok) await c.audit.record("Suspect.Delete", `Suspect:${a.id}`);
      return ok;
    },
    generateLinks: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const links = await c.analysis.generateLinks(await ignoredTxnIds(c));
      await c.audit.record("Link.Generate", null, `${links.length} links`);
      return links;
    },
    generateSampleData: async (_p: unknown, _a: unknown, c: GraphQLContext) => {
      const active = await c.session.getCurrentCase();
      if (!active) throw new Error("Эхлээд кейс сонгоно уу.");
      const scope = await caseScope(c);
      const ids = scope ? [...scope.suspectIds] : [];
      if (ids.length < 2) {
        throw new Error("Кейст хангалттай хүн алга — эхлээд өгөгдөл оруулна уу.");
      }
      const r = await c.data.generateSampleData(ids);
      // NOTE: never touch the analyst's noise filter here — clearing it wipes
      // their manually-marked "unimportant" transactions. Left untouched.
      // Rebuild the link network so the new calls/devices become connections.
      const links = await c.analysis.generateLinks(await ignoredTxnIds(c));
      await c.audit.record("Data.Sample", null,
        `+${r.networkCalls} calls, ~${r.enrichedCalls} enriched`);
      return {...r, linksCreated: links.length};
    },
    createManualLink: async (
      _p: unknown,
      a: {input: {sourceSuspectId: number; targetSuspectId: number;
        description: string; confidenceLevel?: string; caseGraphId?: number}},
      c: GraphQLContext
    ) => {
      const {sourceSuspectId, targetSuspectId, description} = a.input;
      if (sourceSuspectId === targetSuspectId) {
        throw new Error("Cannot connect a suspect to themselves");
      }
      if (!description?.trim()) throw new Error("Relationship label is required");
      const link = await c.data.createLink({
        sourceSuspectId,
        targetSuspectId,
        linkType: "MANUAL",
        description: description.trim(),
        strength: 3,
        confidenceLevel: (a.input.confidenceLevel as never) ?? "HIGH",
        // The board this connection belongs to (null = default/unsaved view).
        caseGraphId: a.input.caseGraphId ?? null,
      });
      await c.audit.record("Connection.Create", `Link:${link.id}`,
        `${sourceSuspectId}↔${targetSuspectId}: ${description.trim()}`);
      return link;
    },
    updateManualLink: async (
      _p: unknown,
      a: {id: number; description: string; confidenceLevel?: string},
      c: GraphQLContext
    ) => {
      if (!a.description?.trim()) throw new Error("Relationship label is required");
      const link = await c.data.updateLink(a.id, {
        description: a.description.trim(),
        ...(a.confidenceLevel
          ? {confidenceLevel: a.confidenceLevel as never} : {}),
      });
      await c.audit.record("Connection.Update", `Link:${a.id}`,
        a.description.trim());
      return link;
    },
    deleteManualLink: async (
      _p: unknown,
      a: {id: number},
      c: GraphQLContext
    ) => {
      const ok = await c.data.deleteLink(a.id);
      if (ok) await c.audit.record("Connection.Delete", `Link:${a.id}`);
      return ok;
    },
    saveCaseNoiseFilter: async (
      _p: unknown,
      a: {input: NoiseFilter},
      c: GraphQLContext
    ) => {
      const active = await c.session.getCurrentCase();
      if (!active) throw new Error("No active case");
      const saved = await c.noise.saveForCase(active.id, a.input);
      await c.audit.record("NoiseFilter.Save", `Case:${active.id}`,
        `floor=${saved.minAmount} pairs=${saved.ignoredPairs.length} `
        + `txns=${saved.ignoredTxns.length} rules=${saved.descRules.length}`);
      return saved;
    },
    createCaseGraph: async (
      _p: unknown,
      a: {name: string; state: string; claimUnassignedLinks?: boolean},
      c: GraphQLContext
    ) => {
      const active = await c.session.getCurrentCase();
      if (!active) throw new Error("No active case");
      const g = await c.graphs.create(active.id, a.name, a.state);
      // "Save current graph" from the default (no-board) view: adopt the manual
      // connections drawn there into this new board so they travel with it.
      if (a.claimUnassignedLinks) {
        await c.data.claimUnassignedManualLinks(g.id);
      }
      await c.audit.record("Graph.Create", `Graph:${g.id}`, g.name);
      return g;
    },
    updateCaseGraph: async (
      _p: unknown,
      a: {id: number; name?: string; state?: string},
      c: GraphQLContext
    ) => {
      const g = await c.graphs.update(a.id, {name: a.name, state: a.state});
      await c.audit.record("Graph.Update", `Graph:${a.id}`, g.name);
      return g;
    },
    deleteCaseGraph: async (
      _p: unknown,
      a: {id: number},
      c: GraphQLContext
    ) => {
      // Deleting a board also removes the manual connections that belong to it,
      // so they don't linger as orphans that show in no view.
      await c.data.deleteManualLinksForGraph(a.id);
      const ok = await c.graphs.remove(a.id);
      if (ok) await c.audit.record("Graph.Delete", `Graph:${a.id}`);
      return ok;
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
        subjectNumber?: string;
        mapping?: {field: string; column: string}[]; uploadId?: string},
      c: GraphQLContext
    ) => {
      // Imported data ALWAYS belongs to a case — there is no such thing as a
      // caseless import. Refuse before touching the file so nothing can land
      // unscoped in the database.
      const active = await c.session.getCurrentCase();
      if (!active) {
        if (a.uploadId) uploadRelease(a.uploadId);
        throw new Error("Импорт хийхийн өмнө кейс сонгоно уу.");
      }
      const mapping = a.mapping
        ? Object.fromEntries(a.mapping.map((m) => [m.field, m.column]))
        : null;
      const content = a.uploadId ? uploadContent(a.uploadId) : a.content;
      const sum = await c.imports.importData({
        content, kind: a.kind,
        bankAccountId: a.bankAccountId ?? null,
        filename: a.filename ?? null, sheetName: a.sheetName ?? null,
        subjectSuspectId: a.subjectSuspectId ?? null,
        subjectNumber: a.subjectNumber ?? null, mapping,
      });
      await c.audit.record("Import.Run", sum.domain,
        `${sum.importedRows}/${sum.totalRows} rows`);
      // Link the import to the active case by tagging its OWNERS — suspects and
      // accounts (a bounded handful). Their transactions and call records scope
      // into the case through that ownership, so we never tag the potentially
      // thousands of individual rows (that turned a CDR import into ~5 DB writes
      // per call → gateway timeout).
      if (sum.importedRows > 0) {
        const src = a.filename ?? "импорт";
        for (const id of sum.touchedSuspectIds ?? []) {
          await c.evidence.tag(active.id, "SUSPECT", id,
            `Импорт: ${src}`).catch(() => undefined);
        }
        for (const id of sum.touchedAccountIds ?? []) {
          await c.evidence.tag(active.id, "BANK_ACCOUNT", id,
            `Импорт: ${src}`).catch(() => undefined);
        }
      }
      // A chunked upload has served its purpose once the import runs; free it
      // so the staging buffer does not linger until the TTL sweep.
      if (a.uploadId) uploadRelease(a.uploadId);
      return sum;
    },
    uploadStart: () => uploadStart(),
    uploadAppend: (
      _p: unknown,
      a: {uploadId: string; chunk: string}
    ) => uploadAppend(a.uploadId, a.chunk),
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
    setActiveCase: async (
      _p: unknown, a: {caseFileId?: number}, c: GraphQLContext
    ) => {
      const user = requireUser(c);
      const id = a.caseFileId ?? null;
      // A detective may only open a case they have access to.
      if (id != null && !(await c.auth.canAccessCase(user, id))) {
        throw new Error("Энэ кейс рүү хандах эрхгүй байна");
      }
      return c.session.setCurrentCase(id);
    },
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
      const user = requireUser(c);
      // Stamp the creator as owner so a detective's own cases stay scoped to
      // them without needing an explicit membership grant.
      const cf = await c.data.createCaseFile({...a.input, ownerUserId: user.id});
      await c.audit.record("CaseFile.Create", `CaseFile:${cf.id}`, cf.caseId);
      return cf;
    },
    updateCaseFile: async (
      _p: unknown,
      a: {caseFileId: number; input: Record<string, unknown>},
      c: GraphQLContext
    ) => {
      const cf = await c.data.updateCaseFile(a.caseFileId, a.input);
      if (!cf) throw new Error(`CaseFile ${a.caseFileId} not found`);
      await c.audit.record("CaseFile.Update", `CaseFile:${cf.id}`, cf.caseId);
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
      // Closing/archiving the case the analyst is working in unselects it —
      // finished cases are not a workspace.
      if (a.status === "CLOSED" || a.status === "ARCHIVED") {
        const active = await c.session.getCurrentCase();
        if (active?.id === cf.id) await c.session.setCurrentCase(null);
      }
      return cf;
    },
    mergeCases: async (
      _p: unknown,
      a: {sourceCaseFileIds: number[]; targetCaseFileId: number},
      c: GraphQLContext
    ) => {
      // Merging detectives' cases (and their data) into one big case is a
      // boss-only power.
      requireAdmin(c);
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
    // --- Auth & accounts --------------------------------------------------
    login: async (
      _p: unknown,
      a: {username: string; password: string; deviceId?: string},
      c: GraphQLContext
    ) => {
      const res = await c.auth.login(a.username, a.password, a.deviceId ?? null);
      await c.audit.record("Auth.Login", `User:${res.user.id}`,
        res.user.username);
      return res;
    },
    logout: (_p: unknown, _a: unknown, c: GraphQLContext) =>
      c.auth.logout(c.token),
    createUser: async (
      _p: unknown,
      a: {input: {username: string; password: string; fullName?: string;
        role?: "ADMIN" | "DETECTIVE"}},
      c: GraphQLContext
    ) => {
      requireAdmin(c);
      const u = await c.auth.createUser(a.input);
      await c.audit.record("User.Create", `User:${u.id}`,
        `${u.username} (${u.role})`);
      return u;
    },
    setUserActive: async (
      _p: unknown, a: {userId: number; active: boolean}, c: GraphQLContext
    ) => {
      const admin = requireAdmin(c);
      if (a.userId === admin.id) {
        throw new Error("Өөрийн бүртгэлээ идэвхгүй болгож болохгүй");
      }
      const u = await c.auth.setActive(a.userId, a.active);
      await c.audit.record("User.SetActive", `User:${u.id}`,
        a.active ? "activated" : "deactivated");
      return u;
    },
    resetUserPassword: async (
      _p: unknown, a: {userId: number; password: string}, c: GraphQLContext
    ) => {
      requireAdmin(c);
      const ok = await c.auth.resetPassword(a.userId, a.password);
      await c.audit.record("User.ResetPassword", `User:${a.userId}`, "");
      return ok;
    },
    // Boss forgets a detective's device binding so they can log in from a new
    // computer (which re-registers on first login).
    resetUserDevice: async (
      _p: unknown, a: {userId: number}, c: GraphQLContext
    ) => {
      requireAdmin(c);
      const ok = await c.auth.resetDevices(a.userId);
      await c.audit.record("User.ResetDevice", `User:${a.userId}`, "");
      return ok;
    },
    grantCaseAccess: async (
      _p: unknown, a: {caseFileId: number; userId: number}, c: GraphQLContext
    ) => {
      requireAdmin(c);
      const ok = await c.auth.grantAccess(a.caseFileId, a.userId);
      await c.audit.record("CaseFile.GrantAccess",
        `CaseFile:${a.caseFileId}`, `User:${a.userId}`);
      return ok;
    },
    revokeCaseAccess: async (
      _p: unknown, a: {caseFileId: number; userId: number}, c: GraphQLContext
    ) => {
      requireAdmin(c);
      const ok = await c.auth.revokeAccess(a.caseFileId, a.userId);
      await c.audit.record("CaseFile.RevokeAccess",
        `CaseFile:${a.caseFileId}`, `User:${a.userId}`);
      return ok;
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
  },

  User: {
    // Whether this account is currently locked to a device (admin UI shows a
    // reset button when true). Only meaningful for detectives.
    deviceBound: (u: {id: number}, _a: unknown, c: GraphQLContext) =>
      c.auth.hasBoundDevice(u.id),
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

  SuspectLink: {
    // The DB stores contributing txn ids as a JSON string; expose a real list
    // so the client can re-total the link under the active noise filter.
    contributingTxnIds: (l: {contributingTxnIds: string | null}) => {
      if (typeof l.contributingTxnIds !== "string") return [];
      try {
        const v = JSON.parse(l.contributingTxnIds);
        return Array.isArray(v) ? v.filter((n) => Number.isFinite(n)) : [];
      } catch {
        return [];
      }
    },
  },
};
