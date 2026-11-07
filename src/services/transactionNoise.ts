import type {BankTransaction} from "../models/types";
import type {NoiseFilter} from "./noiseFilterService";

export function ignoredTransactionIds(txns: BankTransaction[], nf: NoiseFilter): Set<number> {
  const ignored = new Set(nf.ignoredTxns), pairs = new Set(nf.ignoredPairs);
  for (const t of txns) {
    if (ignored.has(t.id)) continue;
    if (nf.minAmount > 0 && t.amount < nf.minAmount) {ignored.add(t.id); continue;}
    const desc = (t.description ?? "").toLowerCase();
    if (nf.descRules.some(r => {
      const value = r.text.toLowerCase();
      return r.mode === "starts" ? desc.startsWith(value)
        : r.mode === "ends" ? desc.endsWith(value) : desc.includes(value);
    })) {ignored.add(t.id); continue;}
    const cp = t.counterpartyAccount?.trim();
    if (cp && pairs.has(`${t.bankAccountId}→${cp}`)) ignored.add(t.id);
  }
  return ignored;
}
