---
id: TASK-310
title: Doctor JSON output schema and human-text rendering
status: To Do
assignee: []
created_date: '2026-05-08 07:25'
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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 JSON schema (diagnostics mode): top-level keys are exactly { healthy, mountPoint, deviceModel, deviceType, readiness?, checks }; no extras
- [ ] #2 JSON schema: every checks[] entry has { id, name, status, summary, repairable } as required keys, with optional { details, docsUrl }
- [ ] #3 JSON schema: status values are constrained to 'pass'|'fail'|'warn'|'skip'; no other strings appear
- [ ] #4 JSON schema: deviceType is one of 'ipod'|'mass-storage'
- [ ] #5 JSON schema (readiness): readiness.stages[] entries have { stage, status, summary } required, optional { details }; stage values from the documented six-stage set
- [ ] #6 JSON schema (repair mode): top-level keys are { success, summary, checkId, dryRun }, optional { details }
- [ ] #7 Human text: starts with 'podkit doctor — checking iPod at <path>' header for iPod, 'podkit doctor — <label> at <path>' for mass-storage
- [ ] #8 Human text (iPod): includes 'System' section when system checks ran, 'Device Readiness' section, 'Database Health' section in that order
- [ ] #9 Human text (mass-storage): includes 'Device Health' section; no readiness or system header (when --no-system) or no readiness header (mass-storage doesn't run readiness)
- [ ] #10 Human text: closing line is 'All checks passed.' (success) or 'N issue(s) found.' (failure); pluralisation correct for N=1
- [ ] #11 Human text: when issues exist, an 'Issues:' block follows with one entry per non-passing check, including marker, label, summary, optional details indented, optional 'Fix:' command, optional 'Docs:' link
- [ ] #12 Human text: 'Fix:' commands are copy-pasteable verbatim (path arguments are shell-quoted when they contain whitespace or metacharacters)
- [ ] #13 Human text: 'Fix:' commands echo the device argument the user typed (config name like 'main' or path), not always the resolved path
- [ ] #14 Human text in --json mode: stdout is empty of human prose; only the JSON document appears
- [ ] #15 Output stability: running doctor twice in a row against the same fixture produces byte-identical JSON output (modulo timestamps that are not currently emitted)
<!-- AC:END -->
