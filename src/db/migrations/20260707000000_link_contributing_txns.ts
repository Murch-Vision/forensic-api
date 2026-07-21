/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260707000000_link_contributing_txns.ts
 * Created at  : 2026-07-04
 * Updated at  : 2026-07-04
 * Author      : jeefo
 * Purpose     : Remember WHICH transactions back a generated FINANCIAL_TRANSFER
 *               link, so the connection list can honour the per-case noise
 *               filter (amount floor, removed txns, description rules, removed
 *               pairs) exactly like the graph does — instead of showing a raw
 *               all-transactions total that contradicts the filtered view.
 * Description : `contributingTxnIds` is a JSON array of bank_transactions ids.
 *               Null for non-financial links.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("suspect_links", (t) => {
    t.text("contributingTxnIds").nullable();   // JSON array of txn ids
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("suspect_links", (t) => {
    t.dropColumn("contributingTxnIds");
  });
}
