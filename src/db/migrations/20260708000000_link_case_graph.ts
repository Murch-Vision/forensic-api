/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260708000000_link_case_graph.ts
 * Created at  : 2026-07-04
 * Updated at  : 2026-07-04
 * Author      : jeefo
 * Purpose     : Scope analyst-drawn MANUAL connections to a saved board.
 *               Previously every manual link lived globally in suspect_links,
 *               so a connection drawn on one board leaked into every other view
 *               (and into the "no board" view on refresh). `caseGraphId` ties a
 *               manual link to the board it was drawn on; NULL = the unsaved /
 *               default view. Auto-generated links (FINANCIAL_TRANSFER, …) keep
 *               caseGraphId NULL — they are evidence, shown in every view.
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("suspect_links", "caseGraphId");
  if (has) return;
  await knex.schema.alterTable("suspect_links", (t) => {
    t.integer("caseGraphId").nullable();
    t.index(["caseGraphId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("suspect_links", (t) => {
    t.dropColumn("caseGraphId");
  });
}
