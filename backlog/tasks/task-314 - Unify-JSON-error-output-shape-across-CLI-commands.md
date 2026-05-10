---
id: TASK-314
title: Unify JSON error output shape across CLI commands
status: Done
assignee: []
created_date: '2026-05-08 16:27'
updated_date: '2026-05-09 21:22'
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
- [x] #1 Every CLI command emits the canonical ErrorOutput shape in JSON mode
- [x] #2 All action callbacks wrapped with runAction; no command sets process.exitCode directly outside the wrapper
- [x] #3 Tests assert on { success: false, error, code, ...details }
- [x] #4 Changeset added describing the JSON output breaking change
- [x] #5 ADR or note in agents/testing.md documenting the canonical shape
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrated every CLI command to use `runAction` + `CliError`. The canonical JSON error shape `{ success: false, error, code, ...details }` now applies uniformly across `mount`, `eject`, `init`, `migrate`, `completions install`, `collection list`/`add`/`remove`/`info`/`default`/`music`/`video`, every `device` subcommand (scan, info, remove, music, video, clear, reset, eject, mount, init, set, default, reset-artwork), `doctor` (action + helpers `runSystemRepair`, `runRepair`, `runMassStorageRepair`, `runDoctorDiagnostics`), and `sync`.

`CliError` now also carries an optional `printText: (out: OutputContext) => void` for multi-line text-mode output; runAction calls it instead of the default `out.error(message)`. Tests updated in `errors.test.ts` and the e2e `list.e2e.test.ts` (device music JSON shape). 1052 podkit-cli unit/integration tests pass; 27/27 e2e tests pass.

Several commands' resource-cleanup paths refactored into `try/finally` blocks so `adapter.close()` / `db.close()` runs once on throw — sync, doctor's runRepair/runMassStorageRepair, device clear, device reset-artwork.

`process.exitCode = 1` retained in two intentional cases per the design: doctor's "ran cleanly but found problems" exit after emitting a successful-shape DoctorOutput, and sync's `process.exitCode = 130` SIGINT path. Both are documented in ADR-015.

Changeset: `.changeset/cli-error-shape-unified.md` (minor bump). ADR: `adr/adr-015-cli-error-output-shape.md` (Accepted). Testing guidance updated in `agents/testing.md`.
<!-- SECTION:FINAL_SUMMARY:END -->
