# Forensic Analyst — Backend

Node / TypeScript / Knex / GraphQL backend for the Forensic Analyst Workstation.

**Repository:** https://github.com/Murch-Vision/forensic-api

## Requirements

- Node.js 22.12+ (22 LTS) or 24 LTS, x64 for Windows
- [pnpm](https://pnpm.io/) 10 (`npm.cmd install -g pnpm@10.34.7` on Windows)

## Setup

```bash
pnpm install
pnpm migrate      # apply database migrations
pnpm start        # production  (tsx src/index.ts)
pnpm dev          # watch mode
```

The GraphQL API listens on `PORT` (default `4000`). Copy
[`env.example`](env.example) to `.env` to configure it:

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port. Default `4000`. |
| `CORS_ORIGIN` | Comma-separated allow-list of browser origins, e.g. `http://localhost:5173,http://192.168.1.50:5173`. Unset reflects whichever origin asks — right for an on-premise box reached by localhost, hostname and LAN IP alike. |
| `BODY_LIMIT` | Max request body. Default `50mb`; imported statements arrive base64-encoded in the mutation body. |
| `DB_CLIENT` / `DB_FILE` / `DATA_DIR` | SQLite by default; `DB_CLIENT=pg` switches to Postgres. |
| `REPORT_LOCATION` | Location printed in the PDF report header. |

`GET /health` answers `{"ok":true}` without touching the database, for uptime
checks and the launcher.

## Windows 11 Pro

See [WINDOWS.md](WINDOWS.md) for installation, repair and log collection.

The `.bat` entry points use built-in Windows PowerShell 5.1. Autostart uses a
Startup-folder `.lnk` that runs PowerShell directly; VBScript is not required.
Installation checks Node.js x64, pnpm 10 and locked dependencies. The backend
checks native SQLite/sharp modules and applies migrations before listening.
A failed install, migration or frontend build stops startup with an error in
`logs\startup.log`; it never announces a failed setup as successful.

| Script in `scripts\` | Purpose |
| --- | --- |
| `start-windows.bat` | Run this checkout and show startup failures. |
| `install-startup-windows.bat` | Prepare this checkout, replace legacy startup entries and start it at login. |
| `uninstall-startup-windows.bat` | Remove this checkout's startup entry; leave the running app alone. |
| `update-all.bat` / `self-update.bat` | Update both sibling checkouts, prepare them, restart those that were running. |

Updates stop only the selected checkout's process tree before replacing native
DLLs. They do not terminate unrelated Node.js programs. Startup builds the frontend
again when its Git commit differs from `dist/.commit`.

## Reports

PDF reports (per-suspect and marked-suspects) are issued from
`Улаанбаатар хот` by default. Override the location printed in the report header
with the `REPORT_LOCATION` environment variable.
