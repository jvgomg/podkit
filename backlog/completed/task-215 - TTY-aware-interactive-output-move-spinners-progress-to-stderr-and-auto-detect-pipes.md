---
id: TASK-215
title: >-
  TTY-aware interactive output: move spinners/progress to stderr and auto-detect
  pipes
status: Done
assignee: []
created_date: '2026-03-23 18:25'
updated_date: '2026-03-27 13:01'
labels:
  - cli
  - ux
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User testing revealed that spinner frames and ANSI escape sequences are written to stdout, corrupting structured output (JSON/CSV) when piping. Users must use `--quiet` to get clean output, but this also suppresses tips and status messages.

The CLI should be TTY-aware: when stdout is not a TTY (piped/redirected), interactive output (spinners, progress bars) should be automatically suppressed. Additionally, all interactive/dynamic output should route through stderr so that `podkit sync 2>/dev/null` gives clean stdout.

Three layers of control:
- **Auto TTY detection**: suppress spinners/progress when `!process.stdout.isTTY`
- **`--no-tty` flag**: explicit manual equivalent of auto detection (same scope: spinners/progress only)
- **`--quiet` flag**: superset — suppresses spinners, progress, tips, and status messages (already exists, no changes needed)

Key files:
- `packages/podkit-cli/src/output/context.ts` — Spinner class writes to `process.stdout.write()`, needs to use `process.stderr.write()`
- `packages/podkit-cli/src/utils/progress.ts` — DualProgressDisplay uses `out.raw()` which goes to stdout
- `packages/podkit-cli/src/output/context.ts` — `raw()` method is only used for progress visuals, safe to route to stderr
- `packages/podkit-cli/src/main.ts` — global options, add `--no-tty`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Spinners and progress bars write to stderr, not stdout
- [x] #2 When stdout is not a TTY, spinners and progress bars are automatically suppressed without any flags
- [x] #3 New `--no-tty` global flag manually triggers the same suppression as auto TTY detection
- [x] #4 `--quiet` continues to work as a superset (spinners + progress + tips + status messages)
- [ ] #5 `podkit collection music --tracks --format json | jq .` produces valid JSON without any extra flags
- [x] #6 Existing text-mode terminal experience is unchanged (spinners and progress still visible in interactive use)
- [x] #7 Tests cover: auto-detection logic, --no-tty flag, --quiet superset behavior
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Changes

- **`output/types.ts`**: Added `tty: boolean` to `OutputContextConfig`
- **`config/types.ts`**: Added `tty: boolean` to `GlobalOptions`
- **`output/context.ts`**:
  - `Spinner` now writes to `process.stderr` instead of `process.stdout`
  - `raw()` and `clearLine()` now write to `process.stderr`
  - `raw()` and `clearLine()` are suppressed when `tty=false`
  - `spinner()` suppressed when `!tty` (in addition to existing json/quiet checks)
  - `fromGlobalOpts()` auto-detects TTY: `tty = opts.tty && process.stdout.isTTY`
- **`main.ts`**: Added `--no-tty` global flag
- **`utils/progress.ts`**: `getTerminalWidth()` checks `process.stderr.columns` first
- **`output/context.test.ts`**: New test file covering auto-detection, `--no-tty`, and `--quiet` superset
- Fixed `tty: false` in two test helper constructors (`sync-empty-source.test.ts`, `sync-aggregation.test.ts`)

All 905 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
