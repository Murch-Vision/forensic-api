# Forensic Analyst — Backend

Node / TypeScript / Knex / GraphQL backend for the Forensic Analyst Workstation.

**Repository:** https://github.com/Murch-Vision/forensic-api

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/) (`corepack enable` provides it)

## Setup

```bash
pnpm install
pnpm migrate      # apply database migrations
pnpm start        # production  (tsx src/index.ts)
pnpm dev          # watch mode
```

The GraphQL API listens on `PORT` (default `4000`).

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port. Default `4000`. |
| `CORS_ORIGIN` | Comma-separated allow-list of browser origins, e.g. `http://localhost:5173,http://192.168.1.50:5173`. Unset reflects whichever origin asks — right for an on-premise box reached by localhost, hostname and LAN IP alike. |
| `BODY_LIMIT` | Max request body. Default `50mb`; imported statements arrive base64-encoded in the mutation body. |
| `DB_CLIENT` / `DB_FILE` / `DATA_DIR` | SQLite by default; `DB_CLIENT=pg` switches to Postgres. |
| `REPORT_LOCATION` | Location printed in the PDF report header. |

`GET /health` answers `{"ok":true}` without touching the database, for uptime
checks and the launcher.

## Windows: start automatically

Autostart is a plain batch file in your **Startup folder**. No Task Scheduler,
no service, no administrator. Everything lives in [`scripts/`](scripts/):

| Script | Purpose |
| --- | --- |
| `start-windows.bat` | Launcher — `npm install` (first run), `npm run migrate`, `npm run start`. Also a self-update **restart loop** (honours exit code 42). |
| `install-startup-windows.bat` | Adds the launcher to your Startup folder. |
| `uninstall-startup-windows.bat` | Removes it. |
| `self-update.bat` | `git pull` + `npm install` + restart the launcher. |

### Install (run once)

**Double-click** `scripts\install-startup-windows.bat`. That is the whole
install. It writes `ForensicAnalystBackend.bat` into

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

and starts the backend straight away so you can see it work.

To remove it later, double-click `scripts\uninstall-startup-windows.bat`.

> **It starts when you log in, not at boot.** That is the deliberate trade-off:
> it runs as *you*, with *your* `PATH`, in *your* session — the same environment
> where starting it by hand already works. A boot-time Scheduled Task runs as
> `SYSTEM`, which cannot see a per-user Node install, is blocked by the default
> laptop battery policy, and is killed after 3 days. That is why the old task
> reported success and then did nothing. If nobody logs in, nothing runs.
>
> If the app does not come up, read `logs\startup.log` — the launcher records
> every step there, including exactly where it failed.
>
> On self-update the launcher also pulls the sibling frontend checkout when
> `..\forensic-frontend` exists (via the `FAW_UPDATE_REPOS` env var).

## Self-update

An admin can pull the latest code straight from the **Settings** page
(git pull + automatic restart), or run `scripts\self-update.bat` manually /
on a schedule. Requires the `origin` remote above to be configured.

## Reports

PDF reports (per-suspect and marked-suspects) are issued from
`Улаанбаатар хот` by default. Override the location printed in the report header
with the `REPORT_LOCATION` environment variable.
