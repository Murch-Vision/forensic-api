/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : knex.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import fs from "fs";
import path from "path";
import knexFactory from "knex";
import type {Knex} from "knex";
import config from "../../knexfile";

const env = process.env.NODE_ENV === "production"
  ? "production"
  : "development";

const active = config[env];

// Ensure the SQLite data directory exists before knex opens the file.
if (active.client === "better-sqlite3") {
  const conn = active.connection as {filename: string};
  const dir = path.dirname(conn.filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

export const db: Knex = knexFactory(active);

export default db;
