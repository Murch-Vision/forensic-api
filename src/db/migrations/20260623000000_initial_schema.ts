/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260623000000_initial_schema.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

// Ported from Data/AppDbContext.cs (OnModelCreating) + Models/*.cs. One
// initial migration mirrors the entire EF schema: tables, column lengths,
// indexes, unique business keys and FK delete behaviours.

export async function up(knex: Knex): Promise<void> {
  // === suspects ===========================================================
  await knex.schema.createTable("suspects", (t) => {
    t.increments("id").primary();
    t.string("suspectId", 50).notNullable();
    t.string("fullName", 100).notNullable();
    t.string("aliases", 200);
    t.string("nationalId", 20);
    t.string("passportNumber", 20);
    t.datetime("dateOfBirth");
    t.string("gender", 10);
    t.string("address", 300);
    t.string("city", 100);
    t.string("country", 100);
    t.string("primaryPhone", 50);
    t.string("email", 100);
    t.string("occupation", 100);
    t.string("organization", 100);
    t.string("riskLevel", 32).notNullable().defaultTo("UNKNOWN");
    t.string("notes", 1000);
    t.string("photoPath", 500);
    t.text("photoData");
    t.string("status", 32).notNullable().defaultTo("ACTIVE");
    t.datetime("createdAt").notNullable();
    t.datetime("updatedAt").notNullable();
    t.string("caseId", 50);
    t.unique(["suspectId"]);
    t.index(["fullName"]);
    t.index(["primaryPhone"]);
    t.index(["caseId"]);
  });

  // === suspect_tags =======================================================
  await knex.schema.createTable("suspect_tags", (t) => {
    t.increments("id").primary();
    t.integer("suspectId").notNullable()
      .references("id").inTable("suspects").onDelete("CASCADE");
    t.string("tag", 50).notNullable();
    t.string("color", 10).notNullable().defaultTo("#00E5FF");
    t.index(["suspectId"]);
  });

  // === case_files =========================================================
  await knex.schema.createTable("case_files", (t) => {
    t.increments("id").primary();
    t.string("caseId", 50).notNullable();
    t.string("caseName", 200).notNullable();
    t.string("description", 2000);
    t.string("status", 32).notNullable().defaultTo("OPEN");
    t.string("priority", 32).notNullable().defaultTo("MEDIUM");
    t.string("leadInvestigator", 100);
    t.string("caseType", 100);
    t.datetime("createdAt").notNullable();
    t.datetime("updatedAt").notNullable();
    t.datetime("closedAt");
    t.unique(["caseId"]);
  });

  // === phone_numbers ======================================================
  await knex.schema.createTable("phone_numbers", (t) => {
    t.increments("id").primary();
    t.string("number", 20).notNullable();
    t.string("provider", 50);
    t.string("imei", 20);
    t.string("imsi", 20);
    t.string("phoneType", 50).notNullable().defaultTo("Mobile");
    t.string("status", 50).notNullable().defaultTo("ACTIVE");
    t.integer("suspectId")
      .references("id").inTable("suspects").onDelete("SET NULL");
    t.string("subscriberName", 100);
    t.datetime("activationDate");
    t.unique(["number"]);
    t.index(["suspectId"]);
  });

  // === bank_accounts ======================================================
  await knex.schema.createTable("bank_accounts", (t) => {
    t.increments("id").primary();
    t.string("accountNumber", 50).notNullable();
    t.string("bankName", 100);
    t.string("branchCode", 50);
    t.string("iban", 50);
    t.string("accountType", 50).notNullable().defaultTo("Current");
    t.string("currency", 10).notNullable().defaultTo("USD");
    t.decimal("currentBalance", 18, 2).notNullable().defaultTo(0);
    t.string("status", 50).notNullable().defaultTo("ACTIVE");
    t.integer("suspectId")
      .references("id").inTable("suspects").onDelete("SET NULL");
    t.string("accountHolderName", 100);
    t.datetime("createdAt").notNullable();
    t.unique(["accountNumber"]);
    t.index(["suspectId"]);
  });

  // === suspect_links ======================================================
  await knex.schema.createTable("suspect_links", (t) => {
    t.increments("id").primary();
    t.integer("sourceSuspectId").notNullable()
      .references("id").inTable("suspects").onDelete("RESTRICT");
    t.integer("targetSuspectId").notNullable()
      .references("id").inTable("suspects").onDelete("RESTRICT");
    t.string("linkType", 32).notNullable().defaultTo("UNKNOWN");
    t.string("description", 500);
    t.integer("strength").notNullable().defaultTo(1);
    t.decimal("totalFinancialValue", 18, 2);
    t.integer("totalCallCount");
    t.integer("totalCallDurationSeconds");
    t.datetime("firstContact");
    t.datetime("lastContact");
    t.datetime("createdAt").notNullable();
    t.string("confidenceLevel", 32).notNullable().defaultTo("MEDIUM");
    t.index(["sourceSuspectId"]);
    t.index(["targetSuspectId"]);
    t.unique(["sourceSuspectId", "targetSuspectId", "linkType"]);
  });

  // === bank_transactions ==================================================
  await knex.schema.createTable("bank_transactions", (t) => {
    t.increments("id").primary();
    t.integer("bankAccountId").notNullable()
      .references("id").inTable("bank_accounts").onDelete("CASCADE");
    t.datetime("timestamp").notNullable();
    t.decimal("amount", 18, 2).notNullable();
    t.string("type", 10).notNullable().defaultTo("debit");
    t.string("category", 100);
    t.string("description", 500);
    t.string("referenceNumber", 100);
    t.string("counterpartyAccount", 100);
    t.string("counterpartyName", 200);
    t.string("channel", 50);
    t.string("location", 200);
    t.decimal("runningBalance", 18, 2).notNullable().defaultTo(0);
    t.string("flagStatus", 32).notNullable().defaultTo("NORMAL");
    t.index(["timestamp"]);
    t.index(["bankAccountId"]);
    t.index(["counterpartyAccount"]);
    t.index(["flagStatus"]);
  });
  // E-11 · within an account a non-null ReferenceNumber is unique; NULLs stay
  // duplicable. Partial unique index (SQLite + Postgres both honour WHERE).
  await knex.raw(
    'CREATE UNIQUE INDEX "ux_bank_transactions_account_reference" ' +
    'ON "bank_transactions" ("bankAccountId", "referenceNumber") ' +
    'WHERE "referenceNumber" IS NOT NULL'
  );

  // === call_records =======================================================
  await knex.schema.createTable("call_records", (t) => {
    t.increments("id").primary();
    t.string("callerNumber", 20).notNullable();
    t.string("calledNumber", 20).notNullable();
    t.datetime("startTime").notNullable();
    t.integer("durationSeconds").notNullable().defaultTo(0);
    t.string("callType", 20).notNullable().defaultTo("Voice");
    t.string("direction", 20).notNullable().defaultTo("Outgoing");
    t.string("cellTower", 100);
    t.string("location", 200);
    t.double("latitude");
    t.double("longitude");
    t.string("imei", 20);
    t.string("imsi", 20);
    t.string("flagStatus", 50);
    t.integer("phoneNumberId")
      .references("id").inTable("phone_numbers").onDelete("SET NULL");
    t.integer("suspectId")
      .references("id").inTable("suspects").onDelete("SET NULL");
    t.index(["callerNumber"]);
    t.index(["calledNumber"]);
    t.index(["startTime"]);
    t.index(["phoneNumberId"]);
    t.index(["suspectId"]);
  });

  // === case_notes =========================================================
  await knex.schema.createTable("case_notes", (t) => {
    t.increments("id").primary();
    t.integer("caseFileId")
      .references("id").inTable("case_files").onDelete("CASCADE");
    t.integer("suspectId")
      .references("id").inTable("suspects").onDelete("SET NULL");
    t.string("content", 5000).notNullable();
    t.string("noteType", 50).notNullable().defaultTo("GENERAL");
    t.string("author", 100);
    t.datetime("createdAt").notNullable();
    t.boolean("isPinned").notNullable().defaultTo(false);
    t.index(["suspectId"]);
  });

  // === analysis_results ===================================================
  await knex.schema.createTable("analysis_results", (t) => {
    t.increments("id").primary();
    t.integer("bankAccountId").notNullable()
      .references("id").inTable("bank_accounts").onDelete("CASCADE");
    t.datetime("analyzedAt").notNullable();
    t.boolean("benfordPasses").notNullable().defaultTo(false);
    t.double("benfordChiSquared").notNullable().defaultTo(0);
    t.double("benfordPValue").notNullable().defaultTo(0);
    t.integer("nearThresholdCount").notNullable().defaultTo(0);
    t.double("nearThresholdPercentage").notNullable().defaultTo(0);
    t.double("avgTransactionsPerDay").notNullable().defaultTo(0);
    t.integer("maxTransactionsPerDay").notNullable().defaultTo(0);
    t.double("weeklyVelocityStdDev").notNullable().defaultTo(0);
    t.integer("roundNumberCount").notNullable().defaultTo(0);
    t.double("roundNumberPercentage").notNullable().defaultTo(0);
    t.integer("offHoursCount").notNullable().defaultTo(0);
    t.double("offHoursPercentage").notNullable().defaultTo(0);
    t.double("weekendPercentage").notNullable().defaultTo(0);
    t.double("velocityScore").notNullable().defaultTo(0);
    t.double("amountVarianceScore").notNullable().defaultTo(0);
    t.double("roundNumberScore").notNullable().defaultTo(0);
    t.double("offHoursScore").notNullable().defaultTo(0);
    t.double("nearThresholdScore").notNullable().defaultTo(0);
    t.double("categoryDiversityScore").notNullable().defaultTo(0);
    t.double("overallRisk").notNullable().defaultTo(0);
    t.string("riskLevel", 32).notNullable().defaultTo("LOW");
    t.string("verdict", 500);
  });

  // === timeline_events ====================================================
  await knex.schema.createTable("timeline_events", (t) => {
    t.increments("id").primary();
    t.datetime("timestamp").notNullable();
    t.string("eventType", 50).notNullable();
    t.string("description", 500).notNullable().defaultTo("");
    t.integer("suspectId");
    t.string("relatedEntityType", 50);
    t.integer("relatedEntityId");
    t.decimal("amount", 18, 2);
    t.string("severity", 32);
    t.string("iconGlyph", 10).notNullable().defaultTo("");
    t.index(["timestamp"]);
    t.index(["suspectId"]);
    t.index(["eventType"]);
  });

  // === chart_entities =====================================================
  await knex.schema.createTable("chart_entities", (t) => {
    t.increments("id").primary();
    t.string("entityId", 50).notNullable();
    t.string("entityType", 50).notNullable().defaultTo("Person");
    t.string("label", 200).notNullable();
    t.string("description", 500);
    t.string("iconType", 50);
    t.double("x").notNullable().defaultTo(0);
    t.double("y").notNullable().defaultTo(0);
    t.string("attributes", 2000);
    t.string("sourceType", 50);
    t.integer("sourceId");
    t.string("gradeOfInformation", 20).defaultTo("C3");
    t.boolean("isPinned").notNullable().defaultTo(false);
    t.boolean("isHidden").notNullable().defaultTo(false);
    t.datetime("createdAt").notNullable();
    t.unique(["entityId"]);
    t.index(["entityType"]);
  });

  // === chart_links ========================================================
  await knex.schema.createTable("chart_links", (t) => {
    t.increments("id").primary();
    t.integer("sourceEntityId").notNullable()
      .references("id").inTable("chart_entities").onDelete("CASCADE");
    t.integer("targetEntityId").notNullable()
      .references("id").inTable("chart_entities").onDelete("CASCADE");
    t.string("linkType", 50).notNullable().defaultTo("Association");
    t.string("label", 200);
    t.string("description", 500);
    t.integer("weight").notNullable().defaultTo(1);
    t.boolean("isDirectional").notNullable().defaultTo(true);
    t.boolean("isDashed").notNullable().defaultTo(false);
    t.datetime("dateFrom");
    t.datetime("dateTo");
    t.string("confidenceLevel", 20).defaultTo("C3");
    t.decimal("financialValue", 18, 2);
    t.integer("eventCount");
    t.datetime("createdAt").notNullable();
  });

  // === chart_events =======================================================
  await knex.schema.createTable("chart_events", (t) => {
    t.increments("id").primary();
    t.datetime("timestamp").notNullable();
    t.datetime("endTime");
    t.string("eventType", 50).notNullable().defaultTo("Activity");
    t.string("title", 300).notNullable();
    t.string("description", 1000);
    t.string("severity", 20).notNullable().defaultTo("INFO");
    t.string("linkedEntityIds", 500);
    t.decimal("amount", 18, 2);
    t.string("location", 200);
    t.datetime("createdAt").notNullable();
    t.index(["timestamp"]);
    t.index(["eventType"]);
  });

  // === audit_events =======================================================
  await knex.schema.createTable("audit_events", (t) => {
    t.bigIncrements("id").primary();
    t.datetime("timestampUtc").notNullable();
    t.string("actor", 100).notNullable();
    t.string("action", 64).notNullable();
    t.string("target", 128);
    t.string("detail", 2000);
    t.string("severity", 32).notNullable().defaultTo("INFO");
    t.string("toolVersion", 32);
    t.string("chainHash", 64);
    t.index(["timestampUtc"]);
    t.index(["actor"]);
    t.index(["action"]);
  });

  // === evidence_entries ===================================================
  await knex.schema.createTable("evidence_entries", (t) => {
    t.increments("id").primary();
    t.integer("caseFileId").notNullable()
      .references("id").inTable("case_files").onDelete("CASCADE");
    t.integer("exhibitNumber").notNullable();
    t.string("sourceType", 32).notNullable().defaultTo("UNKNOWN");
    t.integer("sourceId").notNullable();
    t.string("description", 2000);
    t.string("severity", 32).notNullable().defaultTo("INFO");
    t.string("taggedBy", 100).notNullable().defaultTo("");
    t.datetime("taggedAtUtc").notNullable();
    t.index(["caseFileId"]);
    t.unique(["caseFileId", "exhibitNumber"]);
    t.index(["sourceType", "sourceId"]);
  });

  // === sanctions_refresh_logs =============================================
  await knex.schema.createTable("sanctions_refresh_logs", (t) => {
    t.bigIncrements("id").primary();
    t.datetime("fetchedAtUtc").notNullable();
    t.string("sourceUrl", 500).notNullable().defaultTo("");
    t.string("sha256Hex", 64).notNullable().defaultTo("");
    t.bigInteger("byteCount").notNullable().defaultTo(0);
    t.integer("entryCount").notNullable().defaultTo(0);
    t.boolean("success").notNullable().defaultTo(false);
    t.string("note", 500);
    t.index(["fetchedAtUtc"]);
    t.index(["success"]);
  });

  // === access_log_entries =================================================
  await knex.schema.createTable("access_log_entries", (t) => {
    t.increments("id").primary();
    t.datetime("timestamp").notNullable();
    t.string("accountOrUserId", 64).notNullable();
    t.string("fullName", 200);
    t.string("ipAddress", 64);
    t.string("deviceUuid", 128);
    t.string("fingerprint", 128);
    t.string("userAgent", 512);
    t.string("deviceModel", 128);
    t.string("deviceMake", 64);
    t.string("os", 32);
    t.string("osVersion", 32);
    t.string("source", 32).notNullable().defaultTo("WebAccessLog");
    t.integer("suspectId")
      .references("id").inTable("suspects").onDelete("SET NULL");
    t.unique(["timestamp", "accountOrUserId", "ipAddress"],
      {indexName: "IX_AccessLogEntries_BusinessKey"});
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("access_log_entries");
  await knex.schema.dropTableIfExists("sanctions_refresh_logs");
  await knex.schema.dropTableIfExists("evidence_entries");
  await knex.schema.dropTableIfExists("audit_events");
  await knex.schema.dropTableIfExists("chart_events");
  await knex.schema.dropTableIfExists("chart_links");
  await knex.schema.dropTableIfExists("chart_entities");
  await knex.schema.dropTableIfExists("timeline_events");
  await knex.schema.dropTableIfExists("analysis_results");
  await knex.schema.dropTableIfExists("case_notes");
  await knex.schema.dropTableIfExists("call_records");
  await knex.schema.dropTableIfExists("bank_transactions");
  await knex.schema.dropTableIfExists("suspect_links");
  await knex.schema.dropTableIfExists("bank_accounts");
  await knex.schema.dropTableIfExists("phone_numbers");
  await knex.schema.dropTableIfExists("case_files");
  await knex.schema.dropTableIfExists("suspect_tags");
  await knex.schema.dropTableIfExists("suspects");
}
