/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260709000000_auth_users.ts
 * Created at  : 2026-07-05
 * Author      : jeefo
 * Purpose     : Authentication + role-based access. Introduces user accounts
 *               (one ADMIN "boss" per department + up to ~10 DETECTIVEs),
 *               login sessions, per-case access control and case ownership.
 * Description : - users        : login accounts with a role + active flag.
 *               - sessions     : opaque bearer tokens handed out at login.
 *               - case_members : which DETECTIVEs may open which cases (the
 *                                boss/ADMIN sees every case regardless).
 *               case_files gains ownerUserId (who created it); users gains
 *               activeCaseId so the "currently open case" is per-user, not a
 *               single process-wide value (which broke with many analysts).
 *               Seeds one admin account: admin / admin123 (change on first use).
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import crypto from "crypto";
import type {Knex} from "knex";

// scrypt password hash, stored "salt:hash" (both hex). Kept identical to
// AuthService.hashPassword so the seeded admin verifies at login.
function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (t) => {
    t.increments("id").primary();
    t.string("username", 100).notNullable();
    t.string("fullName", 200);
    t.string("passwordHash", 300).notNullable();
    // ADMIN = department boss (sees & merges all cases, manages accounts);
    // DETECTIVE = scoped to the cases they own or are granted access to.
    t.string("role", 32).notNullable().defaultTo("DETECTIVE");
    t.boolean("active").notNullable().defaultTo(true);
    // The case this user currently has open (per-user working scope).
    t.integer("activeCaseId").references("id").inTable("case_files")
      .onDelete("SET NULL");
    t.datetime("createdAt").notNullable();
    t.datetime("updatedAt").notNullable();
    t.unique(["username"]);
  });

  await knex.schema.createTable("sessions", (t) => {
    t.increments("id").primary();
    t.string("token", 128).notNullable();
    t.integer("userId").notNullable()
      .references("id").inTable("users").onDelete("CASCADE");
    t.datetime("createdAt").notNullable();
    t.datetime("expiresAt").notNullable();
    t.unique(["token"]);
    t.index(["userId"]);
  });

  await knex.schema.createTable("case_members", (t) => {
    t.increments("id").primary();
    t.integer("caseFileId").notNullable()
      .references("id").inTable("case_files").onDelete("CASCADE");
    t.integer("userId").notNullable()
      .references("id").inTable("users").onDelete("CASCADE");
    t.datetime("createdAt").notNullable();
    t.unique(["caseFileId", "userId"]);
    t.index(["userId"]);
  });

  // Who created / owns each case. Nullable: pre-existing cases have no owner
  // until an admin (who sees everything anyway) assigns one.
  await knex.schema.alterTable("case_files", (t) => {
    t.integer("ownerUserId").references("id").inTable("users")
      .onDelete("SET NULL");
  });

  // Seed the first admin so someone can log in and create the rest.
  const now = new Date().toISOString();
  await knex("users").insert({
    username: "admin",
    fullName: "Хэлтсийн дарга",
    passwordHash: hashPassword("admin123"),
    role: "ADMIN",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("case_files", (t) => {
    t.dropColumn("ownerUserId");
  });
  await knex.schema.dropTableIfExists("case_members");
  await knex.schema.dropTableIfExists("sessions");
  await knex.schema.dropTableIfExists("users");
}
