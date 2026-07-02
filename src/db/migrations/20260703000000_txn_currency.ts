/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260703000000_txn_currency.ts
 * Created at  : 2026-07-03
 * Updated at  : 2026-07-03
 * Author      : jeefo
 * Purpose     : Transactions carry their own currency (statements may be in
 *               USD etc.); rows without a currency column default to MNT.
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("bank_transactions", (t) => {
    t.string("currency", 10).notNullable().defaultTo("MNT");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("bank_transactions", (t) => {
    t.dropColumn("currency");
  });
}
