---
title: Dev Builds
description: How podkit ships a production binary with zero test scaffold while keeping a side-by-side debug binary that exposes deterministic test seams — the compile-time-stripped `__PODKIT_DEV_HOOKS__` pattern, the `devPause(key)` primitive, and the e2e wiring that opts into it.
sidebar:
  order: 3
---

How podkit keeps test scaffold out of the production binary while still
giving e2e tests deterministic pause points. The pattern: a single
compile-time boolean (`__PODKIT_DEV_HOOKS__`) gates every hook surface;
the production build defines it `false` so the bundler tree-shakes every
hook body away; a parallel debug build defines it `true` and emits
`bin/podkit-debug` alongside `bin/podkit`.

Cross-cutting rules (typed errors, no `console.warn` in core,
sink-not-stderr, test seams live behind `__PODKIT_DEV_HOOKS__`) live in
[conventions](./conventions.md).

---

## 1. Purpose

E2E tests sometimes need to pause the CLI at a known internal state —
e.g. after a `.podkit-tmp` file lands on disk but *before* the surround-
ing `rename` completes — and SIGKILL it there, so the next sync's
pre-sweep can observe whatever debris the kill leaves behind. Polling
from the outside for these microsecond windows is inherently flaky.

A pause primitive in `podkit-core` is the cleanest fix, but adding one
naively pollutes the production binary with test scaffold no end user
should ever execute. The dev-build pattern resolves the tension:

- **Source** has the hook (e.g. `devPause(key)`) — typed, exported,
  callable.
- **Production build** defines `__PODKIT_DEV_HOOKS__=false` → the
  bundler folds the ternary, the hook body and its env-var name vanish,
  the production binary has zero footprint.
- **Debug build** defines `__PODKIT_DEV_HOOKS__=true` → the hook body
  survives, the test can drive it.

First consumer: the SIGKILL round-trip e2e for the pre-sync sweep.
Future consumers add new hooks behind the same compile-time gate.

---

## 2. Pattern

### 2.1 The compile-time flag

```ts
declare const __PODKIT_DEV_HOOKS__: boolean;
```

A bare TypeScript declaration. The bundler is responsible for actually
defining it at build time via `--define '__PODKIT_DEV_HOOKS__=<value>'`.

### 2.2 The primitive

`packages/podkit-core/src/dev/hooks.ts`:

```ts
export const devPause: (key: string) => Promise<void> =
  typeof __PODKIT_DEV_HOOKS__ !== 'undefined' && __PODKIT_DEV_HOOKS__
    ? async (key) => {
        if (process.env.PODKIT_DEV_PAUSE_KEY === key) {
          await new Promise<void>(() => {});
        }
      }
    : async () => {};
```

Three properties this shape buys:

1. **Production stripping.** With `--define __PODKIT_DEV_HOOKS__=false`
   the bundler substitutes the literal, folds the `typeof … && false`
   guard to `false`, collapses the ternary, and tree-shakes the active
   branch. Zero references to `PODKIT_DEV_PAUSE_KEY` or the active
   arrow survive in `dist/main.js` or `bin/podkit`.
2. **Debug activation.** With `--define __PODKIT_DEV_HOOKS__=true` the
   bundler folds to the active branch; `bin/podkit-debug` carries the
   hook body.
3. **Source-runtime safety.** When the source is loaded raw (`bun -e`,
   `bun test` against the unbundled module) the `__PODKIT_DEV_HOOKS__`
   symbol is undefined. The `typeof` guard short-circuits to the no-op
   branch — no `ReferenceError`. This is load-bearing for the
   cross-process tests in `src/lib/sync-lock-path.test.ts`, which spawn
   `bun -e` children that `import('@podkit/core')` directly.

The guard expression **must stay inline in the ternary condition**.
Hoisting it to a `const HOOKS_ACTIVE = …` defeats the bundler's
constant-folding (folding stops at statement boundaries), and the
active branch survives in the production bundle. The smoke test in
§7 catches the regression if anyone tries.

### 2.3 The test pattern

There is **no resume**. The test arranges observable state (e.g. waits
for a `.podkit-tmp` file to land), then SIGKILLs the paused process.
A consumer that wants resume semantics extends the primitive then
(e.g. a SIGUSR1-driven release); none of the current consumers need it.

```text
test                                          podkit-debug
 │                                                │
 ├─ spawn('bin/podkit-debug', [..., 'sync'],     │
 │         { env: { PODKIT_DEV_PAUSE_KEY:        │
 │                  'pre-sweep:after-rename' } })│
 │                                                ├─ sync starts
 │                                                ├─ pre-sweep stage
 │                                                ├─ creates .podkit-tmp
 ├─ await fs.access('.podkit-tmp')               ├─ devPause('pre-sweep:after-rename')
 ├─ child.kill('SIGKILL')                         │   └─ awaits forever
 └─ run next assertions on disk state             ×
```

---

## 3. Boundaries

`__PODKIT_DEV_HOOKS__` is for **test seams and dev observability ONLY**.
It is never to be used for:

- **Feature flags.** New features ship to all users or not at all.
- **Production toggles** (debug logging in prod, performance modes,
  experimental codepaths). Those go through config, not compile flags.
- **Billing / licensing gates.** Out of scope for podkit, but worth
  saying: this surface is not a security boundary. The debug binary
  exists and is buildable; assume nothing is hidden.
- **A/B tests / cohort gates.**
- **Anything user-facing.** If users can perceive the difference, it
  belongs in config.

Anyone tempted to use a hook for runtime configuration: stop and use a
config flag (see `packages/podkit-cli/src/config/`). The hook surface
is intentionally narrow so we don't end up with two parallel ways to
toggle behaviour.

The hook body can read any env var the test wants to pass — it lives
inside the active branch and only exists in the debug binary, so the
production attack surface is unchanged.

---

## 4. Build pipeline

### 4.1 The two binaries

| Output                  | Built by                  | Hook flag                       |
|-------------------------|---------------------------|---------------------------------|
| `bin/podkit`            | `bun run compile`         | `__PODKIT_DEV_HOOKS__=false`    |
| `bin/podkit-debug`      | `bun run compile:debug`   | `__PODKIT_DEV_HOOKS__=true`     |
| `dist/main.js` (dev)    | `bun run build`           | `__PODKIT_DEV_HOOKS__=false`    |

`compile.sh` is parameterised by the `PODKIT_DEV_HOOKS` env var:
`PODKIT_DEV_HOOKS=1` selects the debug build (`true` define, output
`bin/podkit-debug`); anything else gives the production build (`false`
define, output `bin/podkit`). The `compile:debug` npm script sets the
env var; the `compile` script doesn't.

`bun build --define '__PODKIT_DEV_HOOKS__=<bool>'` substitutes the
literal value before parsing, so the original identifier never appears
in the bundled output even on the active path.

### 4.2 Turbo tasks

Both tasks live at the root of `turbo.json`. They share the same
`^build` dependency and the same input set, but differ in:

- **Output path.** `compile` → `bin/podkit`; `compile:debug` →
  `bin/podkit-debug`. Different paths mean different cache keys, so the
  two tasks never collide.
- **Env input.** `compile:debug` declares `env: ["PODKIT_DEV_HOOKS"]`
  so flipping it busts the cache the way you'd expect.

`compile`'s output narrowed from `bin/**` to `bin/podkit` so it doesn't
claim ownership of cross-compiled Linux binaries (those belong to
`@podkit/device-testing#build:linux-binary` which produces
`bin/podkit-linux-*`).

### 4.3 E2E task wiring

`@podkit/e2e-tests#test:e2e`, `@podkit/e2e-tests#test:e2e:docker`, and
`@podkit/e2e-vm-tests#test:vm` declare `podkit#compile` AND
`podkit#compile:debug` as `dependsOn`, so both binaries exist before
any e2e test starts. Most tests use the production binary (the
default); the few that need test seams opt in (§5).

---

## 5. E2E wiring

The CLI runner in `test-packages/e2e-shared/src/cli-runner.ts` accepts
a `binary` option:

```ts
export type CliBinary = 'production' | 'debug';

interface CliOptions {
  // … other fields …
  binary?: CliBinary; // default: 'production'
}
```

- **`'production'` (default)** invokes `bun packages/podkit-cli/dist/main.js`
  (the bundle is built `bun build --target bun`). Same `--define` flags as
  the compiled binary, so it tree-shakes hook bodies the same way. Use this
  for everything by default — it's the fast e2e proxy. Note (ADR-021): the
  *user-shipped* artefact is the Bun `--compile` binary (`bin/podkit`), not
  this bundle; `dist/main.js` is an internal e2e-only artefact. Both run
  under the Bun runtime, so the proxy is faithful (`bun:sqlite` and other
  Bun built-ins resolve identically).
- **`'debug'`** invokes `packages/podkit-cli/bin/podkit-debug` directly
  (no `node` wrapper — it's a self-contained `bun build --compile`
  binary). Use this only when the test needs `devPause` or a future
  hook.

When a test opts into `'debug'`, it should:

1. Pass `env: { PODKIT_DEV_PAUSE_KEY: '<key>' }` matching the
   `devPause(key)` call site it wants to stop at.
2. Watch for the surrounding state that confirms the pause was
   reached (a file on disk, a log line, a port open) before issuing
   the SIGKILL.
3. SIGKILL — never SIGINT, never SIGTERM. The whole point of the
   pattern is to crash the process at a specific in-flight state; a
   graceful signal defeats the purpose.

The default-`'production'` design means existing tests don't change.
New tests cannot accidentally adopt the debug binary; they have to
spell it out.

---

## 6. Adding a new hook

Recipe:

1. **Add the primitive** to `packages/podkit-core/src/dev/hooks.ts`,
   following the same shape as `devPause`: a typed `const`
   initialiser, inline `typeof __PODKIT_DEV_HOOKS__ !== 'undefined' &&
   __PODKIT_DEV_HOOKS__` guard, active branch and no-op branch as
   separate arrows. Do not hoist the guard.
2. **Export it from `packages/podkit-core/src/index.ts`.** Public-API
   conventions apply (§5 of `conventions.md` — update
   `packages/demo/src/mock-core.ts` with a no-op stub).
3. **Document the env-var or signal contract** in this file. Add a
   row to the table in §5 if it's e2e-facing, or describe the call
   pattern in a new section if it's something else (a profiling hook,
   a stack-trace dump trigger, etc.).
4. **Update the smoke test** if the new hook introduces new sentinel
   strings. Add the string to `FORBIDDEN_SUBSTRINGS` in
   `packages/podkit-cli/src/dev-hooks-strip.test.ts`. The test should
   keep failing on any leak.
5. **Update the e2e helper** if tests need new ergonomics (e.g. a
   helper that watches for the state-confirmed marker and SIGKILLs
   for you). Default to making the test write the marker-watch + kill
   inline; only generalise once two consumers exist.

Checklist before merging:

- [ ] New primitive uses the inline `typeof` guard, not a hoisted
      `const`.
- [ ] Public export added to `index.ts` + `mock-core.ts`.
- [ ] Smoke-test substring list updated if needed.
- [ ] Architecture doc updated in the same PR.
- [ ] No code reference to a task or backlog ID — those live in
      `backlog/tasks/`, not in source.

---

## 7. Production guarantees

The production-cleanliness smoke test lives at
`packages/podkit-cli/src/dev-hooks-strip.test.ts`. It checks two
artefacts:

1. **`dist/main.js`** (the bundled CLI) — must not contain any string
   in `FORBIDDEN_SUBSTRINGS`. Always runs.
2. **`bin/podkit`** (the compiled binary) — same check. Skipped when
   the binary isn't present (so unit-test runs don't have to build it),
   but always runs in CI / when the binary is available.

The substring list:

```ts
const FORBIDDEN_SUBSTRINGS = ['__PODKIT_DEV_HOOKS__', 'PODKIT_DEV_PAUSE_KEY'];
```

Extending the test for a new hook is one string at a time: add the
hook's distinctive sentinel (an env-var name, a magic header, a
literal marker) to the array. The test reads the artefact as raw
bytes and looks for ASCII substrings — works for both the JS bundle
and the compiled binary.

What this catches:

- A new `--define` flag missed in `compile.sh` or `package.json`'s
  `build` script.
- A hook authored without the inline guard (the active branch
  survives in the bundle).
- A hook accidentally referenced from a code path the bundler can't
  tree-shake (e.g. a dynamic `eval`, a `require()` through a string
  variable).

What it does NOT catch:

- A hook whose body uses generic strings already present in core
  (`'sync'`, `'plan'`, etc.). Sentinel names need to be distinctive
  enough that the smoke test is meaningful — `PODKIT_DEV_PAUSE_KEY`
  is unique to this surface.
- A hook that pulls test scaffold into the binary via a transitive
  import from a non-hook file. The hook itself is the discipline;
  routing other code through it doesn't make it dev-only.

---

## 8. Open work

- **Resume semantics.** None today. A future consumer that needs
  resume can extend `devPause` (or add a sibling primitive) to listen
  on a UNIX signal — SIGUSR1 is the obvious choice. Don't add this
  speculatively; wait for the first consumer.
- **Multiple concurrent pause keys.** Today `PODKIT_DEV_PAUSE_KEY` is
  a single string read once per process. A consumer that wants to
  pause at two points in the same run would need a richer dispatch
  (comma-separated keys, a JSON manifest, etc.). Same YAGNI rationale:
  add when the second consumer arrives.
- **Linux debug binary for VM tests.** `@podkit/e2e-vm-tests#test:vm`
  depends on `podkit#compile:debug`, but the in-VM binary is built by
  `@podkit/device-testing#build:linux-binary` which runs the
  production-mode `compile.sh` inside Lima. If a VM e2e ever needs
  the hook, add a `build:linux-binary:debug` companion task that
  passes `PODKIT_DEV_HOOKS=1` through to the in-VM build.
- **Smoke test for the debug binary.** Today the smoke test only
  pins the production side (the strings must be absent). A symmetric
  test (the strings must be present in `bin/podkit-debug`) would
  catch a build-mode regression in `compile:debug`. Worth adding
  once the first hook consumer lands and we know what positive
  signal to assert on.

---

## 9. References

- `packages/podkit-core/src/dev/hooks.ts` — the `devPause` primitive.
- `packages/podkit-core/src/index.ts` — public-API export.
- `packages/podkit-cli/scripts/compile.sh` — env-driven build script.
- `packages/podkit-cli/package.json` — `compile` / `compile:debug`
  scripts and the `__PODKIT_DEV_HOOKS__=false` flag on the dev `build`.
- `packages/podkit-cli/src/dev-hooks-strip.test.ts` — the
  production-cleanliness smoke test.
- `test-packages/e2e-shared/src/cli-runner.ts` — `CliOptions.binary`
  selector.
- `turbo.json` — `compile` / `compile:debug` task definitions plus
  e2e `dependsOn` wiring.
- [conventions §test seams](./conventions.md) — cross-reference back.
