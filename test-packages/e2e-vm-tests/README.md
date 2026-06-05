# @podkit/e2e-vm-tests

End-to-end tests that exercise **podkit features** against the synthesised devices produced by `@podkit/device-testing`. The harness itself (persona registry, system-state registry, the `lima-test-vm` runner, the FunctionFS daemon, the `withPersona` fixture, the `resolveVmAvailability` gate) lives in `@podkit/device-testing`; this package is a pure consumer.

See [ADR-016](../../adr/adr-016-linux-vm-test-harness.md) for the architecture.

## Why a separate package?

`@podkit/device-testing` is a library: it exports fixtures + a runtime that consumers compose to write VM tests. Two kinds of test live against this library:

- **Harness self-tests** — "does the daemon synthesise the persona correctly? does backing-file synthesis stay byte-deterministic?". These stay with the harness in `test-packages/device-testing/src/vm/`.
- **podkit feature tests** — "does `podkit device scan` discover the synthesised iPod? does `doctor` render the right output? does the discovery cache reconcile sanely across daemon restarts?". These live here.

Splitting the two keeps each test's concerns clear: the harness self-tests live next to the code they cover, and this package is purely the "podkit-as-consumer" test surface. Both packages depend on `@podkit/core` (the harness reuses `defaultSubprocessRunner` and the `EnumeratedUsbDevice` type); the asymmetry is that only this package exercises `/usr/local/bin/podkit` inside the VM.

## Running

```bash
# from repo root — runs harness self-tests + this package's feature tests
bun run test:vm

# from this package only
bun run --cwd test-packages/e2e-vm-tests test:vm
```

VM tests are excluded from the default `bun test` run via `bunfig.toml`. They opt in via the `test:vm` script, which passes `src/` explicitly. When Lima is not installed or the `podkit-device-harness` VM instance is missing, `resolveVmAvailability()` returns `false` and every suite skips with a single stderr warning — so this `test:vm` step is safe to leave in default CI.

## Test layout

One `*.e2e.test.ts` file per podkit-feature surface under VM coverage. Each file follows the suite shape documented in [agents/device-testing.md](../../agents/device-testing.md):

1. Call `resolveVmAvailability()` at module top level and stash the boolean.
2. Wrap every `describe` with `describe.skipIf(!vmAvailable)`.
3. Group `it()` blocks under one `describe` per `SystemState` (the runner's `applyState` is the cold-path step — run it once per group, not once per test).
4. Use `withPersona({ persona }, async () => { … })` to manage daemon lifecycle for a persona inside a test.

## Imports

All harness symbols come from `@podkit/device-testing`. Never use relative paths into the harness — that would leak the harness's internal layout into consumer tests.

```ts
import {
  // VM availability + grouping
  resolveVmAvailability,
  groupPersonasByState,
  resolveStarterPersonas,
  // wall-time budgets
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  // persona fixture + JSON-CLI helper
  withPersona,
  runJsonCommand,
  // the Lima-backed TestRuntime
  limaTestVmRunner,
  // personas + system states
  ipodVideo5gIflash1tb,
  echoMini,
  healthy,
} from '@podkit/device-testing';
```
