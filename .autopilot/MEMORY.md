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
- CASE SCOPE (resolvers.ts caseSuspectIds/scopedAccounts): with an active
  case, suspects/bankAccounts/transactions/callRecords/suspectLinks/
  correlations return ONLY that case's records — membership = SUSPECT
  evidence_entries (suspects.caseId is a legacy fallback, null in practice),
  chained suspect → account/phone → txn/call. No active case = all data.

## Done
- 2026-07-02: setCaseStatus(caseFileId, status) mutation — stamps/clears
  closedAt on CLOSED/ARCHIVED, audit-logged.
- 2026-07-02: importService.resolveSubjectAccount — BANK imports no longer
  require bankAccountId; subject's first account is used or a placeholder
  (ХУУЛГА-<suspectId>) is created.
- 2026-07-02: dataService.mergeCases(sourceIds, targetId) + mergeCases
  mutation — moves evidence (exhibits renumbered after target's, dupes of
  same source dropped) and case_notes; sources archived with pointer note;
  session switches to target when a source was active.
- 2026-07-02: import row-level attribution — CDR rows match suspects by
  phone last-8-digit suffix; bank rows route per "Данс"/account column via
  findOrCreateAccount (unowned when new); resolveDefaultAccount fallback
  (explicit id → subject's account → ХУУЛГА-ИМПОРТ). subjectSuspectId
  optional. Bank profiles gained account:["Данс","Дансны дугаар"].
- 2026-07-02: peopleService.getGlobalPeople + `globalPeople` query — groups
  suspect rows into persons (union-find: normalized name, phone last-8,
  nationalId); aggregates cases via SUSPECT evidence_entries, phones,
  accounts, txn/call counts, matchedBy reasons.
- 2026-07-02: evidence list queries case-scoped server-side (see CASE SCOPE
  convention above). dashboardStats stays global (command overview).

## Parked (NOT in this run's backlog)
- Import does not tag suspects into the active case, so freshly imported
  data is hidden while a case is scoped until the person is tagged
  (КЕЙСТ ТЭМДЭГЛЭХ). Consider auto-tagging import-touched suspects into
  the active case at import time.
