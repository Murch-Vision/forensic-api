/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260706000000_case_graphs.ts
 * Created at  : 2026-07-03
 * Updated at  : 2026-07-03
 * Author      : jeefo
 * Purpose     : Saved connection-graph "boards". A detective arranges the link
 *               chart for one investigative angle (e.g. the money network, the
 *               phone network, the family/associate network), names it and
 *               saves the WHOLE graph. Many boards live per case so the analyst
 *               can flip between different views and keep editing them.
 * Description : `state` is a JSON snapshot of the view — visible edge kinds,
 *               noise floor, hidden nodes and the node layout positions.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("case_graphs", (t) => {
    t.increments("id").primary();
    t.integer("caseFileId").notNullable()
      .references("id").inTable("case_files").onDelete("CASCADE");
    t.string("name", 200).notNullable();
    t.text("state").notNullable().defaultTo("{}");   // JSON snapshot
    t.datetime("createdAt").notNullable();
    t.datetime("updatedAt").notNullable();
    t.index(["caseFileId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("case_graphs");
}
