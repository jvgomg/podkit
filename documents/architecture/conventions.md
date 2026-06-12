---
title: Conventions
description: Cross-cutting rules that apply across every podkit subsystem — typed errors, warning sinks, no console writes in core, and the boundaries that make the codebase navigable.
sidebar:
  order: 2
---

Cross-cutting rules that apply across every podkit subsystem. Per-subsystem
docs describe their own primitives and boundaries; the rules below apply
regardless of which subsystem you're touching.

When a convention here conflicts with code you're reading, the code is
wrong, not this doc — but check whether the convention has been
deliberately updated first (git log on this file).

---

## 1. Errors and warnings have two channels — nothing else

The only two ways non-success information moves through podkit:

- **Thrown error**, extending `CategorizedSyncError` (or `IpodError`, `CliError`
  in their respective layers). Caught by the executor / CLI runtime, turned
  into a categorized error in `ExecuteResult` / a CLI exit code.
- **Emitted warning**, pushed into a `WarningSink`. Accumulated into
  `ExecuteResult.warnings` and surfaced via `SyncOutput.warnings`.

There is no third "silent log to stderr" path. If a behavior matters to
the user or to a JSON consumer, it goes through one of those two channels.

Full responsibility model: [sync/error-handling](./sync/error-handling.md).

---

## 2. No `console.warn` / `console.error` / `console.log` in `packages/podkit-core/src/`

Core is a library. Library code does not own a TTY. Anything emitted from
core must be:

- A thrown error (typed, see §1), or
- A warning emitted through a `WarningSink`, or
- A progress event yielded from an async generator.

Never `console.*`. The CLI consumes the structured output and decides what
to render. `--json` consumers must see *every* signal that text-mode users
see — that only works if there's one output path.

`packages/podkit-cli/` and other end-user packages may use `console.*` via
the CLI's `OutputContext`, but core may not.

### 2a. CLI output flows through `OutputContext`

Inside `packages/podkit-cli/src/commands/`, every text/JSON write goes
through the command's `OutputContext` — `out.print`, `out.error`,
`out.warn`, `out.success`, `out.result`, `out.progress`, `out.clearProgress`,
etc. Direct `process.stdout.write` / `process.stderr.write` from a command
file is a convention violation: it bypasses JSON-mode no-op, `--quiet`
suppression, the buffer-sink test harness, and the TTY/non-TTY progress
switch.

For `\r`-progress lines specifically, use `out.progress(line)` +
`out.clearProgress()`. The helper handles the TTY (`\r`-overwrite) vs.
non-TTY (newline history) split, no-ops cleanly in JSON / quiet modes,
and threads through the configured stderr sink so tests can assert
against captured progress output.

**Carve-outs** (intentional direct `process.stderr.write`):

- `packages/podkit-cli/src/main.ts` — bootstrap-time diagnostic forwarder
  registered before any command's `OutputContext` exists.
- `packages/podkit-cli/src/shutdown.ts` — signal-handler write with an
  explicit `_writeStderr` test seam.
- `packages/podkit-cli/src/commands/migrate.ts` — interactive flow whose
  prompt copy is paired with `readline`, which binds to a writable
  `process.stderr` directly (not an `OutputSink`).

Every other direct stderr write in `packages/podkit-cli/src/commands/`
should route through `OutputContext`. Any new carve-out lands here with
its reason, not silently.

**Enforcement.** `scripts/check-cli-stderr-writes.mjs` greps the CLI
command tree for `process.stdout.write` / `process.stderr.write` and
fails (exit 1) on any match outside its `ALLOW` set. The check runs as
part of `bun run lint` (and standalone via `bun run lint:conventions`).
A new carve-out must be added to BOTH this section AND the script's
`ALLOW` set.

---

## 3. Typed errors carry their category — no string matching

Errors thrown out of sync code extend `CategorizedSyncError` and declare
`readonly category: ErrorCategory` on the class. The categorizer (in
`packages/podkit-core/src/sync/engine/error-handling.ts`) reads
`error.category` directly.

There is no message-keyword inspection. A throw site that wants a specific
retry policy must throw a typed error, full stop. See [sync/error-handling §2](./sync/error-handling.md#2-hard-failures--categorizedsyncerror)
for the existing subclass hierarchy + how to add a new one.

---

## 4. Adapters never reach into their callers

Adapters (device adapters in `device/`, collection adapters in `adapters/`)
emit signals through the contracts the caller provides: throw typed errors,
emit warnings via the injected sink. They never:

- Call back into the pipeline directly
- Hold a reference to a "logger" they pulled from a module-level singleton
- Mutate caller-owned state

This keeps adapters testable in isolation and keeps the contract surface
visible at the interface definition (`DeviceAdapter`, `CollectionAdapter`).

---

## 5. Public type exports are intentional

Anything exported from `packages/podkit-core/src/index.ts` is a public API
surface. Other packages (`podkit-cli`, `podkit-daemon`, `@podkit/demo`)
depend on it, including external consumers eventually. When you add or
change a public type:

- Update `packages/demo/src/mock-core.ts` to match. There's a static check
  (`packages/demo/src/mock-core.check.ts`) that ensures every public export
  has a mock equivalent — if you skip the mock update, typecheck fails.
- For breaking changes, add a changeset (`bunx changeset`). Per
  [feedback_minor_breaking_changes], CLI/API breaking changes use minor
  bumps; only the binary release version is held back.

---

## 6. Tests pin contracts, not implementation

Tests assert the *behavior* a future contributor must preserve, not the
specific code path that produces it. A test that says "calls `foo` then
`bar` then `baz`" pins implementation; a test that says "produces an
`X` with `y === 1`" pins contract.

When a refactor changes the implementation but not the contract, the test
should not need updates. When a refactor changes the contract (this
happens — see the picture-write normalization in TASK-381), the test
should be intentionally rewritten to pin the new contract, not
"adjusted to pass."

See [feedback_test_quality_visible_bugs] for the deferred-bug
visibility rules.

---

## 7. Documentation lives in three places, not one

| Type                  | Lives in                       | Lifecycle                                  |
|-----------------------|--------------------------------|--------------------------------------------|
| **Architecture docs** | `documents/architecture/`      | Slow-moving settled conventions.           |
| **Doc-NNN journals**  | `backlog/docs/doc-NNN-*.md`    | Living rough-edges + open question logs.   |
| **ADRs**              | `adr/adr-NNN-*.md`             | Frozen-at-decision-time, status evolves.   |

Update the architecture doc when a convention becomes settled. Keep
journals (doc-NNN) as the working catalogue of what's still smelly. Don't
duplicate content across them — link instead.

User-facing docs (the Starlight site under `docs/`) are a separate
audience: install instructions, troubleshooting, config reference. Don't
mix architecture (for contributors) with user-facing (for users).

---

## 8. Test seams live behind compile-time hooks

When a test needs to drive an internal state the production code path
doesn't expose (e.g. pause mid-rename, dump a stack trace at a
specific point), the seam goes behind the `__PODKIT_DEV_HOOKS__`
compile-time flag — never as an env-var sniff on the production code
path. The production binary then strips the seam entirely via bundler
tree-shaking; a parallel debug binary carries it.

Full pattern, build pipeline, e2e wiring, and the recipe for adding a
new hook: [dev-builds](./dev-builds.md).

The discipline matters because the alternative — env-var sniffing in
production code — leaks test scaffold into the shipping binary and
opens the door to "production override" anti-patterns (debug logging
flags, experimental codepaths) that nobody ever cleans up.

---

## 9. Doctor check IDs are referenced through the registry, not strings

Diagnostic check IDs (`orphan-files`, `debris-files-mass-storage`, etc.) live
in two surfaces: the **public --repair IDs** that the CLI advertises
(`PUBLIC_REPAIR_IDS` in `packages/podkit-core/src/diagnostics/repair-dispatch.ts`),
and the **internal check IDs** that the registry dispatches to per device
type. Most checks share the same string for both surfaces; the unified
IDs (`orphan-files`, `debris-files`) deliberately diverge so iPod and
mass-storage variants can carry different walkers and repair requirements.

When code or tests need to query a doctor report by check ID:

- **CLI rendering / repair dispatch:** look up via `getDiagnosticCheck(id)` or
  `getRepairCheck(publicId, deviceType)`. Never hardcode a single internal
  ID for behaviour that should apply to both device-type variants (the CSV
  export drift in `doctor.ts` only matched `'orphan-files'` and silently
  dropped mass-storage orphans — fixed by funneling through
  `emitOrphanCsv()` which checks both variants).
- **E2E matrix helpers:** when a helper queries `report.checks.find((c) => c.id === ...)`,
  add a fallback for the device-type variant or look up through the
  registry. `doctorSeesPodkitTmp` in
  `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` is the
  reference shape: try the mass-storage ID first, fall back to the iPod ID.
- **Drift guards:** the registry-completeness test in
  `packages/podkit-core/src/diagnostics/checks/scope-matrix.test.ts`
  fails when a new check ID lands without a scope/applicableTo pin.
  `packages/podkit-cli/src/commands/doctor.test.ts` pins the CLI's
  `--repair` commander choices against `PUBLIC_REPAIR_IDS`. Treat both as
  load-bearing — extend them when you add a new check, don't disable.

The string is not the contract; the registry is. Helpers that hardcode a
single ID become drift surfaces the next time a check is split or
renamed (as happened with TASK-397's `orphan-files-mass-storage` →
`debris-files-mass-storage` extraction).

---

## 10. Doctor's non-repair path is read-only

`podkit doctor` (without `--repair`) MUST NOT mutate the device. This is
enforced by design: the non-repair path never calls `db.save()`, so
`IpodDatabase.open()` → `itdb_parse()` (read-only) and `close()` →
`itdb_free()` (in-memory only) leave on-device files unchanged.

**Artwork check status is deterministic:**

The `artwork-rebuild` check routes through these gates in order:

1. No ArtworkDB file → `existsSync` gate → `'skip'`
2. 0-byte ArtworkDB → `buffer.length === 0` guard → `'skip'`
3. Non-empty ArtworkDB that fails to parse → `parseArtworkDB` throws → `'warn'`
4. Non-empty ArtworkDB with 0 images → `parseArtworkDB` + `db.images.length === 0` → `'pass'`
5. Non-empty ArtworkDB with valid entries → all-offsets-valid → `'pass'`
6. Non-empty ArtworkDB with out-of-bounds entries → `'fail'`

Each input scenario has exactly one deterministic output. There is no
"libgpod may rewrite" race — empirically confirmed: the SHA-256 fingerprint
of the ArtworkDB is identical before and after a `podkit doctor` run.

Note: the default test iPod fixture (model MA147 via `createTestIpod`) ships
with a valid-but-empty ArtworkDB (944-byte `mhfd` header, 0 entries), so the
`'reports healthy for iPod with no artwork'` test expects `'pass'`, not `'skip'`.
The `'skip'` path is exercised by a separate test that truncates the file to 0 bytes.

The hash-stability tests in `test-packages/e2e-tests/src/commands/doctor.test.ts`
(`'doctor read-only contract (ArtworkDB hash stability)'`) enforce this at the
binary level: capture SHA-256 before and after a run, assert no change.

**Repair path is the only writer.** `--repair <check-id>` calls `db.save()`
explicitly and acquires the per-device write lock before doing so. Any future
doctor check or diagnostic helper that needs to write device state MUST go
through `--repair`, not the diagnostic path.

---

## 11. References

- [sync/error-handling](./sync/error-handling.md) — the working example of
  these conventions applied to the sync engine.
- [dev-builds](./dev-builds.md) — compile-time-stripped test seams.
- `AGENTS.md` (repo root) — pointers for AI agents working in this repo;
  cross-references the architecture docs.
- `packages/podkit-core/src/index.ts` — the public API surface.
- `packages/demo/src/mock-core.check.ts` — the static export check.
