/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260710000000_user_devices.ts
 * Created at  : 2026-07-05
 * Author      : jeefo
 * Purpose     : Device-locked login for DETECTIVE accounts. A detective's
 *               account is bound to the physical device it first logs in from,
 *               so a stolen username+password alone cannot get in from another
 *               machine.
 * Description : The client stores a random deviceId in the browser. On a
 *               detective's FIRST login the deviceId is registered here; every
 *               later login must present the same id. If the detective changes
 *               computer, the ADMIN boss deletes the binding (resetUserDevice)
 *               so the next login re-registers the new device. Admins are not
 *               device-locked (the boss must be able to manage from anywhere).
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("user_devices", (t) => {
    t.increments("id").primary();
    t.integer("userId").notNullable()
      .references("id").inTable("users").onDelete("CASCADE");
    // Opaque random id generated and stored on the client device.
    t.string("deviceId", 128).notNullable();
    t.datetime("createdAt").notNullable();
    t.datetime("lastSeenAt").notNullable();
    t.unique(["userId", "deviceId"]);
    t.index(["userId"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("user_devices");
}
