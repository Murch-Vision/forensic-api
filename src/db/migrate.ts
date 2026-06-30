/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : migrate.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import db from "./knex";

async function main(): Promise<void> {
  const [batch, log] = await db.migrate.latest();
  if (log.length === 0) {
    console.log("Already up to date.");
  } else {
    console.log(`Batch ${batch} ran ${log.length} migrations:`);
    for (const name of log) console.log(`  - ${name}`);
  }
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
