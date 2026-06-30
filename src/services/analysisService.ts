/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : analysisService.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {
  AnalysisResult,
  BankAccount,
  BankTransaction,
  CallRecord,
  SuspectLink,
} from "../models/types";
import type {RiskLevel} from "../models/enums";
import {
  AmlThresholds,
  dayOfWeekOf,
  hourOf,
  isNearThreshold,
  isOffHours,
  isRoundNumber,
  isWeekend,
  leadingDigit,
  money,
  signedAmount,
  type AmlConfig,
} from "./amlThresholds";
import type {DataService, SuspectWithRelations} from "./dataService";
import {FraudScoringModel} from "./fraudScoringModel";

// Ported from Services/ForensicAnalysisService.cs.

export const FeatureRuleIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export interface RuleViolation {
  ruleId      : number;
  ruleName    : string;
  severity    : string;
  description : string;
  score       : number;
  timestamp   : string | null;
}

export interface RuleEngineResult {
  bankAccountId : number;
  violations    : RuleViolation[];
  baseScore     : number;
  ruleBoost     : number;
  finalScore    : number;
  criticalFlags : number;
  highFlags     : number;
  finalAction   : string;
  finalRisk     : string;
  modelScore    : number | null;
  modelAction   : string;
}

export interface PatternAlert {
  alertType        : string;
  severity         : string;
  description      : string;
  timestamp        : string;
  relatedAccountId : number | null;
}

export interface CorrelationHit {
  suspectId             : number;
  suspectName           : string;
  date                  : string;
  transactionTime       : string;
  transactionAmount     : number;
  transactionType       : string;
  transactionDescription : string | null;
  callTime              : string;
  callerNumber          : string;
  calledNumber          : string;
  callDuration          : number;
  timeDifferenceMinutes : number;
  severity              : string;
}

export interface RecipientInfo {
  account: string;
  name: string;
  totalAmount: number;
  count: number;
}
export interface CategoryInfo {
  category: string;
  count: number;
  totalAmount: number;
}
export interface ChannelInfo {
  channel: string;
  count: number;
  totalAmount: number;
}
export interface MonthlyTrend {
  label: string;
  credits: number;
  debits: number;
  count: number;
}

export interface AccountStatistics {
  bankAccountId         : number;
  totalTransactions     : number;
  totalAmount           : number;
  averageAmount         : number;
  medianAmount          : number;
  maxAmount             : number;
  minAmount             : number;
  stdDeviation          : number;
  totalDebits           : number;
  totalCredits          : number;
  debitCount            : number;
  creditCount           : number;
  debitCreditRatio      : number;
  netFlow               : number;
  peakHour              : number;
  peakDay               : string;
  hourlyDistribution    : number[];
  dayOfWeekDistribution : number[];
  topRecipients         : RecipientInfo[];
  categoryBreakdown     : CategoryInfo[];
  channelBreakdown      : ChannelInfo[];
  monthlyTrends         : MonthlyTrend[];
}

export interface NetworkFlowData {
  nodeLabels    : string[];
  nodeColors    : string[];
  sourceIndices : number[];
  targetIndices : number[];
  values        : number[];
  linkColors    : string[];
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday"];

export class AnalysisService {
  private readonly db: DataService;
  private readonly model: FraudScoringModel;

  constructor(db: DataService, model?: FraudScoringModel) {
    this.db = db;
    this.model = model ?? new FraudScoringModel();
  }

  // === FULL ACCOUNT ANALYSIS ============================================
  async analyzeAccount(bankAccountId: number): Promise<Partial<AnalysisResult>> {
    const txns = await this.db.getTransactionsForAccount(bankAccountId);
    return this.analyzeAccountCore(bankAccountId, txns);
  }

  private analyzeAccountCore(
    bankAccountId: number,
    transactions: BankTransaction[]
  ): Partial<AnalysisResult> {
    if (transactions.length === 0) {
      return {bankAccountId, riskLevel: "LOW", verdict: "No transactions"};
    }
    const cfg = AmlThresholds.current;
    const result: Partial<AnalysisResult> = {
      bankAccountId,
      analyzedAt: new Date().toISOString(),
    };

    const [passes, chi, pval] = benfordsLaw(transactions);
    result.benfordPasses = passes;
    result.benfordChiSquared = chi;
    result.benfordPValue = pval;

    const nearThreshold = transactions.filter((t) => isNearThreshold(cfg, t)).length;
    result.nearThresholdCount = nearThreshold;
    result.nearThresholdPercentage = nearThreshold / transactions.length * 100;

    const times = transactions.map((t) => new Date(t.timestamp).getTime());
    const totalDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
    const byDay = groupBy(transactions, (t) => t.timestamp.slice(0, 10));
    const dailyCounts = [...byDay.values()].map((g) => g.length);
    result.avgTransactionsPerDay = totalDays > 0
      ? transactions.length / totalDays : transactions.length;
    result.maxTransactionsPerDay = dailyCounts.length ? Math.max(...dailyCounts) : 0;
    const weeklyGroups = [...groupBy(transactions,
      (t) => String(cultureWeek(t.timestamp))).values()].map((g) => g.length);
    result.weeklyVelocityStdDev = weeklyGroups.length > 1
      ? stdDev(weeklyGroups) : 0;

    const roundCount = transactions.filter((t) => isRoundNumber(cfg, t)).length;
    result.roundNumberCount = roundCount;
    result.roundNumberPercentage = roundCount / transactions.length * 100;

    const offHours = transactions.filter((t) => isOffHours(cfg, t)).length;
    result.offHoursCount = offHours;
    result.offHoursPercentage = offHours / transactions.length * 100;
    const weekendCount = transactions.filter((t) => isWeekend(t)).length;
    result.weekendPercentage = weekendCount / transactions.length * 100;

    result.velocityScore = Math.min(100, result.avgTransactionsPerDay! * 10);
    const amounts = transactions.map((t) => t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const cv = amounts.length > 1 && avg !== 0 ? stdDev(amounts) / avg * 100 : 0;
    result.amountVarianceScore = Math.min(100, cv);
    result.roundNumberScore = result.roundNumberPercentage!;
    result.offHoursScore = Math.min(100, result.offHoursPercentage! * 2);
    result.nearThresholdScore = Math.min(100, result.nearThresholdPercentage! * 5);
    const categoryCount = new Set(transactions.map((t) => t.category)).size;
    result.categoryDiversityScore = Math.min(100, categoryCount * 10);

    result.overallRisk = (result.velocityScore + result.amountVarianceScore
      + result.roundNumberScore + result.offHoursScore
      + result.nearThresholdScore + result.categoryDiversityScore) / 6;

    result.riskLevel = (result.overallRisk >= 60 ? "HIGH"
      : result.overallRisk >= 35 ? "MEDIUM" : "LOW") as RiskLevel;

    const flags: string[] = [];
    if (!result.benfordPasses) flags.push("Benford anomaly");
    if (result.nearThresholdPercentage! > 10) flags.push("Potential structuring");
    if (result.roundNumberPercentage! > 30) flags.push("Excessive round amounts");
    if (result.offHoursPercentage! > 40) flags.push("High off-hours activity");
    if (result.avgTransactionsPerDay! > 5) flags.push("High velocity");
    result.verdict = flags.length === 0
      ? "No significant anomalies detected" : flags.join("; ");

    return result;
  }

  // === RULE ENGINE ======================================================
  async runRuleEngine(bankAccountId: number): Promise<RuleEngineResult> {
    const txns = await this.db.getTransactionsForAccount(bankAccountId);
    return this.runRuleEngineCore(bankAccountId, txns);
  }

  private runRuleEngineCore(
    bankAccountId: number,
    transactions: BankTransaction[]
  ): RuleEngineResult {
    const result: RuleEngineResult = {
      bankAccountId, violations: [], baseScore: 0, ruleBoost: 0,
      finalScore: 0, criticalFlags: 0, highFlags: 0,
      finalAction: "ALLOW", finalRisk: "NORMAL", modelScore: null, modelAction: "",
    };
    if (transactions.length === 0) return result;

    const cfg = AmlThresholds.current;
    const M = (x: number) => money(cfg, x);
    const ordered = [...transactions].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp));
    const amounts = transactions.map((t) => t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sd = amounts.length > 1 ? stdDev(amounts) : 0;

    // Rule 1: Velocity — >=5 txns inside a 10-minute window.
    for (let i = 0; i < ordered.length - 4; i++) {
      const window = ordered.slice(i, i + 6);
      if (window.length >= 5) {
        const span = minutesBetween(window[window.length - 1].timestamp,
          window[0].timestamp);
        if (span < 10) {
          result.violations.push({
            ruleName: "Velocity Attack", ruleId: 1, severity: "HIGH",
            description: `${window.length} transactions in ${span.toFixed(0)} minutes`,
            score: 0.3, timestamp: window[0].timestamp,
          });
          break;
        }
      }
    }

    // Rule 2: Amount anomaly — z-score > 3.
    if (sd > 0) {
      const anomalies = ordered.filter((t) =>
        Math.abs((t.amount - avg) / sd) > 3).slice(0, 5);
      for (const t of anomalies) {
        const z = (t.amount - avg) / sd;
        result.violations.push({
          ruleName: "Amount Anomaly", ruleId: 2, severity: "HIGH",
          description: `${M(t.amount)} (Z-score: ${z.toFixed(2)}) on ${t.timestamp.slice(0, 10)}`,
          score: 0.2, timestamp: t.timestamp,
        });
      }
    }

    // Rule 3: Structuring (aggregate) — 3+ sub-threshold txns to the same
    // counterparty in one ISO week summing to >= reporting threshold.
    const clusters = groupBy(
      ordered.filter((t) => t.counterpartyAccount
        && t.amount < cfg.cashReportingThreshold),
      (t) => `${t.counterpartyAccount}|${isoWeekYear(t.timestamp)}-${isoWeek(t.timestamp)}`
    );
    let clusterCount = 0;
    for (const [, group] of clusters) {
      if (clusterCount >= 5) break;
      const sum = group.reduce((a, b) => a + b.amount, 0);
      if (group.length >= 3 && sum >= cfg.cashReportingThreshold) {
        const first = group.reduce((a, b) => a.timestamp < b.timestamp ? a : b);
        result.violations.push({
          ruleName: "Structuring Pattern (Aggregate)", ruleId: 3, severity: "CRITICAL",
          description: `${group.length} sub-threshold transactions to `
            + `'${group[0].counterpartyAccount}' totalling ${M(sum)} in ISO week `
            + `${isoWeekYear(group[0].timestamp)}-W${String(isoWeek(group[0].timestamp)).padStart(2, "0")}`,
          score: 0.4, timestamp: first.timestamp,
        });
        clusterCount++;
      }
    }

    // Rule 4: Approaching threshold (auxiliary) — skip counterparties Rule 3 hit.
    const approaching = groupBy(
      ordered.filter((t) => isNearThreshold(cfg, t) && t.counterpartyAccount
        && !result.violations.some((v) => v.ruleId === 3
          && (v.description?.includes(t.counterpartyAccount ?? "") ?? false))),
      (t) => t.counterpartyAccount ?? ""
    );
    let approachingCount = 0;
    for (const [key, group] of approaching) {
      if (approachingCount >= 3) break;
      result.violations.push({
        ruleName: "Approaching Threshold", ruleId: 4, severity: "MEDIUM",
        description: `${group.length} transaction(s) to '${key}' in the structuring band `
          + `[${M(cfg.nearThresholdRangeLow)} – ${M(cfg.nearThresholdRangeHigh)})`,
        score: 0.1, timestamp: group[0].timestamp,
      });
      approachingCount++;
    }

    // Rule 5: Round amount pattern in last 10.
    const last10 = ordered.slice(-10);
    const roundCount = last10.filter((t) => isRoundNumber(cfg, t)).length;
    if (roundCount >= 5) {
      result.violations.push({
        ruleName: "Round Amount Pattern", ruleId: 5, severity: "MEDIUM",
        description: `${roundCount}/10 recent transactions are round amounts (mod ${M(cfg.roundNumberModulus)})`,
        score: 0.15, timestamp: null,
      });
    }

    // Rule 6: New recipient surge — >10 unique recipients in one day.
    const byDayRecipients = groupBy(
      ordered.filter((t) => t.counterpartyAccount),
      (t) => t.timestamp.slice(0, 10));
    let surgeCount = 0;
    for (const [day, group] of byDayRecipients) {
      if (surgeCount >= 3) break;
      const unique = new Set(group.map((t) => t.counterpartyAccount)).size;
      if (unique > 10) {
        result.violations.push({
          ruleName: "New Recipient Surge", ruleId: 6, severity: "HIGH",
          description: `${unique} unique recipients on ${day}`,
          score: 0.25, timestamp: group[0].timestamp,
        });
        surgeCount++;
      }
    }

    // Rule 7: Night activity — high-value txns in night band.
    const night = ordered.filter((t) => {
      const h = hourOf(t.timestamp);
      return h >= cfg.nightHoursStart && h < cfg.nightHoursEnd
        && t.amount > cfg.highValueTxnFloor;
    });
    if (night.length > 0) {
      result.violations.push({
        ruleName: "Suspicious Night Activity", ruleId: 7, severity: "MEDIUM",
        description: `${night.length} high-value transactions between `
          + `${String(cfg.nightHoursStart).padStart(2, "0")}:00 and `
          + `${String(cfg.nightHoursEnd).padStart(2, "0")}:00`,
        score: 0.15, timestamp: night[0].timestamp,
      });
    }

    // Rule 10: Mule — inflow >= MIN and outflow >= ratio*inflow same day.
    const byDay = groupBy(ordered, (t) => t.timestamp.slice(0, 10));
    for (const [day, group] of byDay) {
      const credits = group.filter((t) => t.type === "credit")
        .reduce((a, b) => a + b.amount, 0);
      const debits = group.filter((t) => t.type === "debit")
        .reduce((a, b) => a + b.amount, 0);
      if (credits > cfg.muleDailyInflowMin && debits > credits * cfg.muleOutflowRatio) {
        result.violations.push({
          ruleName: "Mule Account Pattern", ruleId: 10, severity: "CRITICAL",
          description: `Inflow ${M(credits)}, outflow ${M(debits)} `
            + `(${(debits / credits * 100).toFixed(0)}%) on ${day}`,
          score: 0.4, timestamp: group[0].timestamp,
        });
        break;
      }
    }

    // Rule 11: Smurfing — many small credits from >=3 distinct sources.
    const byDaySmall = groupBy(
      ordered.filter((t) => t.type === "credit" && t.amount < cfg.smurfingUnitMax),
      (t) => t.timestamp.slice(0, 10));
    for (const [day, group] of byDaySmall) {
      const sources = new Set(group.map((t) => t.counterpartyAccount)
        .filter((a) => a)).size;
      const total = group.reduce((a, b) => a + b.amount, 0);
      if (sources >= 3 && total > cfg.smurfingDailyTotalMin) {
        result.violations.push({
          ruleName: "Smurfing Detected", ruleId: 11, severity: "CRITICAL",
          description: `${sources} sources, total ${M(total)} on ${day}`,
          score: 0.35, timestamp: group[0].timestamp,
        });
        break;
      }
    }

    // Rule 12: Round-trip — credit/debit pair within ~5%.
    let foundRoundTrip = false;
    for (let i = 0; i < Math.min(ordered.length - 1, 200) && !foundRoundTrip; i++) {
      for (let j = i + 1; j < Math.min(i + 10, ordered.length); j++) {
        if (ordered[i].type !== ordered[j].type
          && Math.abs(ordered[i].amount - ordered[j].amount) < ordered[i].amount * 0.05
          && ordered[i].amount > cfg.highValueTxnFloor) {
          result.violations.push({
            ruleName: "Round-Trip Transfer", ruleId: 12, severity: "HIGH",
            description: `${M(ordered[i].amount)} ${ordered[i].type} reversed as `
              + `${M(ordered[j].amount)} ${ordered[j].type}`,
            score: 0.2, timestamp: ordered[j].timestamp,
          });
          foundRoundTrip = true;
          break;
        }
      }
    }

    result.baseScore = Math.min(1, result.violations.reduce((a, v) => a + v.score, 0));
    result.criticalFlags = result.violations.filter((v) => v.severity === "CRITICAL").length;
    result.highFlags = result.violations.filter((v) => v.severity === "HIGH").length;
    result.ruleBoost = result.criticalFlags * 0.1 + result.highFlags * 0.05;
    result.finalScore = Math.min(1, result.baseScore + result.ruleBoost);
    result.finalAction = result.finalScore >= 0.75 ? "BLOCK"
      : result.finalScore >= 0.5 ? "HOLD FOR REVIEW"
      : result.finalScore >= 0.3 ? "MONITOR" : "ALLOW";
    result.finalRisk = result.finalScore >= 0.75 ? "HIGH"
      : result.finalScore >= 0.5 ? "MEDIUM"
      : result.finalScore >= 0.3 ? "LOW" : "NORMAL";

    if (this.model.isTrained && this.model.featureCount === FeatureRuleIds.length) {
      const features = featuresFromViolations(result);
      result.modelScore = this.model.predict(features);
      result.modelAction = bandFromScore(result.modelScore);
    }
    return result;
  }

  // === FRAUD WORKFLOW (per-account analysis + rules + Benford) ==========
  async fraudWorkflow(): Promise<{
    bankAccountId: number;
    accountName: string;
    analysis: Partial<AnalysisResult>;
    ruleResult: RuleEngineResult;
    benfordObserved: number[];
  }[]> {
    const accounts = await this.db.getAllBankAccounts();
    const out = [];
    for (const a of accounts) {
      const txns = await this.db.getTransactionsForAccount(a.id);
      const masked = a.accountNumber.length > 4
        ? "*".repeat(a.accountNumber.length - 4) + a.accountNumber.slice(-4)
        : a.accountNumber;
      out.push({
        bankAccountId: a.id,
        accountName: `${a.bankName ?? "Банк"} - ${masked}`,
        analysis: this.analyzeAccountCore(a.id, txns),
        ruleResult: this.runRuleEngineCore(a.id, txns),
        benfordObserved: computeBenfordObserved(txns),
      });
    }
    return out;
  }

  // === TRANSACTION DRILL-DOWN ===========================================
  async buildTransactionDrillDown(transactionId: number): Promise<{
    target: BankTransaction | null;
    relatedWindow: BankTransaction[];
    ruleResult: RuleEngineResult;
  }> {
    const target = await this.db.getTransactionById(transactionId);
    if (!target) {
      return {
        target: null, relatedWindow: [],
        ruleResult: {
          bankAccountId: 0, violations: [], baseScore: 0, ruleBoost: 0,
          finalScore: 0, criticalFlags: 0, highFlags: 0, finalAction: "ALLOW",
          finalRisk: "NORMAL", modelScore: null, modelAction: "",
        },
      };
    }
    const relatedWindow = await this.db.getTransactionsAround(
      target.bankAccountId, target.timestamp, 10, target.id);
    const ruleResult = await this.runRuleEngine(target.bankAccountId);
    return {target, relatedWindow, ruleResult};
  }

  // === ACCOUNT STATISTICS ===============================================
  async getAccountStatistics(bankAccountId: number): Promise<AccountStatistics> {
    const transactions = await this.db.getTransactionsForAccount(bankAccountId);
    const stats: AccountStatistics = {
      bankAccountId, totalTransactions: 0, totalAmount: 0, averageAmount: 0,
      medianAmount: 0, maxAmount: 0, minAmount: 0, stdDeviation: 0,
      totalDebits: 0, totalCredits: 0, debitCount: 0, creditCount: 0,
      debitCreditRatio: 0, netFlow: 0, peakHour: 0, peakDay: "",
      hourlyDistribution: new Array(24).fill(0),
      dayOfWeekDistribution: new Array(7).fill(0),
      topRecipients: [], categoryBreakdown: [], channelBreakdown: [],
      monthlyTrends: [],
    };
    if (transactions.length === 0) return stats;

    const amounts = transactions.map((t) => t.amount);
    stats.totalTransactions = transactions.length;
    stats.totalAmount = amounts.reduce((a, b) => a + b, 0);
    stats.averageAmount = stats.totalAmount / transactions.length;
    stats.medianAmount = median(amounts);
    stats.maxAmount = Math.max(...amounts);
    stats.minAmount = Math.min(...amounts);
    stats.stdDeviation = stdDev(amounts);
    stats.totalDebits = transactions.filter((t) => t.type === "debit")
      .reduce((a, b) => a + b.amount, 0);
    stats.totalCredits = transactions.filter((t) => t.type === "credit")
      .reduce((a, b) => a + b.amount, 0);
    stats.debitCount = transactions.filter((t) => t.type === "debit").length;
    stats.creditCount = transactions.filter((t) => t.type === "credit").length;
    stats.debitCreditRatio = stats.totalCredits > 0
      ? stats.totalDebits / stats.totalCredits : 0;
    stats.netFlow = stats.totalCredits - stats.totalDebits;

    for (const t of transactions) {
      stats.hourlyDistribution[hourOf(t.timestamp)]++;
      stats.dayOfWeekDistribution[dayOfWeekOf(t.timestamp)]++;
    }
    stats.peakHour = stats.hourlyDistribution.indexOf(Math.max(...stats.hourlyDistribution));
    stats.peakDay = DOW_NAMES[stats.dayOfWeekDistribution.indexOf(
      Math.max(...stats.dayOfWeekDistribution))];

    stats.topRecipients = [...groupBy(
      transactions.filter((t) => t.counterpartyAccount),
      (t) => t.counterpartyAccount!).entries()]
      .map(([account, g]) => ({
        account, name: g[0].counterpartyName ?? account,
        totalAmount: g.reduce((a, b) => a + b.amount, 0), count: g.length,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10);

    stats.categoryBreakdown = [...groupBy(transactions,
      (t) => t.category ?? "Other").entries()]
      .map(([category, g]) => ({
        category, count: g.length, totalAmount: g.reduce((a, b) => a + b.amount, 0),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    stats.channelBreakdown = [...groupBy(transactions,
      (t) => t.channel ?? "Unknown").entries()]
      .map(([channel, g]) => ({
        channel, count: g.length, totalAmount: g.reduce((a, b) => a + b.amount, 0),
      }))
      .sort((a, b) => b.count - a.count);

    stats.monthlyTrends = [...groupBy(transactions,
      (t) => t.timestamp.slice(0, 7)).entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, g]) => ({
        label,
        credits: g.filter((t) => t.type === "credit").reduce((a, b) => a + b.amount, 0),
        debits: g.filter((t) => t.type === "debit").reduce((a, b) => a + b.amount, 0),
        count: g.length,
      }));

    return stats;
  }

  // === PATTERN DETECTION ================================================
  async detectPatterns(): Promise<PatternAlert[]> {
    const alerts: PatternAlert[] = [];
    const cfg = AmlThresholds.current;
    const M = (x: number) => money(cfg, x);

    const allTxns = await this.db.getAllTransactions();
    const byAccount = groupBy(allTxns, (t) => String(t.bankAccountId));

    for (const [acctIdStr, list] of byAccount) {
      const acctId = Number(acctIdStr);
      const ordered = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      let prev: BankTransaction | null = null;
      let rapidCount = 0;
      let roundTripCount = 0;
      const recent: BankTransaction[] = [];
      for (const t of ordered) {
        if (prev && rapidCount < 3) {
          const gap = minutesBetween(t.timestamp, prev.timestamp);
          if (gap < 5 && t.amount > cfg.highValueTxnFloor) {
            alerts.push({
              alertType: "RAPID_TRANSACTIONS", severity: "HIGH",
              description: `Rapid transactions: ${M(prev.amount)} then ${M(t.amount)} within ${gap.toFixed(0)} minutes`,
              timestamp: t.timestamp, relatedAccountId: acctId,
            });
            rapidCount++;
          }
        }
        if (roundTripCount < 3) {
          for (let k = recent.length - 1; k >= Math.max(0, recent.length - 10); k--) {
            const prior = recent[k];
            if (prior.type !== t.type
              && Math.abs(prior.amount - t.amount) < prior.amount * 0.05
              && prior.amount > cfg.highValueTxnFloor) {
              alerts.push({
                alertType: "ROUND_TRIP", severity: "HIGH",
                description: `Round-trip: ${M(prior.amount)} ${prior.type} reversed as ${M(t.amount)} ${t.type}`,
                timestamp: t.timestamp, relatedAccountId: acctId,
              });
              roundTripCount++;
              break;
            }
          }
        }
        prev = t;
        recent.push(t);
        if (recent.length > 16) recent.shift();
        if (rapidCount >= 3 && roundTripCount >= 3) break;
      }
    }

    // Smurfing: group by (account, day).
    const smurfDays = groupBy(
      allTxns.filter((t) => t.type === "credit" && t.amount < cfg.smurfingUnitMax),
      (t) => `${t.bankAccountId}|${t.timestamp.slice(0, 10)}`);
    for (const [key, group] of smurfDays) {
      const sources = new Set(group.map((t) => t.counterpartyAccount)
        .filter((a) => a)).size;
      const total = group.reduce((a, b) => a + b.amount, 0);
      if (sources >= 3 && total > cfg.smurfingDailyTotalMin) {
        const [acct, day] = key.split("|");
        alerts.push({
          alertType: "SMURFING", severity: "CRITICAL",
          description: `Smurfing: ${sources} sources depositing ${M(total)} on ${day}`,
          timestamp: group[0].timestamp, relatedAccountId: Number(acct),
        });
      }
    }

    // Burst calling: 5 calls from one caller in <30 min.
    const allCalls = await this.db.getAllCallRecords();
    const byCaller = groupBy(allCalls, (c) => c.callerNumber);
    for (const [caller, calls] of byCaller) {
      const ordered = [...calls].sort((a, b) => a.startTime.localeCompare(b.startTime));
      let window: CallRecord[] = [];
      let bursts = 0;
      for (const c of ordered) {
        window.push(c);
        if (window.length > 5) window.shift();
        if (window.length === 5 && bursts < 3) {
          const span = minutesBetween(window[4].startTime, window[0].startTime);
          if (span < 30) {
            alerts.push({
              alertType: "BURST_CALLING", severity: "MEDIUM",
              description: `Burst: 5 calls from ${caller} in ${span.toFixed(0)} minutes`,
              timestamp: window[0].startTime, relatedAccountId: null,
            });
            bursts++;
            window = [];
          }
        }
        if (bursts >= 3) break;
      }
    }

    const sevRank = (s: string) =>
      s === "CRITICAL" ? 4 : s === "HIGH" ? 3 : s === "MEDIUM" ? 2 : 1;
    return alerts
      .sort((a, b) => sevRank(b.severity) - sevRank(a.severity)
        || b.timestamp.localeCompare(a.timestamp))
      .slice(0, 100);
  }

  // === TIMELINE CORRELATION =============================================
  async correlateTimeline(suspectId?: number | null): Promise<CorrelationHit[]> {
    const suspects = await this.db.getSuspectsWithRelations();
    const targets = suspectId != null
      ? suspects.filter((s) => s.id === suspectId) : suspects;
    const hits: CorrelationHit[] = [];
    if (targets.length === 0) return hits;

    const allTxns = await this.db.getAllTransactions();
    const allCalls = await this.db.getAllCallRecords();
    const txnsByAccount = groupBy(allTxns, (t) => String(t.bankAccountId));
    const callsByPhone = groupBy(allCalls.filter((c) => c.phoneNumberId != null),
      (c) => String(c.phoneNumberId));

    for (const suspect of targets) {
      const acctIds = suspect.bankAccounts.map((a) => a.id);
      const phoneIds = suspect.phoneNumbers.map((p) => p.id);
      const txns = acctIds.flatMap((id) => txnsByAccount.get(String(id)) ?? []);
      const calls = phoneIds.flatMap((id) => callsByPhone.get(String(id)) ?? []);
      if (txns.length === 0 || calls.length === 0) continue;

      const txnByDate = groupBy(txns, (t) => t.timestamp.slice(0, 10));
      const callByDate = groupBy(calls, (c) => c.startTime.slice(0, 10));

      let suspectHits = 0;
      for (const date of txnByDate.keys()) {
        if (!callByDate.has(date)) continue;
        if (suspectHits >= 200) break;
        const dayTxns = txnByDate.get(date)!;
        const dayCalls = [...callByDate.get(date)!]
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        for (const txn of dayTxns) {
          if (suspectHits >= 200) break;
          for (const call of dayCalls) {
            const diff = minutesBetween(txn.timestamp, call.startTime);
            if (diff <= 120) {
              hits.push({
                suspectId: suspect.id, suspectName: suspect.fullName, date,
                transactionTime: txn.timestamp, transactionAmount: txn.amount,
                transactionType: txn.type, transactionDescription: txn.description,
                callTime: call.startTime, callerNumber: call.callerNumber,
                calledNumber: call.calledNumber, callDuration: call.durationSeconds,
                timeDifferenceMinutes: diff,
                severity: diff <= 15 ? "CRITICAL" : diff <= 30 ? "HIGH"
                  : diff <= 60 ? "MEDIUM" : "LOW",
              });
              suspectHits++;
            } else if (new Date(call.startTime).getTime()
              > new Date(txn.timestamp).getTime() + 120 * 60000) {
              break;
            }
          }
        }
      }
    }
    return hits.sort((a, b) => a.timeDifferenceMinutes - b.timeDifferenceMinutes)
      .slice(0, 500);
  }

  // === LINK GENERATION ==================================================
  async generateLinks(): Promise<SuspectLink[]> {
    const suspects = await this.db.getSuspectsWithRelations();
    const allTxns = await this.db.getAllTransactions();
    const allCalls = await this.db.getAllCallRecords();
    const accounts = await this.db.getAllBankAccounts();
    const cfg = AmlThresholds.current;
    const links: Partial<SuspectLink>[] = [];

    const acctNumberById = new Map(accounts.map((a) => [a.id, a.accountNumber]));
    const txnByAccount = new Map<string, BankTransaction[]>();
    for (const t of allTxns) {
      const num = acctNumberById.get(t.bankAccountId);
      if (!num) continue;
      const list = txnByAccount.get(num) ?? [];
      list.push(t);
      txnByAccount.set(num, list);
    }
    const callByPhone = new Map<string, CallRecord[]>();
    for (const c of allCalls) {
      for (const num of [c.callerNumber, c.calledNumber]) {
        const list = callByPhone.get(num) ?? [];
        list.push(c);
        callByPhone.set(num, list);
      }
    }

    for (let i = 0; i < suspects.length; i++) {
      for (let j = i + 1; j < suspects.length; j++) {
        const s1 = suspects[i];
        const s2 = suspects[j];
        const s1Accts = new Set(s1.bankAccounts.map((a) => a.accountNumber));
        const s2Accts = new Set(s2.bankAccounts.map((a) => a.accountNumber));

        const fin = new Map<number, BankTransaction>();
        for (const acct of s1Accts) {
          for (const t of txnByAccount.get(acct) ?? []) {
            if (s2Accts.has(t.counterpartyAccount ?? "")) fin.set(t.id, t);
          }
        }
        for (const acct of s2Accts) {
          for (const t of txnByAccount.get(acct) ?? []) {
            if (s1Accts.has(t.counterpartyAccount ?? "")) fin.set(t.id, t);
          }
        }
        const finTxns = [...fin.values()];
        if (finTxns.length > 0) {
          const sum = finTxns.reduce((a, b) => a + b.amount, 0);
          const times = finTxns.map((t) => t.timestamp).sort();
          links.push({
            sourceSuspectId: s1.id, targetSuspectId: s2.id,
            linkType: "FINANCIAL_TRANSFER", totalFinancialValue: sum,
            strength: Math.min(10, finTxns.length),
            firstContact: times[0], lastContact: times[times.length - 1],
            description: `${finTxns.length} transactions totaling ${money(cfg, sum)}`,
            confidenceLevel: finTxns.length > 5 ? "HIGH" : "MEDIUM",
          });
        }

        if (s1.address?.trim() && s2.address?.trim()
          && s1.address.trim().toLowerCase() === s2.address.trim().toLowerCase()) {
          links.push({
            sourceSuspectId: s1.id, targetSuspectId: s2.id,
            linkType: "SHARED_ADDRESS", strength: 6,
            description: `Shared address: ${s1.address}`, confidenceLevel: "HIGH",
          });
        }

        const s1Imeis = new Set(s1.phoneNumbers.map((p) => p.imei?.trim().toLowerCase())
          .filter((x): x is string => !!x));
        const sharedImei = s2.phoneNumbers.map((p) => p.imei?.trim())
          .find((i) => i && s1Imeis.has(i.toLowerCase()));
        if (sharedImei) {
          links.push({
            sourceSuspectId: s1.id, targetSuspectId: s2.id,
            linkType: "SHARED_DEVICE", strength: 8,
            description: `Shared device IMEI: ${sharedImei}`, confidenceLevel: "HIGH",
          });
        }

        const s1Phones = new Set(s1.phoneNumbers.map((p) => p.number));
        const s2Phones = new Set(s2.phoneNumbers.map((p) => p.number));
        const callSet = new Map<number, CallRecord>();
        for (const phone of s1Phones) {
          for (const c of callByPhone.get(phone) ?? []) {
            if (s2Phones.has(c.calledNumber) || s2Phones.has(c.callerNumber)) {
              callSet.set(c.id, c);
            }
          }
        }
        const phoneCalls = [...callSet.values()];
        if (phoneCalls.length > 0) {
          const times = phoneCalls.map((c) => c.startTime).sort();
          links.push({
            sourceSuspectId: s1.id, targetSuspectId: s2.id,
            linkType: "PHONE_CONTACT", totalCallCount: phoneCalls.length,
            totalCallDurationSeconds: phoneCalls.reduce((a, b) => a + b.durationSeconds, 0),
            strength: Math.min(10, Math.floor(phoneCalls.length / 5) + 1),
            firstContact: times[0], lastContact: times[times.length - 1],
            description: `${phoneCalls.length} calls`,
            confidenceLevel: phoneCalls.length > 10 ? "HIGH" : "MEDIUM",
          });
        }
      }
    }

    await this.db.deleteAutoGeneratedLinks([
      "FINANCIAL_TRANSFER", "PHONE_CONTACT", "SHARED_ADDRESS", "SHARED_DEVICE",
    ]);
    const created: SuspectLink[] = [];
    for (const link of links) created.push(await this.db.createLink(link));
    return created;
  }

  // === NETWORK FLOW =====================================================
  async analyzeNetworkFlow(): Promise<NetworkFlowData> {
    const suspects = await this.db.getSuspectsWithRelations();
    const accounts = await this.db.getAllBankAccounts();
    const allTxns = await this.db.getAllTransactions();
    return analyzeNetworkFlowCore(suspects, accounts, allTxns);
  }
}

// === helpers ============================================================
function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function cultureWeek(ts: string): number {
  return isoWeek(ts);
}

// ISO 8601 week number + week-year.
function isoWeek(ts: string): number {
  const d = new Date(ts);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function isoWeekYear(ts: string): number {
  const d = new Date(ts);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  return date.getUTCFullYear();
}

export function featuresFromViolations(r: RuleEngineResult): number[] {
  const bits = new Array(FeatureRuleIds.length).fill(0);
  const fired = new Set(r.violations.map((v) => v.ruleId));
  for (let j = 0; j < FeatureRuleIds.length; j++) {
    if (fired.has(FeatureRuleIds[j])) bits[j] = 1;
  }
  return bits;
}

export function bandFromScore(score: number): string {
  return score >= 0.75 ? "BLOCK" : score >= 0.5 ? "HOLD"
    : score >= 0.3 ? "MONITOR" : "ALLOW";
}

function benfordsLaw(txns: BankTransaction[]): [boolean, number, number] {
  const expected = [0, 30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
  const counts = new Array(10).fill(0);
  let total = 0;
  for (const t of txns) {
    const d = leadingDigit(t.amount);
    if (d >= 1 && d <= 9) {
      counts[d]++;
      total++;
    }
  }
  if (total < 10) return [true, 0, 1];
  let chi = 0;
  for (let d = 1; d <= 9; d++) {
    const exp = expected[d] / 100 * total;
    chi += (counts[d] - exp) ** 2 / exp;
  }
  const pValue = 1 - regularizedGammaP(4, chi / 2);
  return [pValue > 0.05, chi, pValue];
}

export function computeBenfordObserved(txns: BankTransaction[]): number[] {
  const observed = new Array(9).fill(0);
  let total = 0;
  for (const t of txns) {
    const d = leadingDigit(t.amount);
    if (d >= 1 && d <= 9) {
      observed[d - 1]++;
      total++;
    }
  }
  if (total > 0) for (let d = 0; d < 9; d++) observed[d] = observed[d] / total * 100;
  return observed;
}

function regularizedGammaP(a: number, x: number): number {
  if (x < 0 || a <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = 1 / a;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-10) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a;
  let c = 1e30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-10) break;
  }
  return 1 - h * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function analyzeNetworkFlowCore(
  suspects: SuspectWithRelations[],
  accounts: BankAccount[],
  allTxns: BankTransaction[]
): NetworkFlowData {
  const cfg = AmlThresholds.current;
  const acctNumberById = new Map(accounts.map((a) => [a.id, a.accountNumber]));
  const accountToSuspect = new Map<string, string>();
  for (const s of suspects) {
    for (const a of s.bankAccounts) accountToSuspect.set(a.accountNumber, s.fullName);
  }

  const transfers = [...groupBy(
    allTxns.filter((t) => t.counterpartyAccount && acctNumberById.has(t.bankAccountId)),
    (t) => `${acctNumberById.get(t.bankAccountId)}|${t.counterpartyAccount}`).entries()]
    .map(([key, g]) => ({key, total: g.reduce((a, b) => a + b.amount, 0)}))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 30);

  const labels: string[] = [];
  const sources: number[] = [];
  const targets: number[] = [];
  const values: number[] = [];
  const colors: string[] = [];

  for (const {key, total} of transfers) {
    const [p0, p1] = key.split("|");
    const from = accountToSuspect.get(p0) ?? p0;
    const to = accountToSuspect.get(p1) ?? p1;
    if (from === to) continue;
    if (!labels.includes(from)) labels.push(from);
    if (!labels.includes(to)) labels.push(to);
    sources.push(labels.indexOf(from));
    targets.push(labels.indexOf(to));
    values.push(total);
    colors.push(
      total > cfg.cashReportingThreshold ? "rgba(255,23,68,0.4)"
        : total > cfg.cashReportingThreshold / 2 ? "rgba(255,109,0,0.3)"
        : total > cfg.highValueTxnFloor ? "rgba(255,171,0,0.3)"
        : "rgba(0,229,255,0.2)");
  }

  const nodeColors = labels.map((l) =>
    suspects.some((s) => s.fullName === l && s.riskLevel === "HIGH") ? "#FF1744"
      : suspects.some((s) => s.fullName === l && s.riskLevel === "MEDIUM") ? "#FFAB00"
      : "#00E5FF");

  return {
    nodeLabels: labels, nodeColors, sourceIndices: sources,
    targetIndices: targets, values, linkColors: colors,
  };
}
