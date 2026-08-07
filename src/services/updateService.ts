/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : updateService.ts
 * Created at  : 2026-07-21
 * Author      : maestro
 * Purpose     : Self-update — pull the latest code from git and, when new
 *               commits arrived, restart the server so the new version runs.
 * Description : version() reports the running package version + git commit for
 *               the Settings page. selfUpdate() runs `git pull --ff-only`; if
 *               HEAD moved it (optionally) exits with code 42 so the managed
 *               launcher loop reinstalls deps, re-migrates and relaunches.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

const pexec = promisify(execFile);

// execFile rejects with "Command failed: git pull --ff-only" and buries the
// reason in .stderr. Surfacing only the first line of .message told the analyst
// nothing about what to fix, so prefer git's own words.
function gitError(e: unknown): string {
  const err = e as {stderr?: string; stdout?: string; message?: string};
  const raw = [err?.stderr, err?.stdout, err?.message]
    .find((s) => typeof s === "string" && s.trim().length > 0) ?? String(e);
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

// Exit code the managed launcher (scripts/start-windows.bat) watches for: it
// means "an update was pulled — reinstall, migrate and start me again".
export const RESTART_EXIT_CODE = 42;

// One checkout the workstation runs. The Settings page showed a single
// version, which is misleading: backend and frontend are separate repos that
// update independently and can sit on different commits.
export interface RepoVersion {
  name: string;
  path: string;
  version: string;
  commit: string;
  branch: string;
  dirty: boolean;
  // Commit the SERVED build was made from (dist/.commit) — null for the
  // backend (runs from source, restart covers it), "" for a built app whose
  // marker is missing (built by hand or never built). The Settings page
  // compares it against `commit` to say whether the screen is current.
  builtCommit: string | null;
}

export interface RepoUpdate {
  name: string;
  updated: boolean;
  previousCommit: string;
  newCommit: string;
  message: string;
}

export interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
  repos: RepoVersion[];
}

export interface UpdateResult {
  updated: boolean;
  previousCommit: string;
  newCommit: string;
  previousVersion: string;
  newVersion: string;
  message: string;
  restarting: boolean;
  repos: RepoUpdate[];
}

export class UpdateService {
  private readonly repoRoot: string;

  // The launcher cd's to the project root before `pnpm start`, so cwd is the
  // repo root; allow an override for tests.
  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
  }

  private async git(...args: string[]): Promise<string> {
    return this.gitIn(this.repoRoot, ...args);
  }

  private async gitIn(cwd: string, ...args: string[]): Promise<string> {
    const {stdout} = await pexec("git", args, {cwd});
    return stdout.trim();
  }

  // `git pull --ff-only` with no arguments needs an upstream branch, and a
  // deployment checkout very often has none — the clone was made, or the
  // branch created, without tracking. Git then fails with "no tracking
  // information", which reads as a broken updater. Name the remote and branch
  // explicitly so it works either way.
  private async pullIn(cwd: string): Promise<void> {
    const args = ["pull", "--ff-only"];
    try {
      await this.gitIn(cwd, "rev-parse", "--abbrev-ref",
        "--symbolic-full-name", "@{u}");
    } catch {
      // No upstream — fall back to origin and whatever branch is checked out.
      const branch = await this.gitIn(cwd, "rev-parse", "--abbrev-ref", "HEAD");
      if (!branch || branch === "HEAD") {
        throw new Error("detached HEAD — check out a branch first");
      }
      args.push("origin", branch);
    }
    await this.gitIn(cwd, ...args);
  }

  // Extra checkouts to pull alongside the main repo (e.g. the frontend), so a
  // single "Update" click refreshes the whole workstation. FAW_UPDATE_REPOS
  // (path-delimiter-separated) overrides; unset, the standard side-by-side
  // layout is auto-detected — otherwise an api launched by hand (pnpm dev)
  // neither lists nor updates the frontend, only the Windows launcher did.
  private extraRepos(): string[] {
    const env = (process.env.FAW_UPDATE_REPOS ?? "")
      .split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean);
    if (env.length) return env;
    const sibling = path.resolve(this.repoRoot, "..", "forensic-frontend");
    return existsSync(path.join(sibling, ".git")) ? [sibling] : [];
  }

  // Reinstall + rebuild a pulled checkout. pnpm, not npm — the repos are
  // pnpm projects (pnpm-lock.yaml) and an npm install inside one produces a
  // broken node_modules. On Windows pnpm is pnpm.cmd, which Node refuses to
  // spawn without a shell (CVE-2024-27980) — hence the flag. A vite build
  // easily exceeds execFile's 1MB output default, so raise it.
  private async pnpmIn(cwd: string, ...args: string[]): Promise<void> {
    const win = process.platform === "win32";
    await pexec(win ? "pnpm.cmd" : "pnpm", args, {
      cwd,
      shell: win,
      timeout: 10 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  // The commit a checkout's dist was built from — written by us after a
  // successful build (vite wipes dist, so the marker vanishes with the old
  // build). Missing or different ⇒ the SERVED app is stale even when the pull
  // says "already up to date" (e.g. an older updater pulled without building).
  private builtCommit(root: string): string {
    try {
      return readFileSync(path.join(root, "dist", ".commit"), "utf8").trim();
    } catch {
      return "";
    }
  }

  private hasBuildScript(root: string): boolean {
    try {
      const raw = readFileSync(path.join(root, "package.json"), "utf8");
      const scripts = JSON.parse(raw).scripts as
        Record<string, string> | undefined;
      return Boolean(scripts?.build);
    } catch {
      return false;
    }
  }

  private packageVersion(root: string = this.repoRoot): string {
    try {
      const raw = readFileSync(path.join(root, "package.json"), "utf8");
      return (JSON.parse(raw).version as string) ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  // Human name for a checkout: the package.json name, else the folder name.
  private repoName(root: string, fallback: string): string {
    try {
      const raw = readFileSync(path.join(root, "package.json"), "utf8");
      const n = JSON.parse(raw).name as string | undefined;
      if (n) return n;
    } catch {
      /* fall through */
    }
    return path.basename(root) || fallback;
  }

  // Every checkout this workstation runs: the backend itself plus whatever
  // FAW_UPDATE_REPOS points at (normally the frontend).
  private repoRoots(): string[] {
    return [this.repoRoot, ...this.extraRepos()];
  }

  private async repoInfo(root: string): Promise<RepoVersion> {
    const extra = root !== this.repoRoot;
    const info: RepoVersion = {
      name: this.repoName(root, "repo"),
      path: root,
      version: this.packageVersion(root),
      commit: "unknown",
      branch: "unknown",
      dirty: false,
      builtCommit: extra ? "" : null,
    };
    try {
      info.commit = await this.gitIn(root, "rev-parse", "--short", "HEAD");
    } catch {
      return info; // not a git checkout
    }
    if (extra) {
      // The marker holds the full hash; trim to the same length as `commit`
      // so the two are directly comparable.
      const bc = this.builtCommit(root);
      info.builtCommit = bc ? bc.slice(0, info.commit.length) : "";
    }
    try {
      info.branch = await this.gitIn(root, "rev-parse", "--abbrev-ref", "HEAD");
    } catch {
      /* ignore */
    }
    try {
      info.dirty =
        (await this.gitIn(root, "status", "--porcelain")).length > 0;
    } catch {
      /* ignore */
    }
    return info;
  }

  // Running version + short commit + branch, for the Settings header, plus one
  // entry per checkout so backend and frontend are reported separately.
  async version(): Promise<VersionInfo> {
    const repos = await Promise.all(
      this.repoRoots().map((r) => this.repoInfo(r)));
    const self = repos[0];
    return {
      version: self?.version ?? this.packageVersion(),
      commit: self?.commit ?? "unknown",
      branch: self?.branch ?? "unknown",
      repos,
    };
  }

  // Pull the latest code; restart only when something actually changed AND we
  // run under the managed launcher (FAW_MANAGED=1), so a dev session is never
  // killed out from under the analyst.
  async selfUpdate(): Promise<UpdateResult> {
    const previousVersion = this.packageVersion();
    let previousCommit = "unknown";
    try {
      previousCommit = await this.git("rev-parse", "HEAD");
    } catch {
      /* ignore */
    }

    // Every checkout is pulled and reported on its own. A failure in one must
    // not hide the outcome of the others, which a single blended result did.
    const repos: RepoUpdate[] = [];
    let buildFailed = false;
    for (const root of this.repoRoots()) {
      const name = this.repoName(root, "repo");
      let before = "unknown";
      try {
        before = await this.gitIn(root, "rev-parse", "HEAD");
      } catch {
        repos.push({name, updated: false, previousCommit: "unknown",
          newCommit: "unknown", message: "Git-ийн сан биш."});
        continue;
      }
      try {
        await this.pullIn(root);
      } catch (e) {
        repos.push({name, updated: false, previousCommit: short(before),
          newCommit: short(before), message: `Татаж чадсангүй: ${gitError(e)}`});
        continue;
      }
      let after = before;
      try {
        after = await this.gitIn(root, "rev-parse", "HEAD");
      } catch {
        /* ignore */
      }
      // An EXTRA checkout (the frontend) is served as a BUILT app — pulling
      // its source changes nothing on screen until dist is rebuilt. vite
      // preview reads dist from disk on every request (sirv dev:true), so a
      // rebuild is also all it takes: no frontend process restart. Staleness
      // is judged against the .commit marker, NOT "did this pull move HEAD" —
      // a commit pulled earlier without a build would otherwise stay unserved
      // forever.
      let note = "";
      if (root !== this.repoRoot && this.hasBuildScript(root)
        && this.builtCommit(root) !== after) {
        try {
          await this.pnpmIn(root, "install");
          await this.pnpmIn(root, "run", "build");
          writeFileSync(path.join(root, "dist", ".commit"), after);
          note = " — build шинэчлэгдлээ";
        } catch (e) {
          buildFailed = true;
          note = ` — build амжилтгүй: ${gitError(e)}`;
        }
      }
      const moved = after !== before;
      repos.push({
        name,
        updated: moved || note === " — build шинэчлэгдлээ",
        previousCommit: short(before),
        newCommit: short(after),
        message: moved
          ? `${short(before)} → ${short(after)}${note}`
          : note
            ? `Код хамгийн сүүлийн үеийнх${note}`
            : "Хамгийн сүүлийн үеийнх.",
      });
    }

    const selfRepo = repos[0];
    const newCommit = selfRepo && selfRepo.newCommit !== "unknown"
      ? selfRepo.newCommit : previousCommit;
    const newVersion = this.packageVersion();

    const backendChanged = selfRepo?.updated ?? false;
    const updated = repos.some((r) => r.updated);

    // Only a backend code change needs THIS process to restart; a frontend
    // update was already rebuilt above and shows up on the next browser
    // reload.
    const managed = process.env.FAW_MANAGED === "1";
    const restarting = backendChanged && managed;

    if (restarting) {
      // Let the GraphQL response flush first, then hand control back to the
      // launcher loop which reinstalls deps, re-runs migrations and relaunches.
      setTimeout(() => process.exit(RESTART_EXIT_CODE), 1500);
    }

    let message: string;
    if (!updated) {
      message = "Шинэ хувилбар алга — код хамгийн сүүлийн үеийнх байна.";
    } else if (restarting) {
      message = "Шинэчлэл татагдлаа — сервер дахин ачаалж байна…";
    } else if (backendChanged) {
      message = "Шинэчлэл татагдлаа. Идэвхжүүлэхийн тулд серверийг дахин ачаална уу.";
    } else if (buildFailed) {
      message = "Шинэчлэл татагдлаа, гэвч build амжилтгүй — доорх мөрийг харна уу.";
    } else {
      message = "Шинэчлэл татагдлаа — хуудсаа дахин ачаалахад шинэ хувилбар ажиллана.";
    }

    return {
      updated,
      previousCommit: short(previousCommit),
      newCommit: short(newCommit),
      previousVersion,
      newVersion,
      message,
      restarting,
      repos,
    };
  }
}

function short(commit: string): string {
  return commit && commit !== "unknown" ? commit.slice(0, 7) : commit;
}
