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

The launcher uses **`npm`** (not pnpm) and runs from the **Command Prompt**, so
it works reliably from the `SYSTEM` account at boot. Everything lives in
[`scripts/`](scripts/):

| Script | Purpose |
| --- | --- |
| `start-windows.bat` | Launcher — `npm install` (first run), `npm run migrate`, `npm run start`. Also a self-update **restart loop** (honours exit code 42). |
| `install-startup-windows.bat` | Registers the boot Scheduled Task (uses `schtasks`, no PowerShell). |
| `uninstall-startup-windows.bat` | Removes that task. |
| `self-update.bat` | `git pull` + `npm install` + restart the Scheduled Task. |

### Install (run once) — Command Prompt

Open **Command Prompt as Administrator** (right-click → *Run as administrator*),
`cd` to the project root, and run:

```bat
scripts\install-startup-windows.bat
```

This creates a Scheduled Task named **`ForensicAnalystBackend`** that runs
`start-windows.bat` on every system boot as `SYSTEM` (elevated).

Handy commands:

```bat
schtasks /Run    /TN "ForensicAnalystBackend"    &  :: start it now, no reboot
schtasks /End    /TN "ForensicAnalystBackend"    &  :: stop it
scripts\uninstall-startup-windows.bat            &  :: remove it
```

> Requires Node.js (which provides `npm`) on the system `PATH`. On self-update
> the launcher also pulls the sibling frontend checkout when `..\forensic-frontend`
> exists (via the `FAW_UPDATE_REPOS` env var). PowerShell installers
> (`install-startup-windows.ps1`) are still included as an alternative.

## Self-update

An admin can pull the latest code straight from the **Settings** page
(git pull + automatic restart), or run `scripts\self-update.bat` manually /
on a schedule. Requires the `origin` remote above to be configured.

## Reports

PDF reports (per-suspect and marked-suspects) are issued from
`Улаанбаатар хот` by default. Override the location printed in the report header
with the `REPORT_LOCATION` environment variable.
