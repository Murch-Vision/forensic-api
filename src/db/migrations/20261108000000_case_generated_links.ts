import type {Knex} from "knex";

// Legacy auto links have no trustworthy case provenance. Keep their rows,
// but scoped reads hide them until the analyst regenerates for that case.
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable("suspect_links", t => {
    t.integer("caseFileId").nullable()
      .references("id").inTable("case_files").onDelete("CASCADE");
    t.index(["caseFileId"]);
    t.dropUnique(["sourceSuspectId", "targetSuspectId", "linkType"]);
    t.unique(["sourceSuspectId", "targetSuspectId", "linkType", "caseFileId"]);
  });
  await db.raw('CREATE UNIQUE INDEX suspect_links_unscoped_unique ON suspect_links ("sourceSuspectId", "targetSuspectId", "linkType") WHERE "caseFileId" IS NULL');
}

export async function down(db: Knex): Promise<void> {
  const duplicates = await db("suspect_links")
    .select("sourceSuspectId", "targetSuspectId", "linkType")
    .groupBy("sourceSuspectId", "targetSuspectId", "linkType")
    .havingRaw("count(*) > 1").first();
  if (duplicates) throw new Error("Case links must be preserved; cannot restore global link uniqueness.");
  await db.raw("DROP INDEX suspect_links_unscoped_unique");
  await db.schema.alterTable("suspect_links", t => {
    t.dropUnique(["sourceSuspectId", "targetSuspectId", "linkType", "caseFileId"]);
    t.dropColumn("caseFileId");
    t.unique(["sourceSuspectId", "targetSuspectId", "linkType"]);
  });
}
