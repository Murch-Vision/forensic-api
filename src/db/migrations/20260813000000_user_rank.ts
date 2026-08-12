/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260813000000_user_rank.ts
 * Created at  : 2026-08-13
 * Author      : jeefo
 * Purpose     : Split an account's display name into Цол (rank) + Нэр (name).
 * Description : The single `fullName` field was being filled by hand with both
 *               parts ("д/х Э.Төмөрхуяг"), so rank was never sortable or
 *               listable on its own. Existing rows keep fullName as the name;
 *               rank starts empty and is filled in from the admin page.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("users", "rank");
  if (!has) {
    await knex.schema.alterTable("users", (t) => {
      t.string("rank", 64);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("users", "rank");
  if (has) {
    await knex.schema.alterTable("users", (t) => {
      t.dropColumn("rank");
    });
  }
}
