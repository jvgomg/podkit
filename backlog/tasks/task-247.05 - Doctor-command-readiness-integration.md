---
id: TASK-247.05
title: Doctor command readiness integration
status: To Do
assignee: []
created_date: '2026-03-26 01:54'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
references:
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-core/src/diagnostics/index.ts
  - packages/podkit-core/src/diagnostics/types.ts
parent_task_id: TASK-247
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enhance the `podkit doctor` command to run device readiness checks before database health checks, providing a complete top-to-bottom diagnostic experience.

**PRD:** doc-023 | **Parent:** TASK-247

**Two-phase diagnostic:**
1. Readiness checks (USB → partition → filesystem → mount → SysInfo → database)
2. Existing DB checks (artwork integrity, orphan files) — only if device is ready enough

**Graceful degradation:**
- If device isn't fully ready, show readiness failures and skip DB checks with a clear message explaining why
- **Partially-ready devices** (mounted + iPod_Control but no SysInfo/DB): show SysInfo warning + database failure specifically, don't blanket-skip everything
- Readiness checks use same verbose check/cross output format as scan

**Refactoring needed:**
- `runDiagnostics()` currently calls `IpodDatabase.open(mountPoint)` which throws if DB doesn't exist
- Need to make `db` optional in `DiagnosticContext` (or create `PreDiagnosticContext`) so readiness checks can run without a database
- Existing DB-dependent checks (`artwork`, `orphans`) skip gracefully when `db` is undefined
- Reuse independently callable checks (iPod structure, SysInfo, database) from the readiness pipeline

**User stories:** 6, 13
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Doctor runs readiness checks before database checks
- [ ] #2 If device not ready, DB checks skipped with clear explanation
- [ ] #3 Partially-ready device shows specific failures (not blanket skip)
- [ ] #4 Readiness output uses same check/cross format as scan
- [ ] #5 runDiagnostics refactored to handle missing DB without throwing
- [ ] #6 Existing DB checks (artwork, orphans) skip gracefully when no DB
- [ ] #7 Unit tests: doctor with ready device, unready device, partially-ready device
- [ ] #8 E2E test: doctor on device without DB shows readiness + skipped DB checks
<!-- AC:END -->
