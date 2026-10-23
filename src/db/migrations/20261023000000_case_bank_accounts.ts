import type {Knex} from "knex";

// A person may have accounts in many cases. Account ownership is never case
// membership. Keep statement/counterparty roles and removals per account/case.
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable("case_bank_accounts", (t) => {
    t.integer("caseFileId").notNullable()
      .references("id").inTable("case_files").onDelete("CASCADE");
    t.integer("bankAccountId").notNullable()
      .references("id").inTable("bank_accounts").onDelete("CASCADE");
    t.boolean("isStatement").notNullable().defaultTo(false);
    t.boolean("removed").notNullable().defaultTo(false);
    t.primary(["caseFileId", "bankAccountId"]);
  });
  // Preserve explicit legacy account evidence. Never expand through a person.
  // Old imports did not distinguish roles; preserve their existing statements
  // where rows exist. New imports record the precise role explicitly.
  const rows = await db("evidence_entries as e")
    .join("case_files as c", "c.id", "e.caseFileId")
    .join("bank_accounts as a", "a.id", "e.sourceId")
    .where("e.sourceType", "BANK_ACCOUNT")
    .select("e.caseFileId", "e.sourceId as bankAccountId")
    .distinct();
  const statementIds = new Set((await db("bank_transactions")
    .distinct("bankAccountId").pluck("bankAccountId")).map(Number));
  for (let i = 0; i < rows.length; i += 200) {
    await db("case_bank_accounts").insert(rows.slice(i, i + 200).map(r => ({
      ...r, isStatement: statementIds.has(Number(r.bankAccountId)), removed: false,
    })));
  }
}
export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists("case_bank_accounts");
}
