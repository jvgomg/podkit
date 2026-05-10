---
"podkit": minor
---

Unify and harden CLI JSON error output across every command (ADR-015)

## What changed

Every CLI command now emits the same canonical JSON shape on failure. The shape, exit codes, and consumer ergonomics all changed in one breaking pass.

### Canonical error shape

```json
{
  "success": false,
  "error": "<human-readable message>",
  "code": "<machine-readable tag>",
  "details": { "<command-specific keys>": "..." }
}
```

`code` is required and machine-readable (e.g. `MOUNT_REQUIRES_SUDO`, `FFMPEG_UNAVAILABLE`). `details` is **nested**, not spread at the top level — so command-specific extras can't accidentally collide with `success`/`error`/`code`.

### Exit codes

- `0` — success
- `1` — command error (any `CliError` thrown)
- `2` — ran cleanly but found problems (`doctor` reporting unhealthy device, `sync` reporting partial track failures). Carries a `status` field on the success-shape JSON: `'ok' | 'issues-found' | 'partial-failure'`.
- `130` — SIGINT (interrupted sync)

### Per-command typed error codes

Every command exports an exhaustive enum of its possible error codes:

```ts
import { MountErrorCodes, type MountErrorCode } from 'podkit/commands/mount';
// MountErrorCodes.DEVICE_NOT_RESOLVED, MountErrorCodes.MOUNT_REQUIRES_SUDO, etc.
```

A repo-wide barrel is at `packages/podkit-cli/src/commands/error-codes.ts` exporting `PodkitErrorCode` — the union of every code any podkit command may emit.

### Discriminated `*Output` types

Each command's output type is now a discriminated union:

```ts
export type MountOutput = MountSuccess | MountErrorOutput;
```

Consumers narrow with `if (output.success) { ... }`.

## Breaking for JSON consumers

| Old shape | New shape |
|-----------|-----------|
| `{ error: true, message: "..." }` (collection music/video) | `{ success: false, error, code, details }` |
| `{ success: false, error: "..." }` (no code, top-level extras) | `{ success: false, error, code, details: {...} }` |
| Per-command extras at top level (e.g. `dryRun`, `device`) | Now nested under `details` |
| `process.exitCode === 1` for "found issues" | Now `2`; `1` is reserved for command errors |

Update parsers to:

1. Branch on `success === false`.
2. Read `code` for machine-readable tags.
3. Read `details.X` instead of `output.X` for command-specific extras.
4. Branch on exit code 2 for "ran cleanly with issues" (sync partial failure, doctor unhealthy).

## New ergonomics

`packages/podkit-cli/src/test-utils/cli-error.ts` and `packages/e2e-tests/src/helpers/cli-error.ts` export `expectCliError` for asserting on the canonical shape in one call.

`OutputContext` now takes an optional `ExitCodeSink` (default: writes `process.exitCode`; tests use `BufferExitCodeSink` to avoid process-global mutation).

Per CLI breaking-change convention this is a minor bump.
