/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : noiseFilterService.ts
 * Created at  : 2026-07-03
 * Updated at  : 2026-07-03
 * Author      : jeefo
 * Purpose     : Read/write the per-case noise-filter state (the analyst's
 *               "unimportant data" decisions) that permanently declutter the
 *               connection graph.
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export interface DescRule {mode: string; text: string}

export interface NoiseFilter {
  minAmount    : number;
  ignoredPairs : string[];
  ignoredTxns  : number[];
  descRules    : DescRule[];
}

const EMPTY: NoiseFilter = {
  minAmount: 0, ignoredPairs: [], ignoredTxns: [], descRules: [],
};

function parseArray<T>(raw: unknown): T[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export class NoiseFilterService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  // The saved filter for a case, or empty defaults when the case has none yet.
  async getForCase(caseFileId: number): Promise<NoiseFilter> {
    const row = await this.db("case_noise_filters")
      .where({caseFileId}).first();
    if (!row) return {...EMPTY};
    return {
      minAmount: Number(row.minAmount) || 0,
      ignoredPairs: parseArray<string>(row.ignoredPairs),
      ignoredTxns: parseArray<number>(row.ignoredTxns),
      descRules: parseArray<DescRule>(row.descRules),
    };
  }

  // Upsert the whole filter for a case (the client always sends full state).
  async saveForCase(
    caseFileId: number, filter: NoiseFilter
  ): Promise<NoiseFilter> {
    const row = {
      caseFileId,
      minAmount: Number.isFinite(filter.minAmount) && filter.minAmount > 0
        ? filter.minAmount : 0,
      ignoredPairs: JSON.stringify(filter.ignoredPairs ?? []),
      ignoredTxns: JSON.stringify(filter.ignoredTxns ?? []),
      descRules: JSON.stringify(filter.descRules ?? []),
      updatedAt: new Date().toISOString(),
    };
    const exists = await this.db("case_noise_filters")
      .where({caseFileId}).first();
    if (exists) {
      await this.db("case_noise_filters").where({caseFileId}).update(row);
    } else {
      await this.db("case_noise_filters").insert(row);
    }
    return this.getForCase(caseFileId);
  }
}
