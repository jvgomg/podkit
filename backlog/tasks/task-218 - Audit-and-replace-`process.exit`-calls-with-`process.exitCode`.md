---
id: TASK-218
title: Audit and replace `process.exit()` calls with `process.exitCode`
status: To Do
assignee: []
created_date: '2026-03-23 18:25'
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
- [ ] #1 No `process.exit()` calls remain in CLI command handlers
- [ ] #2 All exit paths use `process.exitCode = N` instead
- [ ] #3 JSON output is not truncated when piping to another process (e.g., `| node -e`)
- [ ] #4 Non-zero exit codes still propagate correctly for error cases
- [ ] #5 Tests verify exit code behavior for error paths
<!-- AC:END -->
