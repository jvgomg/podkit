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

## 8. References

- [sync/error-handling](./sync/error-handling.md) — the working example of
  these conventions applied to the sync engine.
- `AGENTS.md` (repo root) — pointers for AI agents working in this repo;
  cross-references the architecture docs.
- `packages/podkit-core/src/index.ts` — the public API surface.
- `packages/demo/src/mock-core.check.ts` — the static export check.
