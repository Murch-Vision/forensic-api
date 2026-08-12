/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260813010000_case_conclusions.ts
 * Created at  : 2026-08-13
 * Author      : jeefo
 * Purpose     : Дүгнэлт — the examiner's written conclusion, per account and one
 *               for the link analysis.
 * Description : The report template ends with a Дүгнэлт section. The program
 *               must not write it: a conclusion is the examiner's professional
 *               responsibility, and a generated one would be an opinion nobody
 *               signed. So it is stored as text they type, and the report only
 *               places it.
 *
 *               bankAccountId NULL = the link-analysis conclusion, which belongs
 *               to the case rather than to any single account.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("case_conclusions");
  if (exists) return;
  await knex.schema.createTable("case_conclusions", (t) => {
    t.increments("id").primary();
    t.integer("caseFileId").notNullable()
      .references("id").inTable("case_files").onDelete("CASCADE");
    // NULL = the case-level (link analysis) conclusion.
    t.integer("bankAccountId")
      .references("id").inTable("bank_accounts").onDelete("CASCADE");
    t.text("text").notNullable().defaultTo("");
    t.integer("updatedByUserId")
      .references("id").inTable("users").onDelete("SET NULL");
    t.datetime("createdAt").notNullable();
    t.datetime("updatedAt").notNullable();
    t.index(["caseFileId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("case_conclusions");
}
