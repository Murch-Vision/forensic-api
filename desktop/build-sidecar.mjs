/* Build the API into a self-contained "sidecar" payload for the Tauri desktop
 * app. Output (desktop/dist/):
 *   server.cjs                  – whole API bundled to one CommonJS file
 *   node_modules/better-sqlite3 – the native addon (+ its runtime deps), kept
 *                                 unbundled so its .node loads from a real path
 *   assets/                     – small read-only assets (CSVs + sanctions sample)
 *   template.sqlite             – schema-only DB, copied to the user's data dir
 *                                 on first launch (avoids runtime knex .ts migrations)
 *
 * The matching `node` runtime is supplied by CI/the Tauri layer, which spawns:
 *   node server.cjs   with env DATA_DIR / ASSETS_DIR / DB_FILE / PORT set.
 *
 * Run on the TARGET OS (the native addon is platform-specific):  node desktop/build-sidecar.mjs
 */
import {build} from "esbuild";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "desktop", "dist");

function rmrf(p) {
  fs.rmSync(p, {recursive: true, force: true});
}

async function main() {
  rmrf(OUT);
  fs.mkdirSync(OUT, {recursive: true});

  // 1. Bundle the server to a single CJS file. better-sqlite3 is a native addon
  //    and the other knex DB drivers are optional — keep them external so they
  //    resolve at runtime (or are harmlessly absent).
  console.log("• bundling server.cjs …");
  await build({
    entryPoints: [path.join(ROOT, "src", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(OUT, "server.cjs"),
    // knexfile.ts imports knex types and uses __dirname; keep __dirname pointing
    // at the output dir so the dev-fallback paths are sane (we override with env).
    external: [
      "better-sqlite3",
      // optional knex dialects we don't ship:
      "pg", "pg-query-stream", "pg-native", "mysql", "mysql2", "oracledb",
      "sqlite3", "tedious", "mariadb",
    ],
    logOverride: {"require-resolve-not-external": "silent"},
    banner: {
      // a few deps probe for these; harmless shims keep the bundle quiet.
      js: "globalThis.__sidecar = true;",
    },
  });

  // 2. Stage the native addon plus its FULL runtime dependency tree
  //    (better-sqlite3 → bindings → file-uri-to-path), flattened, so that
  //    `require('better-sqlite3')` resolves next to server.cjs at runtime.
  console.log("• staging better-sqlite3 native addon …");
  const destNM = path.join(OUT, "node_modules");
  fs.mkdirSync(destNM, {recursive: true});

  const collected = new Map(); // name -> package dir
  const collect = (name, fromPaths) => {
    let pkgJson;
    try {
      pkgJson = require.resolve(`${name}/package.json`, {paths: fromPaths});
    } catch {
      return; // optional/missing dep — skip
    }
    const dir = path.dirname(pkgJson);
    if (collected.has(name)) return;
    collected.set(name, dir);
    const pj = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    for (const dep of Object.keys(pj.dependencies || {})) {
      collect(dep, [dir, ...fromPaths]);
    }
  };
  collect("better-sqlite3", [ROOT]);

  for (const [name, dir] of collected) {
    fs.cpSync(dir, path.join(destNM, name), {recursive: true, dereference: true});
  }
  // prune build intermediates we don't need to ship
  rmrf(path.join(destNM, "better-sqlite3", "build", "Release", "obj"));
  rmrf(path.join(destNM, "better-sqlite3", "deps"));
  rmrf(path.join(destNM, "better-sqlite3", "src"));
  console.log("  ↳ staged:", [...collected.keys()].join(", "));

  // 3. Copy small read-only assets (NOT the 345 MB sanctions dataset — that is
  //    fetched on demand by the in-app "refresh" into the user's data dir).
  console.log("• copying assets …");
  const assetsSrc = path.join(ROOT, "assets");
  const assetsDst = path.join(OUT, "assets");
  fs.mkdirSync(assetsDst, {recursive: true});
  for (const f of fs.readdirSync(assetsSrc)) {
    const full = path.join(assetsSrc, f);
    if (fs.statSync(full).size > 25 * 1024 * 1024) {
      console.log(`  ↳ skipping large asset ${f} (${Math.round(fs.statSync(full).size / 1e6)} MB)`);
      continue;
    }
    fs.copyFileSync(full, path.join(assetsDst, f));
  }

  // 4. Produce a schema-only template DB by running the real migrations against
  //    a fresh file (uses tsx, available at build time; runtime never migrates).
  console.log("• generating template.sqlite …");
  const template = path.join(OUT, "template.sqlite");
  rmrf(template);
  execFileSync(
    path.join(ROOT, "node_modules", ".bin", "tsx"),
    [path.join(ROOT, "src", "db", "migrate.ts")],
    {cwd: ROOT, stdio: "inherit", env: {...process.env, DB_FILE: template, NODE_ENV: "production"}},
  );

  console.log(`\n✓ sidecar payload ready at ${path.relative(ROOT, OUT)}/`);
  for (const f of fs.readdirSync(OUT)) console.log("   -", f);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
