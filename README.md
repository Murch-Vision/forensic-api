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

## Windows: start automatically at boot

Everything needed lives in [`scripts/`](scripts/):

| Script | Purpose |
| --- | --- |
| `start-windows.bat` | Launcher — installs deps, runs migrations, starts the server. Also a self-update **restart loop** (honours exit code 42). |
| `install-startup-windows.ps1` | Registers a Scheduled Task that runs the launcher **at boot**. |
| `uninstall-startup-windows.ps1` | Removes that task. |
| `self-update.bat` | `git pull` + restart the Scheduled Task. |

### Install (run once)

Open **PowerShell as Administrator** in the project root and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-startup-windows.ps1
```

This creates a Scheduled Task named **`ForensicAnalystBackend`** that launches the
backend on every system boot (runs as `SYSTEM`, auto-restarts on failure).

Handy variants:

```powershell
# Start at user logon instead of at system boot
powershell -ExecutionPolicy Bypass -File scripts\install-startup-windows.ps1 -AtLogon

# Start it now without rebooting
Start-ScheduledTask -TaskName ForensicAnalystBackend

# Remove it
powershell -ExecutionPolicy Bypass -File scripts\uninstall-startup-windows.ps1
```

> If `pnpm` isn't on `PATH`, the launcher falls back to `corepack pnpm`
> automatically. On self-update it also pulls the sibling frontend checkout when
> `..\forensic-frontend` exists (via the `FAW_UPDATE_REPOS` env var).

## Self-update

An admin can pull the latest code straight from the **Settings** page
(git pull + automatic restart), or run `scripts\self-update.bat` manually /
on a schedule. Requires the `origin` remote above to be configured.

## Reports

PDF reports (per-suspect and marked-suspects) are issued from
`Улаанбаатар хот` by default. Override the location printed in the report header
with the `REPORT_LOCATION` environment variable.
