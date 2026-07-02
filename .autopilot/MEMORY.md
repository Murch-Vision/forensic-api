# Autopilot Memory — forensic-api

Apollo Server 4 + Knex/better-sqlite3 GraphQL API for the forensic-frontend
repo (see its .autopilot/MEMORY.md for the shared product map/backlog).
Dev server runs via `tsx watch` and hot-reloads on save.

## Baseline (2026-07-02)
`pnpm build` = `tsc --noEmit` — PASSES, 0 errors. No tests.

## Conventions
- Schema: src/graphql/schema.ts (SDL string). Resolvers thin, delegate to
  services (src/services/dataService.ts etc.), audit via c.audit.record().
- Case session: caseSessionService.ts (process-wide active case + pins).

## Done
- 2026-07-02: setCaseStatus(caseFileId, status) mutation — stamps/clears
  closedAt on CLOSED/ARCHIVED, audit-logged.
