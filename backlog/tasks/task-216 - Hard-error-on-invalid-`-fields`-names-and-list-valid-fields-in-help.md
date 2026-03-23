---
id: TASK-216
title: Hard error on invalid `--fields` names and list valid fields in help
status: To Do
assignee: []
created_date: '2026-03-23 18:25'
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
- [ ] #1 Invalid field names produce a hard error (non-zero exit) with a message listing all valid field names
- [ ] #2 Valid field names are listed in `--help` output for commands that support `--fields`
- [ ] #3 Error message format: "Unknown field 'foo'. Valid fields: title, artist, album, ..."
- [ ] #4 Existing valid field usage continues to work unchanged
- [ ] #5 Tests cover: single invalid field errors, mix of valid+invalid errors, error message includes valid field list
<!-- AC:END -->
