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
import {execFile, spawn} from "node:child_process";
import {promisify} from "node:util";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

const pexec = promisify(execFile);

// execFile rejects with "Command failed: git pull --ff-only" and buries the
// reason in .stderr. Surfacing only the first line of .message told the analyst
// nothing about what to fix, so prefer git's own words.
// Git failing to READ a checkout has three usual causes on the workstation,
// and "Git-ийн сан биш" was printed for all three: git not installed (or not
// on the service account's PATH), Windows' dubious-ownership guard, and an
// actual non-checkout. Name the one that happened, with the fix where there
// is one.
function gitReadError(e: unknown, root: string): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") {
    return "git олдсонгүй — Git суулгаагүй эсвэл PATH дээр байхгүй байна";
  }
  const raw = gitError(e);
  if (/dubious ownership/i.test(raw)) {
    return `Git энэ хавтасны эзэмшигчийг зөвшөөрөхгүй байна. Тушаал: `
      + `git config --global --add safe.directory `
      + `"${root.replace(/\\/g, "/")}"`;
  }
  if (/not a git repository/i.test(raw)) {
    return `Git-ийн сан биш: ${root}`;
  }
  return `${raw} (${root})`;
}

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
  // Why `commit` is unknown, when it is. Null when the checkout reads fine.
  error: string | null;
}

export interface RepoUpdate {
  name: string;
  updated: boolean;
  // A pull or a build that ERRORED. Without this the Settings page cannot tell
  // "nothing to do" from "it broke": both arrive as updated=false, and the page
  // used to announce a failed update as "Шинэ хувилбар алга".
  failed: boolean;
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
  // At least one checkout could not be pulled or rebuilt. The page paints the
  // banner red on this, never on `updated`.
  failed: boolean;
  previousCommit: string;
  newCommit: string;
  previousVersion: string;
  newVersion: string;
  message: string;
  restarting: boolean;
  repos: RepoUpdate[];
}

export interface UpdateLog {
  running: boolean;
  lines: string[];
}

export class UpdateService {
  private readonly repoRoot: string;

  // Live output of the update currently running. The Settings page polls
  // this while the button spins — a 1-2 minute pnpm build shows movement
  // line by line instead of dead silence.
  private updateLogLines: string[] = [];
  private updating = false;

  // The launcher cd's to the project root before `pnpm start`, so cwd is the
  // repo root; allow an override for tests.
  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
  }

  private async git(...args: string[]): Promise<string> {
    return this.gitIn(this.repoRoot, ...args);
  }

  // Every git call carries `-c safe.directory` for the folder it runs in.
  //
  // Windows git refuses to touch a repository owned by a different account
  // ("detected dubious ownership"), and the workstation's checkouts were made
  // by a different user than the one autostart runs as — which is exactly why
  // `pnpm dev` by hand worked while the auto-started build could not read its
  // own repo. Fixing that with `git config --global` would only fix it for
  // whoever typed it; carrying it on the command line fixes it for whoever
  // runs the app. The "command" scope is protected configuration, the only
  // kind safe.directory is honoured from — a repo-local setting is ignored.
  //
  // Both spellings are passed: git compares the path as written, and Windows
  // gives it back with backslashes while git's own examples use forward ones.
  private async gitIn(cwd: string, ...args: string[]): Promise<string> {
    const safe = [
      "-c", `safe.directory=${cwd}`,
      "-c", `safe.directory=${cwd.replace(/\\/g, "/")}`,
    ];
    const {stdout} = await pexec("git", [...safe, ...args], {cwd});
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
    // path.resolve: the launcher hands over "%CD%\..\forensic-frontend",
    // which cmd does not normalise — and an unnormalised path is what the
    // Settings table then shows and what a safe.directory command would have
    // to be typed with.
    const env = (process.env.FAW_UPDATE_REPOS ?? "")
      .split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p));
    if (env.length) return env;
    const sibling = path.resolve(this.repoRoot, "..", "forensic-frontend");
    return existsSync(path.join(sibling, ".git")) ? [sibling] : [];
  }

  // "origin git@github.com:… · master" — one line for the live log.
  private async describeRemote(root: string): Promise<string> {
    const url = await this.gitIn(root, "remote", "get-url", "origin")
      .catch(() => "remote алга");
    const branch = await this.gitIn(root, "rev-parse", "--abbrev-ref", "HEAD")
      .catch(() => "?");
    return `origin ${url} · ${branch}`;
  }

  updateLog(): UpdateLog {
    return {running: this.updating, lines: [...this.updateLogLines]};
  }

  private push(line: string): void {
    this.updateLogLines.push(line);
    if (this.updateLogLines.length > 500) {
      this.updateLogLines.splice(0, this.updateLogLines.length - 500);
    }
  }

  // Which package manager to drive this checkout with.
  //
  // The repos are pnpm projects, but the Windows workstation is installed and
  // launched with npm on purpose (scripts/start-windows.bat: npm is on the
  // MACHINE path, so it also works when the Scheduled Task starts the app as
  // SYSTEM at boot). Hard-coding pnpm here meant the in-app Update button tried
  // to drive a checkout that npm had installed — and on a machine with no pnpm
  // at all it failed with ENOENT before it could build anything.
  //
  // So: follow whoever created node_modules, and only fall back to a
  // preference when there is nothing to follow.
  private packageManager(root: string): "pnpm" | "npm" {
    const modules = path.join(root, "node_modules");
    // pnpm leaves this file; npm and yarn do not.
    if (existsSync(path.join(modules, ".modules.yaml"))) return "pnpm";
    if (existsSync(modules)) return "npm";
    return existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  }

  // Reinstall + rebuild a pulled checkout, streaming every output line into
  // the live log. On Windows the binaries are pnpm.cmd / npm.cmd, which Node
  // refuses to spawn without a shell (CVE-2024-27980) — hence the flag.
  private runPm(pm: "pnpm" | "npm", cwd: string,
    ...args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const win = process.platform === "win32";
      this.push(`$ ${pm} ${args.join(" ")}`);
      const child = spawn(win ? `${pm}.cmd` : pm, args, {
        cwd,
        shell: win,
        // There is no TTY here, and pnpm ABORTS instead of assuming yes when
        // it wants to confirm something (e.g. purging an npm-made
        // node_modules). CI=true makes every such prompt non-interactive.
        env: {...process.env, CI: "true"},
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("10 минутад багтсангүй — тасаллаа"));
      }, 10 * 60_000);
      // The last chunk of output doubles as the error message on failure —
      // the exit code alone explains nothing.
      let tail = "";
      const onData = (b: Buffer) => {
        const text = b.toString();
        tail = (tail + text).slice(-2000);
        for (const raw of text.split(/\r?\n|\r/)) {
          const line = raw.trimEnd();
          if (line) this.push(line);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => {
        clearTimeout(timer);
        // ENOENT here means the package manager is not on this machine's PATH
        // at all. The raw "spawn pnpm.cmd ENOENT" tells the analyst nothing.
        const code = (e as NodeJS.ErrnoException).code;
        reject(code === "ENOENT"
          ? new Error(`${pm} олдсонгүй — энэ компьютерт суугаагүй байна`)
          : e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          const last = tail.split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
          reject(new Error(last || `exit ${code}`));
        }
      });
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

  // The FOLDER name — forensic-api / forensic-frontend. package.json calls
  // them forensic-analyst-backend/-frontend, which is a third set of names
  // nobody types, and an error naming them could not be matched to a folder.
  private repoName(root: string, fallback: string): string {
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
      error: null,
    };
    try {
      info.commit = await this.gitIn(root, "rev-parse", "--short", "HEAD");
    } catch (e) {
      info.error = gitReadError(e, root);
      return info;
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
    this.updating = true;
    this.updateLogLines = [];
    try {
      return await this.runSelfUpdate();
    } finally {
      this.updating = false;
    }
  }

  private async runSelfUpdate(): Promise<UpdateResult> {
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
    // FRONTEND FIRST, THE BACKEND LAST. The backend is the process running
    // this code: when its own pull lands it exits for the launcher to restart
    // it, and anything still queued behind that would be abandoned half-done.
    // Doing every other checkout first means a backend restart can only ever
    // interrupt work that is already finished.
    const order = [...this.extraRepos(), this.repoRoot];
    for (const root of order) {
      const name = this.repoName(root, "repo");
      let before = "unknown";
      try {
        before = await this.gitIn(root, "rev-parse", "HEAD");
      } catch (e) {
        const why = gitReadError(e, root);
        this.push(why);
        repos.push({name, updated: false, failed: true,
          previousCommit: "unknown", newCommit: "unknown", message: why});
        continue;
      }
      this.push(`── ${name}: git pull…`);
      // WHERE it pulls from, in the log. "Шинэ хувилбар алга" on a workstation
      // that is demonstrably behind usually means the checkout points at
      // another remote or sits on another branch — invisible until printed.
      this.push(`   ${await this.describeRemote(root)}`);
      try {
        await this.pullIn(root);
      } catch (e) {
        this.push(`татаж чадсангүй: ${gitError(e)}`);
        repos.push({name, updated: false, failed: true,
          previousCommit: short(before), newCommit: short(before),
          message: `Татаж чадсангүй: ${gitError(e)}`});
        continue;
      }
      let after = before;
      try {
        after = await this.gitIn(root, "rev-parse", "HEAD");
      } catch {
        /* ignore */
      }
      this.push(after !== before
        ? `${short(before)} → ${short(after)}`
        : "шинэ commit алга");
      // An EXTRA checkout (the frontend) is served as a BUILT app — pulling
      // its source changes nothing on screen until dist is rebuilt. vite
      // preview reads dist from disk on every request (sirv dev:true), so a
      // rebuild is also all it takes: no frontend process restart. Staleness
      // is judged against the .commit marker, NOT "did this pull move HEAD" —
      // a commit pulled earlier without a build would otherwise stay unserved
      // forever.
      let note = "";
      let repoBuildFailed = false;
      if (root !== this.repoRoot && this.hasBuildScript(root)
        && this.builtCommit(root) !== after) {
        const pm = this.packageManager(root);
        try {
          await this.runPm(pm, root, "install");
          await this.runPm(pm, root, "run", "build");
          writeFileSync(path.join(root, "dist", ".commit"), after);
          note = " — build шинэчлэгдлээ";
          this.push("build амжилттай ✓");
        } catch (e) {
          repoBuildFailed = true;
          note = ` — build амжилтгүй: ${gitError(e)}`;
          this.push(`build амжилтгүй: ${gitError(e)}`);
        }
      }
      const moved = after !== before;
      repos.push({
        name,
        updated: moved || note === " — build шинэчлэгдлээ",
        failed: repoBuildFailed,
        previousCommit: short(before),
        newCommit: short(after),
        message: moved
          ? `${short(before)} → ${short(after)}${note}`
          : note
            ? `Код хамгийн сүүлийн үеийнх${note}`
            : "Хамгийн сүүлийн үеийнх.",
      });
    }

    // The backend's own entry is the LAST one now — find it by name, not by
    // position.
    const selfName = this.repoName(this.repoRoot, "repo");
    const selfRepo = repos.find((r) => r.name === selfName) ?? repos[0];
    const newCommit = selfRepo && selfRepo.newCommit !== "unknown"
      ? selfRepo.newCommit : previousCommit;
    const newVersion = this.packageVersion();

    const backendChanged = selfRepo?.updated ?? false;
    const updated = repos.some((r) => r.updated);

    // A pull or build that ERRORED must never be reported as "nothing new".
    // It was: the headline read `updated` first, so a workstation whose pull
    // failed (no credentials, local edits, wrong branch) and a workstation
    // that was genuinely current printed the SAME calm grey sentence —
    // "Шинэ хувилбар алга" — while the screen quietly stayed on old code.
    const failedRepos = repos.filter((r) => r.failed);
    const failed = failedRepos.length > 0;

    // Only a backend code change needs THIS process to restart; a frontend
    // update was already rebuilt above and shows up on the next browser
    // reload.
    const managed = process.env.FAW_MANAGED === "1";
    // ⛔ Never exit while another checkout failed. The restart hands the
    // process to the launcher loop, and the analyst is then staring at a dead
    // app AND a failure message he can no longer read. Fix the failure, press
    // the button again, and the backend restarts on the next clean run.
    const restarting = backendChanged && managed && !failed;

    if (restarting) {
      // Let the GraphQL response flush first, then hand control back to the
      // launcher loop which reinstalls deps, re-runs migrations and relaunches.
      setTimeout(() => process.exit(RESTART_EXIT_CODE), 1500);
    }

    let message: string;
    if (failed && !updated) {
      message = `Шинэчлэл амжилтгүй — ${failedRepos
        .map((r) => `${r.name}: ${r.message}`).join(" | ")}`;
    } else if (!updated) {
      message = "Шинэ хувилбар алга — код хамгийн сүүлийн үеийнх байна.";
    } else if (failed) {
      message = backendChanged
        ? "Заримыг нь шинэчиллээ, гэвч алдаа гарлаа. Серверийг дахин "
          + "ачаалаагүй — алдааг зассны дараа дахин дарна уу."
        : "Заримыг нь шинэчиллээ, гэвч алдаа гарлаа — доорх мөрийг харна уу.";
    } else if (restarting) {
      message = "Шинэчлэл татагдлаа — сервер дахин ачаалж байна…";
    } else if (backendChanged) {
      message = "Шинэчлэл татагдлаа. Идэвхжүүлэхийн тулд серверийг дахин ачаална уу.";
    } else {
      message = "Шинэчлэл татагдлаа — хуудсаа дахин ачаалахад шинэ хувилбар ажиллана.";
    }

    return {
      updated,
      failed,
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
