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
import {readFileSync} from "node:fs";
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

export interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
}

export interface UpdateResult {
  updated: boolean;
  previousCommit: string;
  newCommit: string;
  previousVersion: string;
  newVersion: string;
  message: string;
  restarting: boolean;
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
  // single "Update" click refreshes the whole workstation. Configured as a
  // path-delimiter-separated list in FAW_UPDATE_REPOS.
  private extraRepos(): string[] {
    return (process.env.FAW_UPDATE_REPOS ?? "")
      .split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  // Pull one extra repo; return true when its HEAD moved. Never throws — a
  // missing/failed sibling repo must not abort the main update.
  private async pullExtra(repo: string): Promise<boolean> {
    try {
      const before = await this.gitIn(repo, "rev-parse", "HEAD");
      await this.pullIn(repo);
      const after = await this.gitIn(repo, "rev-parse", "HEAD");
      return before !== after;
    } catch {
      return false;
    }
  }

  private packageVersion(): string {
    try {
      const raw = readFileSync(path.join(this.repoRoot, "package.json"), "utf8");
      return (JSON.parse(raw).version as string) ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  // Running version + short commit + branch, for the Settings header.
  async version(): Promise<VersionInfo> {
    let commit = "unknown";
    let branch = "unknown";
    try {
      commit = await this.git("rev-parse", "--short", "HEAD");
    } catch {
      /* not a git checkout — leave "unknown" */
    }
    try {
      branch = await this.git("rev-parse", "--abbrev-ref", "HEAD");
    } catch {
      /* ignore */
    }
    return {version: this.packageVersion(), commit, branch};
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

    // Fast-forward only — never create merge commits on the deployment box.
    try {
      await this.pullIn(this.repoRoot);
    } catch (e) {
      const detail = gitError(e);
      return {
        updated: false,
        previousCommit: short(previousCommit),
        newCommit: short(previousCommit),
        previousVersion,
        newVersion: previousVersion,
        message: `Шинэчлэл татаж чадсангүй: ${detail}`,
        restarting: false,
      };
    }

    let newCommit = previousCommit;
    try {
      newCommit = await this.git("rev-parse", "HEAD");
    } catch {
      /* ignore */
    }
    const newVersion = this.packageVersion();

    // Pull any sibling repos (frontend) too, so one click updates everything.
    let extraChanged = false;
    for (const repo of this.extraRepos()) {
      if (await this.pullExtra(repo)) extraChanged = true;
    }

    const backendChanged = newCommit !== previousCommit;
    const updated = backendChanged || extraChanged;

    // Only a backend code change needs THIS process to restart; a frontend-only
    // pull is picked up by Vite / the frontend's own launcher.
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
    } else {
      message = "Шинэчлэл татагдлаа. Идэвхжүүлэхийн тулд серверийг дахин ачаална уу.";
    }

    return {
      updated,
      previousCommit: short(previousCommit),
      newCommit: short(newCommit),
      previousVersion,
      newVersion,
      message,
      restarting,
    };
  }
}

function short(commit: string): string {
  return commit && commit !== "unknown" ? commit.slice(0, 7) : commit;
}
