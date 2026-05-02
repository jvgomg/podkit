---
id: TASK-216
title: Hard error on invalid `--fields` names and list valid fields in help
status: Done
assignee: []
created_date: '2026-03-23 18:25'
updated_date: '2026-03-27 13:01'
labels:
  - cli
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User testing revealed that `--fields` silently ignores invalid field names and falls back to defaults, making the feature appear broken. The tester concluded `--fields` didn't work with JSON output — in reality they likely typo'd a field name and got silent fallback.

Additionally, `--help` doesn't list valid field names, so there's no way to discover them without reading source code.

Key file: `packages/podkit-cli/src/commands/display-utils.ts` — `parseFields()` at line 239 silently ignores invalid names and returns `DEFAULT_FIELDS` when all are invalid.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Invalid field names produce a hard error (non-zero exit) with a message listing all valid field names
- [x] #2 Valid field names are listed in `--help` output for commands that support `--fields`
- [x] #3 Error message format: "Unknown field 'foo'. Valid fields: title, artist, album, ..."
- [x] #4 Existing valid field usage continues to work unchanged
- [x] #5 Tests cover: single invalid field errors, mix of valid+invalid errors, error message includes valid field list
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Modified `parseFields` in `display-utils.ts` to throw an error instead of silently ignoring invalid field names. The error message format follows the spec: "Unknown field: 'foo'. Valid fields: title, artist, ..." (or "Unknown fields: 'foo', 'bar'" for multiple invalids).

Updated all four action handlers (music/video in both `collection.ts` and `device.ts`) to:
1. Move the `parseFields` call to after `outputError` is defined so errors are surfaced via the standard error path
2. Wrap `parseFields` in a try/catch that calls `outputError` and returns (non-zero exit via `process.exitCode = 1`)

Updated `--fields` option description in all four commands to list all valid fields inline (e.g. `Valid: title, artist, album, ...`).

Updated `display-utils.test.ts` to replace the old "silently ignores" tests with tests that assert the correct error is thrown and includes the valid field list.
<!-- SECTION:FINAL_SUMMARY:END -->
