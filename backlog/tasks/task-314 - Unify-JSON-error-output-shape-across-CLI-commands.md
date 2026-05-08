---
id: TASK-314
title: Unify JSON error output shape across CLI commands
status: To Do
assignee: []
created_date: '2026-05-08 16:27'
labels:
  - tech-debt
  - cli
  - breaking-change
dependencies: []
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CLI commands currently emit three different JSON error shapes:

- `device add` errors: `{ success: false, error: "..." }`
- `collection music`/`video` errors: `{ error: true, message: "..." }`
- `runAction` (CliError-translated) errors: `{ success: false, error: "...", code: "..." }`

This is visible API surface for JSON consumers — scripts, the daemon, future Vercel/agent integrations, the upcoming Chat SDK bot if any. The shapes diverged organically; there's no good reason for the inconsistency.

## Goal

Single canonical `ErrorOutput` shape used by every command in JSON mode. Strawman:

```ts
interface ErrorOutput {
  success: false;
  error: string;        // human-readable message
  code: string;         // machine-readable tag (e.g. PATH_REQUIRED)
  details?: Record<string, unknown>; // command-specific extras
}
```

This matches the format `runAction` already emits, so the migration is "make every command go through CliError + runAction" rather than "design a new format."

## Scope

- Audit every command's error producer (search for `out.result<...>({ success: false`, `out.stdout(JSON.stringify({ error: true`, `process.exitCode = 1` patterns)
- Migrate each to `throw new CliError({ message, code, details })`
- Wrap each action callback with `runAction(out, () => runX(...))`
- Update `*Output` interfaces in command files to extend `ErrorOutput`
- Tests assert on the new shape (most already do; collection tests still expect `{ error: true, message }`)
- Add a changeset — this is breaking for anyone parsing JSON output

## Why a separate task

Touches every command, requires a changeset (breaking change for `podkit` user-facing JSON output), and benefits from being its own reviewable PR. The test-architecture refactor (refactor/cli-test-architecture branch) laid the foundation: `CliError` and `runAction` exist and the runners are extracted, but the runner bodies still use the legacy patterns.

## References

- packages/podkit-cli/src/errors.ts — `CliError` + `runAction` already implemented
- agents/releases.md — changeset workflow
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every CLI command emits the canonical ErrorOutput shape in JSON mode
- [ ] #2 All action callbacks wrapped with runAction; no command sets process.exitCode directly outside the wrapper
- [ ] #3 Tests assert on { success: false, error, code, ...details }
- [ ] #4 Changeset added describing the JSON output breaking change
- [ ] #5 ADR or note in agents/testing.md documenting the canonical shape
<!-- AC:END -->
