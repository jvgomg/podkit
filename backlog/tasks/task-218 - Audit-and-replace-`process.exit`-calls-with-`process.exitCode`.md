---
id: TASK-218
title: Audit and replace `process.exit()` calls with `process.exitCode`
status: Done
assignee: []
created_date: '2026-03-23 18:25'
updated_date: '2026-03-27 13:03'
labels:
  - cli
  - bug
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User testing revealed truncated JSON when piping CLI output to `node -e`. Investigation found that some commands use `process.exit(1)` which terminates immediately and can truncate stdout buffers before they flush. Other commands correctly use `process.exitCode = 1` which allows Node.js to exit naturally after streams drain.

Known `process.exit()` usage in: `packages/podkit-cli/src/commands/init.ts`, `packages/podkit-cli/src/commands/migrate.ts`, `packages/podkit-cli/src/commands/mount.ts`.

All `process.exit()` calls should be replaced with `process.exitCode` assignment to prevent output truncation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No `process.exit()` calls remain in CLI command handlers
- [x] #2 All exit paths use `process.exitCode = N` instead
- [x] #3 JSON output is not truncated when piping to another process (e.g., `| node -e`)
- [x] #4 Non-zero exit codes still propagate correctly for error cases
- [x] #5 Tests verify exit code behavior for error paths
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced all `process.exit(1)` calls in CLI command handlers with `process.exitCode = 1; return;` to prevent stdout buffer truncation when piping output.

**Changes:**
- `init.ts`: action handler error path (config already exists)
- `migrate.ts`: two error paths (config file not found, config version parse error)
- `completions.ts`: unsupported shell and failed write-to-config paths; `getRootCommand()` converted to throw an Error (preserves TypeScript `never` return typing without `process.exit`)

The only remaining `process.exit` call is in `shutdown.ts` line 54 — an injectable wrapper for SIGINT/SIGTERM handling, which is intentional.

**Tests added:**
- `initCommand action exit codes` (2 tests): verifies exitCode=1 on existing config, exitCode=0 on success
- `migrateCommand action exit codes` (1 test): verifies exitCode=1 when config file not found
- `completions install action exit codes` (1 test): verifies exitCode=1 for unsupported shell

All 851 unit tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
