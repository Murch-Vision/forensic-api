/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : amlThresholds.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {BankTransaction} from "../models/types";

// Ported from Services/AmlThresholds.cs — currency-aware AML / fraud
// thresholds. Defaults match Mongolian banking regulation (₮ 20M cash
// reporting threshold). Swap `current` at startup for another jurisdiction.

export interface AmlConfig {
  cashReportingThreshold : number;
  nearThresholdRangeLow  : number;
  nearThresholdRangeHigh : number;
  roundNumberMinAmount   : number;
  roundNumberModulus     : number;
  nightHoursStart        : number;
  nightHoursEnd          : number;
  highValueTxnFloor      : number;
  muleDailyInflowMin     : number;
  muleOutflowRatio       : number;
  smurfingUnitMax        : number;
  smurfingDailyTotalMin  : number;
  currencySymbol         : string;
  currencyFormat         : "N0" | "N2";
}

export const MongoliaDefault: AmlConfig = {
  cashReportingThreshold : 20_000_000,
  nearThresholdRangeLow  : 17_000_000,
  nearThresholdRangeHigh : 20_000_000,
  roundNumberMinAmount   : 50_000,
  roundNumberModulus     : 10_000,
  nightHoursStart        : 0,
  nightHoursEnd          : 6,
  highValueTxnFloor      : 1_000_000,
  muleDailyInflowMin     : 10_000_000,
  muleOutflowRatio       : 0.9,
  smurfingUnitMax        : 3_000_000,
  smurfingDailyTotalMin  : 9_000_000,
  currencySymbol         : "₮",
  currencyFormat         : "N0",
};

export const UnitedStatesDefault: AmlConfig = {
  cashReportingThreshold : 10_000,
  nearThresholdRangeLow  : 8_500,
  nearThresholdRangeHigh : 10_000,
  roundNumberMinAmount   : 500,
  roundNumberModulus     : 100,
  nightHoursStart        : 0,
  nightHoursEnd          : 6,
  highValueTxnFloor      : 1_000,
  muleDailyInflowMin     : 10_000,
  muleOutflowRatio       : 0.9,
  smurfingUnitMax        : 3_000,
  smurfingDailyTotalMin  : 9_000,
  currencySymbol         : "$",
  currencyFormat         : "N2",
};

// Currently active threshold set. Mutable so a settings panel can hot-swap.
let _current: AmlConfig = MongoliaDefault;

export const AmlThresholds = {
  get current(): AmlConfig {
    return _current;
  },
  set current(value: AmlConfig) {
    _current = value;
  },
};

export function money(cfg: AmlConfig, amount: number): string {
  const digits = cfg.currencyFormat === "N2" ? 2 : 0;
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${cfg.currencySymbol} ${formatted}`;
}

// === transaction predicates (ported from AmlConfig + BankTransaction) ======

export function hourOf(ts: string): number {
  return new Date(ts).getUTCHours();
}

export function dayOfWeekOf(ts: string): number {
  return new Date(ts).getUTCDay(); // 0 = Sunday
}

export function isWeekend(t: BankTransaction): boolean {
  const d = dayOfWeekOf(t.timestamp);
  return d === 0 || d === 6;
}

export function signedAmount(t: BankTransaction): number {
  return t.type.toLowerCase() === "credit" ? t.amount : -t.amount;
}

export function leadingDigit(amount: number): number {
  let abs = Math.abs(amount);
  if (abs < 1) return 0;
  while (abs >= 10) abs /= 10;
  return Math.floor(abs);
}

export function isNearThreshold(cfg: AmlConfig, t: BankTransaction): boolean {
  return t.amount >= cfg.nearThresholdRangeLow
    && t.amount < cfg.nearThresholdRangeHigh;
}

export function isRoundNumber(cfg: AmlConfig, t: BankTransaction): boolean {
  return t.amount >= cfg.roundNumberMinAmount
    && t.amount % cfg.roundNumberModulus === 0;
}

export function isOffHours(cfg: AmlConfig, t: BankTransaction): boolean {
  const h = hourOf(t.timestamp);
  return h >= cfg.nightHoursStart && h < cfg.nightHoursEnd;
}
