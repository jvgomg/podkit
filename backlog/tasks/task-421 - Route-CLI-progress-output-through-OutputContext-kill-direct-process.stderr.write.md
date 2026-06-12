---
id: TASK-421
title: >-
  Route CLI progress output through OutputContext (kill direct
  process.stderr.write)
status: Done
assignee: []
created_date: '2026-06-11 15:19'
updated_date: '2026-06-12 07:56'
labels:
  - tech-debt
  - convention
  - cli
dependencies: []
references:
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/output/context.ts
  - packages/podkit-cli/src/output/types.ts
  - documents/architecture/conventions.md
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sibling to TASK-345. Convention fix, not a duplication fix.

## Problem

Convention §2 (`documents/architecture/conventions.md`) bans `console.warn`/`console.log`/direct stderr writes in CLI commands — output must route through `OutputContext` so JSON mode, sink redirection, and test harnesses see a single coherent stream.

Several command files violate this for `\r`-progress writes:

- `packages/podkit-cli/src/commands/doctor.ts:1387,1392,1394,1401,1415,1637,1645,1659` — `runRepair` + `runMassStorageRepair` write `\r ${current} / ${total}  (${pct}%)` and clear with `\r` + spaces directly to `process.stderr`
- Likely siblings in `packages/podkit-cli/src/commands/sync.ts` (verify scope when picking this up)
- Possibly others — grep `process\.stderr\.write` across `packages/podkit-cli/src/commands/`

The naive fix (wrap calls in a helper like `withProgressLine(out, fn)`) papers over the convention violation by hiding the direct stderr write. Don't do that.

## Goal

Add a first-class progress surface to `OutputContext`:

```ts
interface OutputContext {
  // existing...
  /** Emit a progress line — overwrites the current line in TTY text mode, no-op in JSON. */
  progress(line: string): void
  /** Clear the current progress line. Idempotent. */
  clearProgress(): void
}
```

Behaviour:
- Text mode + TTY: `\r${line}` to stderr; on `clearProgress`, write `\r` + spaces to width + `\r`.
- Text mode + non-TTY (CI, file redirect): newline-per-progress, no clear. Or suppress entirely — pick one and pin a test.
- JSON mode: no-op.
- Threads through the sink interface so the buffer-sink test harness can capture progress lines deterministically.

Then sweep `process.stderr.write` callers in `packages/podkit-cli/src/commands/` and route them through the new API. Ban future direct writes via a lint rule or convention doc update.

## Acceptance Criteria
<!-- AC:BEGIN -->
Listed below.
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 OutputContext exposes progress(line) + clearProgress(); behaviour pinned for TTY / non-TTY / JSON modes
- [x] #2 Buffer-sink test harness captures progress writes deterministically
- [x] #3 Direct process.stderr.write calls in packages/podkit-cli/src/commands/ replaced (sweep doctor.ts, sync.ts, anything else surfaced by grep)
- [x] #4 Convention §2 updated (or a new entry filed) banning direct process.stderr.write in commands; optional ESLint rule
- [x] #5 bun run typecheck / bun run test / bun run lint all pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All 5 ACs met.

## Changes

**`packages/podkit-cli/src/output/context.ts`** — new `progress(line)` + `clearProgress()` methods on `OutputContext`:
- TTY text mode: `\r${line}` to stderr sink; tracks max line width seen
- Non-TTY text mode: `${line}\n` to stderr sink (history-preserving for CI logs / piped runs)
- JSON mode: no-op
- `--quiet`: no-op
- `clearProgress`: blanks to the tracked width then resets it; idempotent; no-op when no progress is active or in non-TTY mode

**`packages/podkit-cli/src/output/context.test.ts`** — 14 new tests covering TTY/non-TTY/JSON/quiet modes, overwrite behaviour, clear idempotency, and the sink-capture contract that lets buffer-sink test harnesses assert against progress output deterministically.

**`packages/podkit-cli/src/commands/doctor-repair.ts`** — swept progress writes. `makeProgressHandler` now builds the line without the leading `\r` (helper prepends it in TTY mode) and routes through `out.progress(line)`. Two `clearProgressLine(out, width)` calls collapsed to `out.clearProgress()`. The local `clearProgressLine` helper + `compactProgress`-driven width constant deleted — width tracking lives in `OutputContext`.

**`packages/podkit-cli/src/commands/migrate.ts`** — documented carve-out (interactive readline-coupled prompts that can't easily route through OutputContext because readline takes a writable stream, not an `OutputSink`). Code unchanged; comments added pointing to conventions.md §2a.

**`documents/architecture/conventions.md`** — new §2a "CLI output flows through `OutputContext`" formalises the rule + enumerates four carve-outs (bootstrap diagnostic forwarder in `main.ts`, signal handler in `shutdown.ts` with its existing `_writeStderr` seam, `OutputContext`'s internal spinner writes in `context.ts`, and `migrate.ts` readline-coupled prompts).

**`packages/podkit-cli/src/utils/progress.ts`** — drive-by JSDoc fix: stale `@returns Formatted progress line ready for process.stdout.write()` → `... ready to hand to OutputContext.progress()`.

## Verification

- `bun run typecheck` — clean
- `bun run lint` — 0 warnings, 0 errors (945 files)
- `bun run test --filter podkit --force` — all 16 task packages pass
- Sonnet review: byte-equivalence in TTY mode verified; non-TTY history mode is a deliberate improvement over raw `\r`-overwrites in CI logs; width tracking is strictly safer than the previous fixed-width clear; all four carve-outs accounted for via grep sweep.

## Behaviour notes

- TTY mode: byte-identical to the previous direct `process.stderr.write('\r…')`.
- Non-TTY mode: now writes newline-per-progress instead of leaking `\r` codes into pipes / CI logs. A genuine improvement.
- JSON mode + quiet mode: now correctly suppressed (was leaking progress lines to stderr regardless).
- Test harness: progress writes now route through the configured stderr sink, capturable by `BufferSink`.
<!-- SECTION:FINAL_SUMMARY:END -->
