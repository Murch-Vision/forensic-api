/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260704000000_txn_counterparty_natid.ts
 * Created at  : 2026-07-02
 * Updated at  : 2026-07-02
 * Author      : jeefo
 * Purpose     : Statements may identify the counterparty only by their
 *               Регистрийн дугаар. Keep it on the transaction so link
 *               generation can connect people even when the row carries no
 *               counterparty name or account.
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("bank_transactions", (t) => {
    t.string("counterpartyNationalId", 32).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("bank_transactions", (t) => {
    t.dropColumn("counterpartyNationalId");
  });
}
