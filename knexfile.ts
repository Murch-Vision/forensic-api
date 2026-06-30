/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : knexfile.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import path from "path";
import type {Knex} from "knex";

// The C# app targets SQLite by default (Microsoft.EntityFrameworkCore.Sqlite)
// and Postgres via Npgsql for sealed-evidence deployments. We mirror that:
// SQLite for local/dev, Postgres swapped in via DB_CLIENT=pg.
const client = process.env.DB_CLIENT === "pg" ? "pg" : "better-sqlite3";

const sqliteFile = process.env.DB_FILE
  || path.join(
      process.env.DATA_DIR || path.join(__dirname, "data"),
      "forensic.sqlite",
    );

const config: Record<string, Knex.Config> = {
  development: {
    client,
    connection: client === "pg"
      ? (process.env.DATABASE_URL || {
          host     : process.env.PGHOST || "localhost",
          port     : Number(process.env.PGPORT || 5432),
          user     : process.env.PGUSER || "postgres",
          password : process.env.PGPASSWORD || "postgres",
          database : process.env.PGDATABASE || "forensic",
        })
      : {filename: sqliteFile},
    useNullAsDefault: client !== "pg",
    pool: client === "pg" ? undefined : {
      // SQLite foreign-key enforcement is off by default; mirror EF Core's
      // referential integrity (OnDelete SetNull / Cascade / Restrict).
      afterCreate: (conn: any, done: any) => {
        conn.pragma("foreign_keys = ON");
        done(null, conn);
      },
    },
    migrations: {
      directory     : path.join(__dirname, "src", "db", "migrations"),
      loadExtensions: [".ts"],
      extension     : "ts",
    },
    seeds: {
      directory: path.join(__dirname, "src", "db", "seeds"),
    },
  },
};

config.production = config.development;

export default config;
