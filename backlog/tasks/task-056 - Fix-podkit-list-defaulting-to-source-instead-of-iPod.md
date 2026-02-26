---
id: TASK-056
title: Fix podkit list defaulting to source instead of iPod
status: Done
assignee: []
created_date: '2026-02-26 11:37'
updated_date: '2026-02-26 12:11'
labels:
  - bug
  - cli
  - e2e-finding
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Bug found in E2E testing (TASK-029)**

`podkit list` shows the source collection by default instead of iPod tracks. This contradicts the help text which says it should list iPod tracks by default, with `--source` for collection.

**Current behavior:**
- `podkit list` → shows source collection (from config)
- `podkit list --source <path>` → shows source collection

**Expected behavior:**
- `podkit list` → shows iPod tracks
- `podkit list --source <path>` → shows source collection

**Root cause:** The list command is using the source from config by default instead of defaulting to iPod.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit list shows iPod tracks by default
- [x] #2 podkit list --source shows collection
- [x] #3 Help text matches actual behavior
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary
Fixed `podkit list` to default to listing iPod tracks instead of source collection.

## Changes

**packages/podkit-cli/src/commands/list.ts**
- Removed fallback to `config.source` when `--source` flag is not explicitly provided
- Default behavior now correctly attempts to list iPod tracks (using `config.device` if available)

**packages/e2e-tests/src/commands/list.e2e.test.ts**
- Updated "fails when neither device nor source specified" test to use `--config /nonexistent/config.toml` for environment isolation

**packages/e2e-tests/src/commands/status.e2e.test.ts**
- Updated "no device specified" tests to use isolated config for reproducible test behavior

**packages/e2e-tests/src/commands/sync.e2e.test.ts**
- Updated "no source specified" and "no device specified" tests to use isolated config

## Behavior After Fix
- `podkit list` → lists iPod tracks (errors if no device configured/found)
- `podkit list --source <path>` → lists source collection tracks
- `podkit list --device <path>` → lists tracks from specified iPod
<!-- SECTION:FINAL_SUMMARY:END -->
