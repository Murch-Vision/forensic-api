/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : rollback.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import db from "./knex";

async function main(): Promise<void> {
  const [batch, log] = await db.migrate.rollback();
  if (log.length === 0) {
    console.log("Already at the base migration.");
  } else {
    console.log(`Rolled back batch ${batch} (${log.length} migrations):`);
    for (const name of log) console.log(`  - ${name}`);
  }
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
