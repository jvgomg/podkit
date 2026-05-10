---
title: "ADR-015: CLI Error Output Shape"
description: Canonical JSON error shape across all podkit CLI commands, enforced by CliError + runAction.
sidebar:
  order: 16
---

# ADR-015: CLI Error Output Shape

## Status

**Accepted** (2026-05-09)

## Context

The podkit CLI emits structured JSON output when invoked with `--json` (or for commands that always emit JSON). Before this decision, error responses had three distinct shapes that grew organically:

- `device add` errors: `{ "success": false, "error": "..." }`
- `collection music` / `collection video` errors: `{ "error": true, "message": "..." }`
- `runAction`-translated errors (a partial unification done earlier): `{ "success": false, "error": "...", "code": "..." }`

The inconsistency was visible API surface for any consumer that parses CLI output: scripts, the daemon, future Vercel/agent integrations, the upcoming Chat SDK bot, and CI tooling. There was no good reason for the divergence.

The implementation was also fragmented. Each command had its own ad-hoc error path: build a JSON object, call `out.result(...)`, manually set `process.exitCode = 1`, manually return. Resource cleanup (e.g. `adapter.close()`, `db.close()`) was duplicated at every error site.

## Decision

Every CLI command's `.action()` callback wraps its body in `runAction(out, () => fn())`. Inside, error paths throw a `CliError`. The wrapper translates that to a single canonical JSON shape and exit code mapping.

### Canonical shape

```json
{
  "success": false,
  "error": "<human-readable message>",
  "code": "<machine-readable tag>",
  "...": "<command-specific details>"
}
```

`code` is a SCREAMING_SNAKE_CASE machine tag like `DEVICE_NOT_RESOLVED`, `MOUNT_REQUIRES_SUDO`, `FFMPEG_UNAVAILABLE`. `details` (an arbitrary record) merges into the top-level object so consumers don't need to drill into a nested object for common per-command extras (e.g. `device`, `dryRun`, `assessment`).

### Implementation

Two primitives in `packages/podkit-cli/src/errors.ts`:

```typescript
export class CliError extends Error {
  readonly code?: string;
  readonly exitCode: number;          // default 1
  readonly details?: Record<string, unknown>;
  readonly printText?: (out: OutputContext) => void;
}

export async function runAction<T>(out: OutputContext, fn: () => Promise<T>): Promise<T | undefined>;
```

`runAction`:

1. Calls `fn()`. If it returns, `runAction` returns its value.
2. If `fn()` throws a `CliError`:
   - JSON mode: emits `{ success: false, error, code, ...details }` to stdout
   - Text mode: calls `err.printText(out)` if present, otherwise `out.error(err.message)`
   - Sets `process.exitCode = err.exitCode` (default 1)
3. If `fn()` throws anything else, the exception propagates — those are bugs and should surface as stack traces.

### Multi-line text output

For text-mode errors that need more than a single line (guidance, links, fix commands), the `CliError` payload accepts a `printText: (out: OutputContext) => void` callback. The JSON-mode payload is unaffected; text-mode renders the callback instead of the default `out.error(message)`. This avoids spreading text-rendering logic across both code paths.

### Exit codes

| Code | Meaning | Source |
|------|---------|--------|
| 0 | Success | runner returned cleanly |
| 1 | Command error | `CliError` thrown via `runAction` |
| 2 | Ran cleanly, found/produced issues | post-emission `process.exitCode = 2` |
| 130 | SIGINT (user interrupt) | `process.exitCode = 130` in sync's signal path |

Exit 2 distinguishes "the command did its job and the result was bad news" from "the command itself failed." `doctor` returns 2 when the device has unhealthy checks. `sync` returns 2 when it ran but some items failed to transcode/transfer. Both still emit a successful-shape JSON output (`success: true, status: 'issues-found' | 'partial-failure'`) — the JSON carries the detail; the exit code lets shell pipelines branch.

Exit 130 is the conventional SIGINT exit. Sync sets it after saving the database when interrupted mid-run.

### `process.exitCode` discipline

Action callbacks don't set `process.exitCode` directly for error cases — those flow through `CliError` and `runAction`. They MAY set it to 2 (post-emission, success-shape) or 130 (SIGINT). Anything else is a violation.

### Status field

The success-shape JSON for `doctor` and `sync` carries a `status` field:

```ts
type DoctorStatus = 'ok' | 'issues-found';
type SyncStatus = 'ok' | 'partial-failure';
```

JSON consumers should branch on `status` rather than the exit code when both are available.

## Consequences

### Positive

- **Single shape across the CLI.** Every consumer can parse with the same pattern.
- **`code` field** lets scripts branch on machine-readable tags without parsing English error messages.
- **`details`** carries useful context (device path, exit-code phase, dry-run flag) consistently.
- **Resource cleanup** lives in `try/finally` blocks rather than at every error site. Several commands (`sync`, `doctor`'s `runRepair`, `device reset-artwork`) collapsed multiple error sites that each had to repeat `adapter.close()` / `db.close()`.
- **Tests assert on captured JSON**, not `process.exitCode` side effects. This unblocks future `it.concurrent` parallelism within test files.

### Negative

- **Breaking change for JSON consumers.** Anyone parsing `{ error: true, message }` from `collection music`/`video` must update. Anyone reading `device add` errors gets a new `code` field (additive). Released as a `minor` bump per the project's CLI breaking-change convention.
- **`printText` callback is a new concept** for contributors. Documented in `agents/testing.md`.

## Related Decisions

- This ADR is the unification target for backlog task TASK-314.
- A precedent migration of `device add` and `collection music`/`video` was released earlier; see `.changeset/cli-error-shape-collection.md`.

## References

- `packages/podkit-cli/src/errors.ts` — `CliError`, `runAction`, the test suite at `errors.test.ts`
- `agents/testing.md` — "Canonical error output shape" section
- Prior partial migration: `.changeset/cli-error-shape-collection.md`
