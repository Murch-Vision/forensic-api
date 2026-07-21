/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260705000000_case_noise_filters.ts
 * Created at  : 2026-07-03
 * Updated at  : 2026-07-03
 * Author      : jeefo
 * Purpose     : Persist the analyst's "unimportant data" decisions PERMANENTLY,
 *               per case, in the database — not in the browser. The noise floor
 *               and the marked-unimportant pairs / transactions / description
 *               rules are what strip clutter out of the connection graph, so
 *               they must survive reloads, machines and sessions.
 * Description : One row per case. The three mark sets are stored as JSON text.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("case_noise_filters", (t) => {
    t.integer("caseFileId").primary()
      .references("id").inTable("case_files").onDelete("CASCADE");
    // Noise floor — transactions below this amount are unimportant. 0 = off.
    t.decimal("minAmount", 18, 2).notNullable().defaultTo(0);
    // JSON arrays of the analyst's explicit "not important" marks.
    t.text("ignoredPairs").notNullable().defaultTo("[]");   // ["<accId>→<num>"]
    t.text("ignoredTxns").notNullable().defaultTo("[]");    // [txnId, ...]
    t.text("descRules").notNullable().defaultTo("[]");      // [{mode,text}, ...]
    t.datetime("updatedAt").notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("case_noise_filters");
}
