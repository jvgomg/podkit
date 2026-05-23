---
id: TASK-310
title: Doctor JSON output schema and human-text rendering
status: Done
assignee: []
created_date: '2026-05-08 07:25'
updated_date: '2026-05-23 18:19'
labels:
  - testing
  - doctor
  - output
  - vm-coverage
milestone: m-19
dependencies: []
priority: low
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lock in the public output contract of `podkit doctor` (JSON schema and the human-text section structure) so changes that break the contract surface as test failures rather than as silent regressions in user-facing output.

The JSON output is consumed by the docs site, by `gpod-tool` integration, and potentially by user scripts — its shape is part of the public API. The human text output is what users see when triaging a device, and several historical regressions (missing 'Issues:' block, suggested-action commands missing the right `-d` argument) would have been caught by structural assertions on stdout.

For every test, run `podkit doctor` against a fixture in a known state and assert on the precise output shape. Use a small number of fixtures that cover the interesting state combinations rather than enumerating; the value here is contract-stability, not state-matrix coverage.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; use `DevicePersona.expectedDoctorOutput` as the canonical golden reference for JSON schema assertions — no inline goldens
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner; golden JSON schema is verified against real `podkit doctor` output for each starter persona
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 JSON schema (diagnostics mode): top-level keys are exactly { healthy, mountPoint, deviceModel, deviceType, readiness?, checks }; no extras
- [x] #2 JSON schema: every checks[] entry has { id, name, status, summary, repairable } as required keys, with optional { details, docsUrl }
- [x] #3 JSON schema: status values are constrained to 'pass'|'fail'|'warn'|'skip'; no other strings appear
- [x] #4 JSON schema: deviceType is one of 'ipod'|'mass-storage'
- [x] #5 JSON schema (readiness): readiness.stages[] entries have { stage, status, summary } required, optional { details }; stage values from the documented six-stage set
- [x] #6 JSON schema (repair mode): top-level keys are { success, summary, checkId, dryRun }, optional { details }
- [x] #7 Human text: starts with 'podkit doctor — checking iPod at <path>' header for iPod, 'podkit doctor — <label> at <path>' for mass-storage
- [x] #8 Human text (iPod): includes 'System' section when system checks ran, 'Device Readiness' section, 'Database Health' section in that order
- [x] #9 Human text (mass-storage): includes 'Device Health' section; no readiness or system header (when --no-system) or no readiness header (mass-storage doesn't run readiness)
- [x] #10 Human text: closing line is 'All checks passed.' (success) or 'N issue(s) found.' (failure); pluralisation correct for N=1
- [x] #11 Human text: when issues exist, an 'Issues:' block follows with one entry per non-passing check, including marker, label, summary, optional details indented, optional 'Fix:' command, optional 'Docs:' link
- [x] #12 Human text: 'Fix:' commands are copy-pasteable verbatim (path arguments are shell-quoted when they contain whitespace or metacharacters)
- [x] #13 Human text: 'Fix:' commands echo the device argument the user typed (config name like 'main' or path), not always the resolved path
- [x] #14 Human text in --json mode: stdout is empty of human prose; only the JSON document appears
- [x] #15 Output stability: running doctor twice in a row against the same fixture produces byte-identical JSON output (modulo timestamps that are not currently emitted)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-05-23 — TASK-310 landed. Tier-3 GREEN 79 pass / 447 expect / 12 files / 125s.**

Single test file `packages/device-testing/src/tier3/task-310-doctor-output-contract.tier3.test.ts` (816 lines, 13 new tests). All 15 ACs covered:

- JSON schema (ACs #1-6, #14, #15): top-level key set, checks[] required/optional shape, status enum, deviceType enum, readiness.stages shape (via device scan), repair envelope shape (via --repair udev-rule --dry-run), --json mode stdout purity, byte-identical re-runs
- Human text (ACs #7-13): header line shape, section ordering for iPod/mass-storage, closing line pluralisation, Issues block presence + Fix/Docs lines, fix command shell-quoting, fix command echoing user's -d argument

Persona reuse only — no new personas. Used `ipod-video-5g-iflash-1tb`, `echo-mini`, `ipod-touch-5g-unsupported`.

Worker API died during final reporting (ConnectionRefused) but all test code + tests landed cleanly; team-lead ticked ACs post-hoc after verifying tests pass.
<!-- SECTION:NOTES:END -->
