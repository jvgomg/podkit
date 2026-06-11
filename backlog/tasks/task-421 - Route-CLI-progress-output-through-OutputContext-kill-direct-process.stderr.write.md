---
id: TASK-421
title: >-
  Route CLI progress output through OutputContext (kill direct
  process.stderr.write)
status: To Do
assignee: []
created_date: '2026-06-11 15:19'
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

- [ ] #1 OutputContext exposes progress(line) + clearProgress(); behaviour pinned for TTY / non-TTY / JSON modes
- [ ] #2 Buffer-sink test harness captures progress writes deterministically
- [ ] #3 Direct process.stderr.write calls in packages/podkit-cli/src/commands/ replaced (sweep doctor.ts, sync.ts, anything else surfaced by grep)
- [ ] #4 Convention §2 updated (or a new entry filed) banning direct process.stderr.write in commands; optional ESLint rule
- [ ] #5 bun run typecheck / bun run test / bun run lint all pass
<!-- AC:END -->
