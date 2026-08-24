# Testing

Detailed testing guidance for agents working in this repository. See [AGENTS.md](../AGENTS.md) for project overview.

Also see [docs/developers/testing.md](../docs/developers/testing.md) for full testing strategy and conventions.

## Quick Reference

Tests are classified by **Depth** (encoded in the filename suffix); E2E tests are additionally classified by **Surface** (encoded in the directory). Each Depth has a turbo task, a `bunfig.toml` `pathIgnorePatterns` gate, and a default position in the dev loop. See the canonical [test taxonomy](../documents/architecture/testing/taxonomy.md) for the full Depth × Surface model and [Test depths and pathIgnorePatterns](#test-depths-and-pathignorepatterns) below for the wiring.

| Suffix | Depth | Runs by default? | Requirements |
| --- | --- | --- | --- |
| `*.test.ts` | **Unit** — fast, in-process, no external deps. | Yes, in `bun test` / `test:unit`. | None. |
| `*.integration.test.ts` | **Integration** — real system deps (ffmpeg, gpod-tool, libgpod-node native bindings, fixtures). | No — gated. Run via `test:integration`. | Whatever the test declares at module load via `requireFFmpeg()` &c. |
| `*.perf.test.ts` | **Performance benchmark** — timing-sensitive, generates synthetic load. (A modifier on Unit/Integration, not a depth of its own.) | No — gated. Run via `test:perf`. | Same as integration. |
| `*.e2e.test.ts` (in `e2e-*` packages) | **End-to-end** — spawns the built CLI/image as a black box. Surface is the directory (default surface at package root; non-default surfaces in subdirs). | No — separate task. Run via `test:e2e` / `test:e2e:docker` / `test:vm`. | Built CLI/image + surface-specific deps. |

**Hard rule:** integration / perf / e2e tests that depend on a tool or fixture call `requireX()` / `ensureFixturesExist()` at module load. Missing deps fail the suite loudly, not silently. See [Module-load preflight](#module-load-preflight) and [Test skip anti-patterns](#test-skip-anti-patterns).

## Per-OS Test Tagging

Some tests exercise native subprocess paths that differ per OS — for example, `system_profiler` (macOS) vs `lsblk` (Linux). Running darwin tests on linux (or vice versa) would always fail meaninglessly, so we tag those files by OS.

### Filename patterns

| Pattern | Runs on |
|---------|---------|
| `*.test.ts` | Any OS (default) |
| `*.darwin.test.ts` | macOS only (`process.platform === 'darwin'`) |
| `*.linux.test.ts` | Linux only (`process.platform === 'linux'`) |

The filename is a human-readable signal — it lets you scan the test suite and immediately see which files are OS-specific. The actual guard is a `describe.skipIf` at the top level of each file.

### Standard pattern

```ts
// foo.darwin.test.ts
import { describe, it, expect } from 'bun:test';

const isDarwin = process.platform === 'darwin';
if (!isDarwin) console.log(`Skipping foo.darwin.test.ts on ${process.platform}`);

describe.skipIf(!isDarwin)('foo (darwin)', () => {
  it('does the thing', () => { /* ... */ });
});
```

Key points:

- Use **`describe.skipIf`** (whole-block skip), not `it.skipIf` (per-test skip). A tagged file contains only OS-specific tests; skipping the whole block is cleaner and the intent is clearer.
- The `console.log` at **module load** (outside `describe`) fires regardless of whether the block runs. This is what makes the skip visible in CI output — a `(skip)` annotation on an `it` is easy to miss; a log line printed unconditionally is not.
- No shared helper. Each tagged file stands alone. This avoids coupling every package to a single utility module.

### Rationale

Host-tagged native integration tests (TASK-321 / ADR-016) call OS-specific subprocesses. On a Linux CI runner, spawning `system_profiler SPUSBDataType` will simply fail — there is nothing useful to assert. Tagging files by OS makes the skip intentional and visible rather than silent. The filename convention also makes it trivial to grep for all darwin-specific tests across the monorepo (`git grep -l '\.darwin\.test\.ts'`).

## Device Test Stack

The device-identification, doctor, and readiness pipelines are covered by three qualitatively different test levels. See [ADR-016](../adr/adr-016-linux-vm-test-harness.md) for the full design rationale and [agents/device-testing.md](device-testing.md) for the harness reference.

### Unit tests with injectable fakes

Pure TypeScript tests. Always run on every host. No subprocesses, no VMs, no special permissions.

- Import `personas` and `systemStates` from `@podkit/device-testing` to get typed fixture objects.
- Inject fakes through the `SubprocessRunner` seam (interface in `@podkit/device-types`; default implementation in `@podkit/core`; hand-rolled stubs returning canned stdout for unit tests).
- Use `DevicePersona` fields (`usbDescriptor`, `sysInfoExtendedXml`, `lsblkJson`, `systemProfilerJson`, etc.) to feed injectable transports (`UsbBinding`, `ScsiSyscall`, `ProbeFs`).
- Use `SystemState` fields to configure subprocess responses, so the same fixture drives both the "FFmpeg missing" unit test and the VM snapshot.

**When to capture a new `DevicePersona`:** when touching device-identification logic (`identify()`, capability resolution, `resolveCapabilities()`), when adding a new supported device family, or when the `DevicePersona` schema gains a required field. See [agents/device-testing.md](device-testing.md) §"DevicePersona".

### Host tests — native subprocess tests (host-tagged)

Tests that invoke real subprocesses against canned fixtures on the host. Always run; skipped on the wrong OS via `describe.skipIf`.

- Files are tagged by OS: `*.darwin.test.ts` (macOS only) or `*.linux.test.ts` (Linux only).
- Subprocess outputs (e.g., `lsblk -J`, `system_profiler SPUSBDataType -json`, `ffmpeg -encoders`) are exercised against their real parsers; no mock.
- See §"Per-OS Test Tagging" for the full filename and `describe.skipIf` pattern.

### VM tests — Linux VM with `dummy_hcd` + FunctionFS

The full inquiry stack (`libusb`, `SG_IO`, `lsblk`, capability resolution) runs against a synthetic USB device inside a Lima test VM. The FunctionFS daemon loads a `DevicePersona` and presents real USB descriptors to the kernel.

- **Auto-detected:** if the `lima-test-vm` runner is available (macOS host with Lima installed, or a Linux host), VM tests run. If unavailable, tests are skipped with a warning (`[vm] Linux VM not available — skipping device integration tests`) rather than failed.
- Harness self-tests live under `test-packages/device-testing/src/vm/`; podkit feature tests live under `test-packages/e2e-vm-tests/src/`. Both are tagged `*.e2e.test.ts`.
- `SystemState` is applied via `apply-state.sh` before each test group; the runner handles this transparently.

### Quick-reference commands (today)

```bash
bun run test:unit --filter <pkg>    # Unit + host tests (OS-tagged files self-skip)
bun run test --filter <pkg>         # All tests for one package (unit + host + integration)
bun test test-packages/<pkg>/src/foo.test.ts  # Single file (bypasses turbo)
```

For VM tests: `bun run test:vm` from the repo root (or `bun run --cwd test-packages/device-testing test:vm`). The Lima VM is managed via `bun run harness:setup` (first-time), `vm:up device` / `vm:down device`, and `harness:status` — see [agents/device-testing.md §"Quick start"](device-testing.md#quick-start-developer).

**Auto-rebuild + drift detection.** `bun run test:vm` now turbo-depends on `vm:install` (cached fresh-binary install) and `vm:doctor` (baseline-drift check vs the in-VM hash of yaml + apply-state.sh). Running tests against a stale binary or a drifted VM baseline used to silently produce false RED/GREEN cells; today either condition is caught before tests load. On drift, `vm:doctor` exits 1 with the exact remediation command (`bun run vm:destroy device --yes && bun run harness:setup`). Force-refresh outside `test:vm` via `bunx turbo run @podkit/device-testing#vm:install`. Full design in [documents/architecture/testing/vm-build-orchestration.md](../documents/architecture/testing/vm-build-orchestration.md).

### Quick-reference: doctor invocations for state assertions

`podkit doctor` exposes a `--scope` flag (TASK-333) that picks which check
groups run:

```bash
podkit doctor --scope system --json   # System-scope checks only; no device required.
podkit doctor --scope device -d <…>   # Device-scope checks only; requires -d.
podkit doctor                          # Default: --scope all (legacy behaviour).
```

`--scope system` skips device resolution entirely — it works on a
freshly-booted machine with no configured device and exits 0 when all
host-environment checks pass. VM-test baseline tests use it to compare a
SystemState snapshot's `expectedDoctorSystemOutput` against the live VM.
`--no-system` continues to work but applies only when `--scope` is `all`.

### Doctor exit-code & overall-health semantics

Locked in by [TASK-308](../backlog/tasks/) (m-19 Phase 5a). The rule is
single-sentence simple: doctor is **healthy iff readiness reached `ready` AND
every applicable check finished `pass` or `skip`**. Any `warn` or `fail` on a
check flips `healthy` to `false`. The JSON envelope's `healthy` boolean
mirrors the exit code: `healthy === true` iff exit code `0`.

| Exit code | Meaning |
|-----------|---------|
| `0` | Clean run — every check passed or skipped; readiness was `ready`. JSON: `success: true, healthy: true, status: 'ok'`. |
| `1` | Command error before/around the diagnostic. CLI threw a typed `CliError` (e.g. `DEVICE_NOT_RESOLVED`, `REPAIR_FAILED`, `CORE_LOAD_FAILED`, `UNSUPPORTED_DEVICE`). JSON: `success: false, error, code`. Repair failures land here. Hard device rejections (`readiness.level === 'unsupported'`) also land here — the doctor short-circuits before running any checks, so "issues found" (exit 2) would be misleading. See [TASK-331](../backlog/tasks/). |
| `2` | Diagnostic ran cleanly but found issues — at least one check is `fail` or `warn`, or readiness was non-`ready`. JSON: `success: true, healthy: false, status: 'issues-found'`. |

Doctor's `CliError` exit code default is `1` (set in `runAction`); the
`process.exitCode = 2` line in `runDoctorDiagnostics` / `runSystemOnlyDoctor`
distinguishes "found problems" from "command failed". JSON consumers should
prefer branching on `success` + `healthy` rather than the numeric exit code
where possible.

**Decision: `warn` counts as unhealthy.** A `warn` from any in-scope check
sets `healthy = false` and flips the exit code to `2`. We picked this over
"warn ≡ healthy" because:

1. Warn states are real issues the user should see and act on — e.g.
   inquiry-methods warn on macOS without libusb means SCSI fallback paths
   only; codec-encoders warn on macOS with only `h264_videotoolbox` means
   software-only transcoding. Surfacing them is the point.
2. Silently passing on warns defeats doctor's discipline-of-signal purpose.
   If `podkit doctor && podkit sync` returns clean but the next sync skips
   half the library because of an unreported encoder warning, doctor failed
   its job.
3. Preserving the current behaviour avoids backwards-compat churn for
   existing users who already script around exit codes (`if podkit doctor;
   then podkit sync; fi`).
4. Easier to relax later (warn → healthy) than to tighten (would surprise
   scripts that today rely on warn = unhealthy).

This decision applies consistently across the three doctor invocation
modes: legacy `--scope all`, `--scope system` (system checks only;
[TASK-333](../backlog/tasks/)), and `--scope device`. `--no-system` is
the legacy spelling of "exclude system-scope checks from `--scope all`";
it does not change the rule, only the set of checks weighed against it.

The matrix is pinned in
[`packages/podkit-cli/src/commands/doctor-exit-code.test.ts`](../packages/podkit-cli/src/commands/doctor-exit-code.test.ts).
Each numbered AC in TASK-308 has a matching `describe` block. The
canonical numeric exit-code constants live in
[`packages/podkit-cli/src/commands/error-codes.ts`](../packages/podkit-cli/src/commands/error-codes.ts)
and the per-command code unions next to them. VM-test invocations of
`--scope system` (which assert the same rule against a live VM) are
deferred to the next VM-test sweep and noted in the task's AC list.

### Cross-references

- [ADR-016](../adr/adr-016-linux-vm-test-harness.md) — the VM harness architecture decision (its "tier" naming is superseded by the [test taxonomy](../documents/architecture/testing/taxonomy.md); see [ADR-025](../adr/adr-025-canonical-test-taxonomy.md))
- [ADR-017](../adr/adr-017-device-persona-fixtures.md) — `DevicePersona` + `SystemState` fixture registry design
- [agents/device-testing.md](device-testing.md) — canonical reference for writing device tests
- [test-packages/device-testing/README.md](../test-packages/device-testing/README.md) — package-level API reference

## Test Task Composition

The `test` turbo task is composed from `test:unit` and `test:integration` — it doesn't run tests itself. This means turbo can cache each sub-task independently:

```bash
bun run test:unit                    # Runs and caches unit tests per-package
bun run test:integration             # Runs and caches integration tests per-package
bun run test                         # Runs both — reuses cached sub-tasks
bun run test --filter podkit-core    # Same composition, scoped to one package
```

E2E packages are kept out of the global compose by using non-`test` task names — `@podkit/e2e-tests` runs `test:e2e` and `test:e2e:docker` (different turbo tasks, separate cache keys), `@podkit/e2e-vm-tests` runs `test:vm`. `bun run test` therefore only fans out to `test:unit` + `test:integration` across the workspace; the e2e suites only fire when explicitly requested via their named root scripts.

**E2E scope, by command:**

| Command | Runs what | Where |
|---|---|---|
| `bun run test:e2e` | `*.test.ts` outside the surface subdirs (`docker-source/`, `docker-loopback/`) — host CLI subprocess against dummy iPod. | `test-packages/e2e-tests/` only. |
| `bun run test:e2e:docker` | `src/docker-source/**/*.test.ts` — host CLI subprocess against containerised back-ends. | `test-packages/e2e-tests/` only. |
| `bun run test:e2e:docker-loopback` | `src/docker-loopback/**/*.test.ts` — shipped image (`--privileged`) driving the CLI against a loopback FAT block device, VM-free. Trust-disk verification + hard-error-on-generic. | `test-packages/e2e-tests/` only. |
| `bun run test:vm` | `*.e2e.test.ts` + harness self-tests — Lima VM with `dummy_hcd` + FunctionFS. | `test-packages/e2e-vm-tests/` and `test-packages/device-testing/src/vm/`. |

Note the naming gotcha: `*.e2e.test.ts` files are **not** picked up by `test:e2e`. They run via `test:vm` because they need the VM harness. Only files in `@podkit/e2e-tests` count toward `test:e2e` / `test:e2e:docker`.

**Important:** Library-package `test` scripts are no-ops (`true`) because turbo handles the composition. Don't `cd` into a package and run `bun run test` directly — use turbo from the repo root. To run a single test file directly:

```bash
bun test packages/podkit-core/src/foo.test.ts  # Run a single file (bypasses turbo)
```

**Adding `test:integration` to a package:** Only add the script (and the `**/*.integration.test.ts` entry in `bunfig.toml`'s `pathIgnorePatterns`) when the package actually has integration tests. Packages without integration tests omit both — `bun run test:integration` from the root then just skips them, no ceremony. The pattern is opt-in: `podkit-core`, `podkit-cli`, `libgpod-node`, `gpod-testing` opt in because they ship real integration suites; everyone else stays at unit-only until they need it.

## Running Tests Efficiently

**Run targeted tests, not the full suite.** `bun run test` runs all unit and integration tests across every package — the output is long and noisy. After making changes, prefer running only what's needed:

```bash
bun run test:unit --filter podkit-core    # Unit tests for one package (fast)
bun run test --filter podkit-core         # All tests for one package
bun test packages/podkit-core/src/foo.test.ts  # Single file (bypasses turbo)
```

To re-run a specific failed test by name, use `-t` with a pattern:

```bash
bun test -t "fails when no device"   # Match test name substring
```

## Interpreting Test Output

Test output is prefixed with the package name (e.g., `@podkit/e2e-tests:test:`) because turborepo runs packages in parallel. Failures from different packages can be interleaved.

**Finding failures quickly:**

- Grep for `✗` (U+2717) — each failed test is marked with this symbol
- Grep for `error:` — Bun prints `error: expect(received).toBe(expected)` etc. on failure lines
- The `Expected` / `Received` block immediately after the error is the most useful part
- The stack trace gives the exact `file:line` of the assertion

**Common failure patterns:**

| Pattern | What it means | What to do |
|---------|---------------|------------|
| Exit code mismatch (`toBe(0)` got `1`) | The CLI command failed | Check stderr in the test output for the actual error message |
| String containment failure | An error message or output text changed | Read the `Received` value — the message was updated or the behavior changed |
| Timeout | Test exceeded time limit | Likely a real hang or missing async resolution |

**After running tests**, check the summary line at the end of each package's output:

```
Ran 316 tests across 13 files. [121.24s]
```

If any tests failed, Bun also prints a count like `X pass, Y fail` — scan for `fail` to confirm whether a package had failures.

## Turbo Cache Awareness

Turbo caches test results based on file inputs. Be aware of these pitfalls:

- **Stale cache can mask failures.** If tests pass but you suspect they shouldn't (e.g., after changing behavior in an upstream package), clear the cache: `npx turbo run test --force`
- **E2E tests depend on the built CLI.** The `@podkit/e2e-tests#test:e2e` and `#test:e2e:docker` tasks use `^build` (upstream builds) in their cache keys. If you change podkit-cli or podkit-core source, the e2e cache invalidates automatically. But if you only change test files, `bun run build` may not re-run — rebuild explicitly if needed.
- **The `Cached: N cached` line in turbo output tells you what was reused.** If you expect a task to re-run but it shows as cached, the inputs may not cover what changed.

## Debugging E2E Failures

E2E tests spawn the CLI as a subprocess and check exit codes and output. When a test fails with `expect(result.exitCode).toBe(0)` / `Received: 1`, the test output often doesn't show the CLI's stderr. To see the actual error:

```bash
# Run the CLI command manually to see the real error message
node packages/podkit-cli/dist/main.js --config /path/to/test/config.toml sync --device /tmp/ipod --dry-run
```

Or add temporary logging in the test: `console.log(result.stderr)` before the assertion.

## Full Local Validation

Run this sequence before submitting a PR:

```bash
# 1. Build, type check, lint
bun run build
bun run typecheck
bun run lint

# 2. macOS tests
bun run test              # Unit + integration
bun run test:e2e          # E2E with dummy iPod

# 3. Linux tests (cross-platform or device-related changes)
mise run test:linux        # Runs on Debian + Alpine VMs (requires: brew install lima)

# 4. Docker E2E (Subsonic changes only)
bun run test:e2e:docker
```

## The two quality mirrors (`quality` / `quality:rc`)

There are two "quality" commands. They run the **identical set of surfaces** —
lint, typecheck, build, unit, integration, host e2e, host-docker source e2e, the
VM suite (`test:vm`), and the two shipped-image surfaces (`test:e2e:docker-dist`
+ `test:e2e:docker-loopback`). The only difference is *which assets the surfaces
run against*:

| | Assets |
|---|---|
| `bun run quality` | **Locally built**: the locally compiled mac binary, the local glibc/musl builds, and a locally built docker image. |
| `bun run quality:rc` | **CI-built release candidate**: the compiled mac binary and the glibc linux binary fetched from the release-candidate build, and the docker image pulled as the moving `:rc` tag. |

So a green `quality` locally means the same checks will pass against the real
assets — only the asset source changes.

Both commands funnel through **one shared two-phase body**
(`test-packages/device-testing/scripts/run-mirror-body.ts`) so they can never
drift in which surfaces run:

- **Phase 1** — `turbo run qa` (includes `test:vm`).
- **Phase 2** — `turbo run test:e2e:docker-dist test:e2e:docker-loopback`.

The split is deliberate: `qa` already contains `test:vm`, and both `test:vm` and
`test:e2e:docker-dist` drive the single shared `podkit-device` VM.
Running them concurrently collides on the gadget/mount state (a bare-FAT
`gpod-tool init` fails), so the docker phase must wait for `qa` to release the
VM. Extra flags pass through to both phases: `bun run quality --force`, or
`bun run quality -- --concurrency=4`. Note turbo's `--` semantics: args
_before_ `--` are turbo flags, args _after_ `--` are forwarded to each task's
own command — so don't combine them expecting both to be turbo flags (e.g.
`--force -- --dry=text` runs a real build, since `--dry=text` is no longer
turbo's dry-run flag).

Both are **local-only** (never run in GitHub CI) and require **Docker Desktop**
plus the **Lima harness VM** (`bun run harness:status`). `quality:rc`
additionally requires an authenticated **`gh`** (it discovers the
release-candidate build and downloads its artefacts).

The commands differ only in the values of a few override env vars (all forwarded
through turbo via `globalPassThroughEnv`):

| Env var | `quality` | `quality:rc` |
|---|---|---|
| `PODKIT_CLI_BINARY` | local `bin/podkit` (host e2e runs the real compiled binary) | fetched mac arm64 binary |
| `PODKIT_LINUX_BINARY` | unset (VM builds from local musl-builder) | fetched glibc arm64 binary |
| `PODKIT_DOCKER_DIST_IMAGE` | unset (both docker surfaces build locally) | `ghcr.io/jvgomg/podkit:rc` (both surfaces pull it) |

### `quality:rc` specifics

The release candidate is the verification build the open "Version Packages" PR
triggers (`.github/workflows/verify-release.yml`), which builds the binary
matrix + docker image and pushes the moving `:rc` tag. `quality:rc`:

1. discovers and classifies that build's state; on any non-ready state it prints
   an actionable message and **exits non-zero** (fail fast):
   - **no open "Version Packages" PR** — there is no release candidate; use
     `bun run quality` for a local check, or open one (changeset → version PR);
   - **build in progress** — prints the run url; re-run with `--wait` to block
     until it is green, or come back later;
   - **build failed** — prints the run url; fix the build first.
2. on a **ready** build, fetches exactly **two** arm64 artefacts into a
   git-ignored scratch dir (`test-packages/device-testing/.rc-assets/`) — the
   compiled mac binary (host e2e) and the glibc linux binary (harness VM) — then
   pulls `:rc` and runs the shared body. The musl binaries and the daemon are
   **not** fetched standalone: they live inside the `:rc` image the docker
   surfaces pull.

Flags: `--wait` (block on an in-progress build), `--run-id <id>` (classify an
explicit run, bypassing PR discovery). Scope: **arm64 only** (Apple-Silicon host
+ arm64 harness VM).

**Fidelity caveat.** `:rc` artefacts are the same build recipe and shared cache
as release — functionally the release bytes, but **not bit-identical** (e.g. the
image build-date label differs). CI-fidelity gating exists only during the
release-candidate window; feature-branch iteration uses `quality` (local).

## All Test Commands

```bash
bun run test              # All tests (composed: runs test:unit + test:integration)
bun run test:unit         # Unit tests only (cached independently)
bun run test:integration  # Integration tests only (cached independently)
bun run test:perf         # Performance benchmarks (manual; not cached)
bun run test:e2e          # E2E tests (dummy iPod, no Docker)
bun run test:e2e:real     # E2E tests (real iPod, requires IPOD_MOUNT)
bun run test:e2e:docker       # E2E tests requiring Docker (Subsonic / Navidrome)
bun run test:vm           # E2E tests inside the Lima VM harness
mise run test:linux              # Run tests on Debian + Alpine VMs
mise run test:linux:debian       # Debian (glibc) only
mise run test:linux:alpine       # Alpine (musl, Docker parity) only
mise run test:linux:stop         # Stop VMs (preserves state + turbo cache)
mise run test:linux:destroy      # Delete VMs entirely
mise run test:linux:cache:clear  # Clear turbo cache without deleting VMs
mise run tools:brew-test   # Homebrew install smoke test (after releases)

# Container cleanup (in test-packages/e2e-tests/)
bun run --filter @podkit/e2e-tests cleanup
```

## Test depths and pathIgnorePatterns

The depths in the [Quick Reference](#quick-reference) are enforced by **bunfig.toml `pathIgnorePatterns`** plus **turbo task wiring**. Together they decide what `bun test` actually runs in each scenario.

### How the gates compose

- A package's `bunfig.toml` lists `pathIgnorePatterns` only for depths it owns:
  - `packages/podkit-core/bunfig.toml` ignores `**/*.integration.test.ts` **and** `**/*.perf.test.ts` — so bare `bun test` runs only the fast unit depth.
  - `packages/podkit-cli`, `libgpod-node`, `gpod-testing` ignore `**/*.integration.test.ts`.
  - `test-packages/device-testing/bunfig.toml` ignores `**/*.e2e.test.ts` so stray runs don't try to spin up VM personas.
  - Packages with no integration / perf / e2e files keep their bunfig minimal (just `retry = 2`) — nothing to gate.
- Each task script clears the ignore for the depth it wants and filters in:
  - `test:integration` → `gpod-tests-parallel` (default pattern `*.integration.test.ts`).
  - `test:perf` → `gpod-tests-parallel --pattern '*.perf.test.ts'`.
  - `test:e2e` / `test:e2e:docker` / `test:vm` → their package's own runner script.
- Turbo wires `^build` + the appropriate fixture/template generator tasks before each depth, so `test:integration` and `test:perf` see freshly-built workspaces and ready-to-use fixtures.

### Why `bun test` skips integration + perf

Unit-only iteration is the fast loop. Contributors who haven't built gpod-tool or installed ffmpeg/metaflac still get clean unit-test runs because `pathIgnorePatterns` keeps those files out of the default match. Running `test:integration` or `test:perf` opts in explicitly.

### Direct file invocation

```bash
bun test packages/podkit-core/src/foo.test.ts                      # Unit — works as-is.
bun test --path-ignore-patterns= packages/podkit-core/src/foo.integration.test.ts
                                                                    # Integration — must clear the gate.
```

The second form is what `gpod-tests-parallel` does under the hood; you only need it for ad-hoc one-off runs.

### What happens to preload?

Most packages' `bunfig.toml` does not set `preload`. Each integration / perf / e2e test file declares its own requirements at the top of the module via [Module-load preflight](#module-load-preflight) helpers — that's the single layer that catches missing system deps. Two intentional exceptions:

- `@podkit/e2e-tests` preloads docker signal handlers for graceful container cleanup (a process-level concern, not per-test).
- `@podkit/device-testing` and `@podkit/e2e-vm-tests` preload `@podkit/device-testing/preflight`, which self-gates on `process.argv` and `npm_lifecycle_event` so it only contacts Lima when VM tests are actually targeted. Non-VM `bun test` runs no-op the preload. See [agents/device-testing.md §"Preflight contract"](device-testing.md) for the full contract.

## Prerequisites for Integration Tests

```bash
mise trust             # Trust mise config (first time only)
mise install           # Pin to the bun version in mise.toml
mise run tools:build   # Build gpod-tool CLI
bun run build          # Build the libgpod-node native bindings + every workspace package
```

After that, integration tests will run. Each individual test file declares its own system-dep requirements via [Module-load preflight](#module-load-preflight); if anything is still missing, the suite fails with a focused error message pointing at the fix.

## Module-load preflight

Integration / perf / e2e tests that depend on a system tool or a fixture set declare their requirements at the top of the test file. The helpers throw at module load, so bun:test surfaces missing deps as a real suite failure — no silent skips, no "tests passed" with no actual execution.

### Available helpers

All exported from `@podkit/test-fixtures` (and re-exported through `@podkit/e2e-shared` for the e2e harnesses):

| Helper | Checks | Install hint emitted on failure |
| --- | --- | --- |
| `requireFFmpeg()` | `ffmpeg -version` runs cleanly. | `brew install ffmpeg` / `apt install ffmpeg` |
| `requireFfprobe()` | `ffprobe -version` runs cleanly. | Ships with ffmpeg — install ffmpeg. |
| `requireMetaflac()` | `metaflac --version` runs cleanly. | `brew install flac` / `apt install flac` |
| `requireGpodTool()` | `gpod-tool --version` runs cleanly. | `mise run tools:build` |
| `requireBinary(name, hint, [versionArgs])` | Generic — used by the wrappers above. Reach for it only when a test needs a tool that doesn't have its own wrapper yet. | Caller-supplied. |
| `ensureFixturesExist(set)` | A `@podkit/test-fixtures` static set (`'multi-format'` / `'goldberg-selections'` / `'synthetic-tests'` / `'video'`) has been generated. | `bun run --filter @podkit/test-fixtures generate-static-fixtures` |

The libgpod-node native-binding check lives in the package itself (avoids a workspace cycle):

| Helper | Source | Checks |
| --- | --- | --- |
| `requireLibgpodNode()` | `@podkit/libgpod-node` | The N-API addon dlopens cleanly via the package's `isNativeAvailable()` predicate. |

### Pattern

```ts
import {
  ensureFixturesExist,
  requireFFmpeg,
  requireGpodTool,
  requireMetaflac,
} from '@podkit/test-fixtures';
import { requireLibgpodNode } from '@podkit/libgpod-node';

// System deps. Each call throws with a focused install hint if missing.
requireFFmpeg();
requireMetaflac();
requireGpodTool();
requireLibgpodNode();

// Static fixture sets. Turbo runs `generate-static-fixtures` as a dep of
// `test:integration` so under normal flows these are no-ops.
ensureFixturesExist('multi-format');
ensureFixturesExist('goldberg-selections');

describe('my integration suite', () => { /* … */ });
```

Calls go at module top level, **above** the first `describe`. They run once per test file (one `execFileSync` per binary, ~10 ms each).

### When you DO need to skip

The only acceptable form of skip is platform gating. Filename convention + `describe.skipIf`:

```ts
// foo.linux.test.ts
import { describe, it } from 'bun:test';
const isLinux = process.platform === 'linux';
describe.skipIf(!isLinux)('Linux-only behaviour', () => { /* … */ });
```

The filename suffix (`.darwin.test.ts` / `.linux.test.ts`) makes intent visible. Use it when the test would never make sense on the other platform — not as a workaround for missing deps.

## Test skip anti-patterns

The patterns below are explicitly banned. They make missing-dep test failures look like green passes, which has historically hidden real coverage gaps.

### Don't: silent-pass skip helpers

```ts
//  Anti-pattern. Reporter shows this as PASSED when ffmpeg is missing.
function skipIfNoFfmpeg(): boolean {
  if (!ffmpegAvailable) { console.log('Skipping: ffmpeg'); return true; }
  return false;
}

it('does the thing', async () => {
  if (skipIfNoFfmpeg()) return;
  // …
});
```

### Don't: env-flag-gated `it.skipIf`

```ts
//  Anti-pattern. Default `bun test` silently skips all Docker tests.
const subsonicE2eEnabled = process.env.SUBSONIC_E2E === '1';
it.skipIf(!subsonicE2eEnabled)('syncs from Subsonic', async () => { /* … */ });
```

If a whole suite needs Docker, the suite belongs in `@podkit/e2e-tests` under the `src/docker-source/` directory, and its `beforeAll` should throw when Docker is unavailable. See [Test package layout](#test-package-layout).

### Don't: try/catch swallowing a fixture load

```ts
//  Anti-pattern. The test silently passes if the fixture is missing
//     or unreadable, AND eats any other read error.
let buf: ArrayBuffer;
try {
  buf = readFileSync(fixturePath).buffer;
} catch {
  return; // skip if fixture not available
}
```

Use `ensureFixturesExist(set)` at module load.

### Do: module-load throws

```ts
//  Same intent, no silent skip. Reporter shows a focused failure
//     with an actionable install hint.
requireFFmpeg();
ensureFixturesExist('multi-format');

it('does the thing', async () => { /* runs unconditionally now */ });
```

### Do: deferred-bug skips that stay visible (matrix suites)

The bans above are about skips that **hide** a missing dependency. The opposite
case — deliberately fencing off a cell because *podkit itself is currently
broken for it* — is sanctioned, but only when the skip stays visible and
counted. The matrix harness (`e2e-tests/src/matrix/`) makes this explicit: its
`skip()` returns a typed `SkipDecision`, and a bug-deferral must use
`skipBug(reason, ref)` (rendered `[BUG] <ref>` by the runner) — never a generic
or silent skip. Structural prunings use `skipRedundant` / `skipImpossible` /
`skipEnvGated`. This keeps the dividing line sharp: a green run with only
structural skips hides nothing; every `[BUG]` is tracked, deferred work.

To enumerate the deferred work a matrix suite has captured:

```sh
grep -rn 'skipBug(' test-packages/e2e-tests/src   # the to-do list, no run needed
# or, to see which cells: run with --reporter=junit and grep 'name="\[BUG\]'
```

See `test-packages/e2e-tests/src/matrix/README.md` §"Surfacing deferred work"
and doc-039 §"Mass-storage sync gaps".

### Adding a new integration test

1. Pick the right depth — see [Test package layout](#test-package-layout).
2. Top of the file: call the `requireX()` and `ensureFixturesExist(...)` helpers for everything your test touches.
3. No `bunfig.toml preload` to add; the depth gate is just the filename suffix (`*.integration.test.ts`).
4. Pure unit tests don't need any preflight calls.

## Test package layout

| Test belongs in | When | Path |
| --- | --- | --- |
| `<workspace>/src/**/*.test.ts` | Pure unit test of library code. No subprocess, no fixtures bigger than a kilobyte. | The package's own `src/` tree. |
| `<workspace>/src/**/*.integration.test.ts` | Tests library code with real system deps (ffmpeg / gpod-tool / libgpod-node) but no CLI subprocess. | Same package. |
| `<workspace>/src/**/*.perf.test.ts` | Performance benchmark. Generates synthetic load; assertion is a wall-clock or count threshold. | Same package. |
| `@podkit/e2e-tests` (`*.test.ts`) | Spawns the built CLI subprocess. Dummy or real iPod target. No Docker, no Lima VM. | `test-packages/e2e-tests/` |
| `@podkit/e2e-tests` (`src/docker-source/`) | Same package; files needing a Docker container (Subsonic / Navidrome / future) live in the `src/docker-source/` surface directory so the `test:e2e` task can exclude the whole directory. | `test-packages/e2e-tests/` |
| `@podkit/e2e-vm-tests` | Anything needing a Lima VM (`dummy_hcd` USB gadget, Linux kernel modules). | `test-packages/e2e-vm-tests/` |
| `@podkit/e2e-shared` | Helpers shared across the e2e packages: CLI runner, error-assertion, composable preflight checks. | Already exists; you import from it. |
| `@podkit/test-fixtures` | Anything that mints or describes a fixture (static set or dynamic mini-track). | Already exists; you import from it. |

The e2e packages all consume `@podkit/e2e-shared` (CLI runner + composable preflight) and `@podkit/test-fixtures` (path helpers + module-load preflight wrappers). The Docker-gated tests live in `@podkit/e2e-tests/src/docker-source/` (the `docker-sidecar` Surface directory — see [the test taxonomy](../documents/architecture/testing/taxonomy.md)); the containing directory is the only thing distinguishing them from the default host-binary surface.

## Diagnosing environment issues

When integration tests pass but `podkit sync` produces no tracks (or similar silent failures), run the diagnostic suite against a virtual iPod:

```bash
node packages/podkit-cli/dist/main.js doctor --device <mount> --json
```

Particularly relevant checks: `codec-encoders` (audio encoders for the configured preference stack) and `video-encoder` (libx264 / h264_videotoolbox availability). The `doctor-system.e2e.test.ts` suite asserts both pass on every supported platform — Linux VMs especially, where macOS-only paths historically slipped through.

## Working in Git Worktrees

When working in a git worktree (e.g., `.claude/worktrees/`), you must run these setup steps — worktrees are independent working directories and don't share the main repo's build artifacts or mise trust state:

```bash
bun install            # Install dependencies (worktree has its own node_modules)
mise trust             # Trust mise config for this worktree
mise install           # Pull pinned bun version into this worktree
mise run tools:build   # Build gpod-tool (needed for iPod database tests)
```

Without these steps, integration tests will fail at preload time with a clear "Missing required test dependency" message naming the missing tool. That's the preflight system doing its job — fix the environment, don't suppress the error.

## Mocking: prefer DI over `mock.module()`

### Why `mock.module()` is restricted

Bun's `mock.module(specifier, factory)` mutates the **process-global** module
registry. Once a test mocks `@podkit/ipod-firmware` (for example), every other
test file loaded into the same `bun test` worker sees the mocked module —
including tests that have nothing to do with the original suite. Calling
`mock.restore()` in `afterEach` is easy to forget and easy to miss in code
review.

This isn't a theoretical concern: a `mock.module('@podkit/ipod-firmware', …)`
in one of the readiness tests has been observed breaking unrelated readiness
tests that load the real module. The symptom is order-dependent: tests pass in
isolation, fail in the suite, and the failure points at code that hasn't been
touched.

**Rule:** new tests must not call `mock.module()`. Existing call sites are
being migrated to dependency injection (see "Existing offenders" below).

### The right pattern

For runners that touch `@podkit/core`, the OS, or the device manager, accept a
`XDeps` interface and let tests inject fakes at the function-call boundary.
The CLI side of this is fully documented in §"The deps seam, in detail"
above. For library code in `@podkit/core`, follow the same shape — the
`sysinfo-modelnum-mismatch.ts` check is the cleanest reference: it accepts
optional `SysInfoFsReader` and `SieReader` constructor parameters whose real
implementations are imported by default and whose test stubs are passed in by
the test file.

For mocking individual function calls — *not* whole modules — `bun:test`'s
`mock(impl)` is fine and lives only on the value you pass to the runner via
its `Deps`. That keeps the mock scoped to the call rather than the module
graph.

### Migration complete

The `mock.module()` → DI migration tracked under TASK-343 has landed. The
five files that previously used `mock.module()` (provider, sysinfo-extended,
sysinfo-consistency-repair, video/handler-execute, adapters/directory) have
all been converted to constructor- or function-parameter seams and now only
mention `mock.module()` in their headers to explain why they don't use it.

When adding a new test that's tempted to reach for `mock.module()`, follow
the seam pattern instead: add an optional constructor or function parameter
on the production code with a sensible default, then have the test pass a
stub through that parameter rather than patching the module.

## Assertion style

There is no project-wide rule that "all tests use snapshots" or "all tests
use field assertions" — the choice depends on what you're pinning:

| What you're asserting | Use |
|---|---|
| Stable, multi-line user-facing text (CLI output, formatted error block) | `expect(text).toContain(...)` for fragments, full-string `toBe` for short fixed messages |
| Structured JSON envelopes from the CLI | field-by-field `expect(json.code).toBe(...)`, `expect(json).toMatchObject(...)` — see `expectCliError` |
| Typed discriminated unions (e.g. `ReadinessUnsupportedReason`) | direct field access: `expect(result.unsupported?.kind).toBe('ios-device')` |
| Long generated artifacts where any change is interesting (M3U playlists, JSON reports) | a focused string assertion is still preferred over full-document snapshots — easier to diff in review |

The codebase does **not** use `expect(...).toMatchSnapshot()` — searches show
zero call sites. Don't introduce it without team agreement; the existing
hand-rolled `toContain` / `toMatchObject` patterns make failures
self-documenting in PR review.

## Canonical fake builders

Three sources of test data exist; pick one deliberately rather than
hand-rolling inline fixtures:

| Package | Use it for |
|---|---|
| `@podkit/device-testing` | Anything device-shaped: `personas` (typed `DevicePersona` fixtures with USB descriptors + SysInfo + lsblk JSON), `systemStates` (host-environment snapshots), `SubprocessRunner` + `defaultSubprocessRunner` re-exports. See [agents/device-testing.md](device-testing.md). |
| `@podkit/gpod-testing` | Anything iPod-database-shaped: `withTestIpod()`, `createTestIpod()`, `addTracks()`. Tests that need a real iTunesDB on disk. |
| `@podkit/test-fixtures` | Audio file generation: FLAC/MP3 files with controllable metadata and artwork for sync-pipeline tests. |

For the in-process CLI helpers (`makeFakeIpodAdapter`,
`makeFakeOpenDeviceResult`, `fakeManager`, `fakeCore`), see
`packages/podkit-cli/src/test-utils/`. Do not add a second copy of these
helpers inside an individual test file — extend the shared utility instead.

## Writing Tests with iPod Databases

Use `@podkit/gpod-testing` to create test iPod environments:

```typescript
import { withTestIpod } from '@podkit/gpod-testing';

it('works with iPod database', async () => {
  await withTestIpod(async (ipod) => {
    await ipod.addTrack({ title: 'Test', artist: 'Artist' });
    const info = await ipod.info();
    expect(info.trackCount).toBe(1);
  });
});
```

See [test-packages/gpod-testing/README.md](../test-packages/gpod-testing/README.md) for full API documentation.

### Why gpod-testing for setup, not the production code

Test setup uses `gpod-tool` (an independent C program built from `tools/gpod-tool/`) to populate the iPod database. The production code being exercised — `IpodDatabase` from `@podkit/core`, backed by `@podkit/libgpod-node` — is then used to read or manipulate that state.

**Do not use `IpodDatabase` to seed test fixtures.** That would create circular validation: a libgpod-node bug where its writes are only readable by itself would still pass the test, because both sides of the round-trip use the same code. Setup with one tool, exercise with another, verify cross-tool compatibility.

### Parallel integration test execution

Packages with many integration test files (`@podkit/libgpod-node`, `@podkit/core`) use the `gpod-tests-parallel` runner from `@podkit/gpod-testing` to run files in parallel subprocesses.

Direct invocation gets a big speedup:

```bash
cd packages/libgpod-node && bun run test:integration   # ~12s (was ~25s serial)
cd packages/podkit-core && bun run test:integration    # ~5s (was ~18s serial)
```

When run via `bun turbo run test:integration` across all packages, total wall-clock barely changes — turbo already runs packages in parallel and CPU is saturated. The runner's value is the **dev-iteration loop on a single package**, not full-suite wall-clock.

**Why files, not in-process `--concurrent`:** libgpod's native binding has non-thread-safe global state. `bun test --concurrent` collides — observed 4 failures. File-level subprocess isolation (one `bun test` per file) sidesteps this entirely.

**Why not all packages:** packages with few files (`podkit-cli` 3 files, `gpod-testing` 2 files) regress under parallelism — CPU contention overhead exceeds the parallelism gain. The runner is opt-in per package via `package.json scripts.test:integration`.

**Tuning:**

Default `TEST_CONCURRENCY=4`. The runner was originally tuned at 8, but full e2e runs under that setting reliably starved sub-1-second dry-run CLI invocations past the `runCli` 90 s timeout. 4-way parallelism gave each `bun test` subprocess real CPU headroom and wiped the flake class. Bump higher on a beefier machine if you want it back.

```bash
TEST_CONCURRENCY=8 bun run test:integration   # raise on a beefier host
TEST_CONCURRENCY=1 bun run test:integration   # serial — for diagnosing contention
TEST_TIMEOUT=60000 bun run test:integration   # bump if tests are CPU-starved
```

### Adding multiple tracks: use `addTracks`, not a loop of `addTrack`

Each call to `ipod.addTrack(...)` spawns a `gpod-tool` subprocess (~150ms). For tests that need more than one track of setup state, use the bulk helper:

```typescript
// SLOW: 5 subprocess spawns + 5 libgpod open/save cycles
await ipod.addTrack({ title: 'A', artist: 'X' });
await ipod.addTrack({ title: 'B', artist: 'X' });
await ipod.addTrack({ title: 'C', artist: 'X' });
await ipod.addTrack({ title: 'D', artist: 'X' });
await ipod.addTrack({ title: 'E', artist: 'X' });

// FAST: one spawn, one open/save (~150ms total instead of ~750ms)
await ipod.addTracks([
  { title: 'A', artist: 'X' },
  { title: 'B', artist: 'X' },
  { title: 'C', artist: 'X' },
  { title: 'D', artist: 'X' },
  { title: 'E', artist: 'X' },
]);
```

Internally this is one `gpod-tool add-tracks` invocation that reads a TSV stream on stdin. Returns `AddTrackResult[]` in the same order as the input. Single-track tests can keep using `addTrack` — there's no benefit to converting them.

### Template Fast-Path

`createTestIpod()` is internally backed by pre-built iPod database templates. When a test calls it with default arguments, it copies a template directory (~5ms) instead of spawning `gpod-tool init` (~300ms). This delivers a ~3.3× speedup on `test:integration` (111s → 34s on the maintainer's machine).

**Transparent to test authors** — no API change. Use `createTestIpod()` and `withTestIpod()` exactly as before.

**When the fast path is used:** all of the following must be true:
- `model` is in `TEMPLATE_MODELS` (MA147, MA002, MA146, MA477, MB565, MC293, MC027)
- `name` is the default (`'Test iPod'`)
- `firewireId` is the default (`TEST_FIREWIRE_GUID`)
- The template directory exists on disk

Otherwise it falls back to a `gpod-tool init` subprocess. The fallback is correct but ~60× slower per call.

**Regenerating templates:**

```bash
bun turbo run generate-templates --filter=@podkit/gpod-testing  # cached
bun turbo run generate-templates --filter=@podkit/gpod-testing --force  # force rebuild
```

Templates live in `test-packages/gpod-testing/templates/` (gitignored, ~290KB total). The turbo task invalidates on changes to the generation script, `src/templates.ts`, `src/test-ipod.ts`, `src/gpod-tool.ts`, or the `bin/gpod-tool` binary itself. Consuming integration test tasks (`@podkit/gpod-testing#test:integration`, the global `test:integration`, `@podkit/ipod-db#test:integration`, `@podkit/e2e-tests#test:e2e`, `@podkit/e2e-tests#test:e2e:docker`, `@podkit/ipod-db#generate-fixtures`) declare it as a dependency, so templates rebuild automatically when needed.

**Adding a new model:**
1. Add the model number to `TEMPLATE_MODELS` in `test-packages/gpod-testing/src/templates.ts`.
2. Add it to the `IpodModelNumber` literal union in `test-packages/gpod-testing/src/types.ts`.
3. (Optional) Add a friendly alias to `TestModels` in `test-packages/gpod-testing/src/test-ipod.ts`.
4. Run `bun turbo run generate-templates --filter=@podkit/gpod-testing --force` to regenerate.

**Disabling the fast path** (for benchmarking or debugging suspected template-induced bugs):

```bash
PODKIT_DISABLE_TEMPLATE_CACHE=1 bun turbo run test:integration --force
```

This forces every `createTestIpod()` call through the subprocess path. The env var is declared in `globalPassThroughEnv` in `turbo.json` so turbo passes it through to test runs.

## Test Audio + Video Fixtures

Static audio + video fixtures are owned by the `@podkit/test-fixtures` package. Outputs land under `test-packages/test-fixtures/fixtures/` (gitignored, regenerated on demand and cached by turbo).

Locate fixtures from a test via the lib API — never hard-code paths from the repo root:

```ts
import { ensureFixturesExist, getMultiFormatFixturesDir } from '@podkit/test-fixtures';

ensureFixturesExist('multi-format');           // module-load preflight; throws with regen hint
const dir = getMultiFormatFixturesDir();
```

`ensureFixturesExist(set)` fails fast with an actionable error if the set has not been generated yet. Turbo wires `@podkit/test-fixtures#generate-static-fixtures` as a dependency of every `test:integration` task and of the `@podkit/e2e-tests#test:e2e` / `#test:e2e:docker` tasks, so under normal flows the preflight is a no-op. See [test-packages/test-fixtures/README.md](../test-packages/test-fixtures/README.md) for the full set inventory and regen instructions.

## Dynamic Test Fixture Generator

`@podkit/test-fixtures` also has a **dynamic** fixture generator alongside the static sets — for handing a tester a tagged FLAC/MP3/AAC collection without writing a one-off script:

```bash
bun run --filter @podkit/test-fixtures generate-fixtures                  # Default: 3 FLAC tracks with blue artwork
bun run --filter @podkit/test-fixtures generate-fixtures --artwork red    # Regenerate with red artwork
bun run --filter @podkit/test-fixtures generate-fixtures --artwork        # Random different artwork color
bun run --filter @podkit/test-fixtures generate-fixtures --tracks 5       # Generate 5 tracks
bun run --filter @podkit/test-fixtures generate-fixtures --format mp3     # Convert to MP3
bun run --filter @podkit/test-fixtures generate-fixtures --replaygain -3.5  # Set specific ReplayGain value
```

Output goes to `test/manual-collection/` (gitignored). Without flags, output is deterministic and turbo-cached. Each variance flag (`--artwork`, `--format`, `--replaygain`) picks a random different value if no specific value is given. Requires FFmpeg and metaflac.

For one-off dynamic fixtures **inside** a test (a single FLAC with specific tags, no on-disk side effect needed), import the lib helpers instead:

```ts
import { generateMiniFlac } from '@podkit/test-fixtures';
const filePath = generateMiniFlac(tempDir, { filename: 'a.flac', title: 'Custom', artist: 'X' });
```

See `test-packages/test-fixtures/README.md` for the full `generateMiniX` surface.

## Writing CLI Unit and Integration Tests

**Hard rule: never spawn the podkit CLI as a subprocess from a unit or integration test.** Subprocess invocation lives only in `test-packages/e2e-tests/`. The rule is enforced by an oxlint check (`no-restricted-imports` for `node:child_process` in `packages/podkit-cli/src/**/*.test.ts`) — see `oxlint.json`.

For tests that need to drive a CLI command, call its **runner function** in-process. Each runner is an exported `async function runX(options, out, deps?)` extracted from the Commander action callback. Examples:

- `runDeviceAdd(options, out, deps?)` in `commands/device.ts`
- `runCollectionMusic(options, out)` / `runCollectionVideo(options, out)` in `commands/collection.ts`

### The four building blocks

| Piece | Purpose | Where |
|-------|---------|-------|
| `runWithContext(ctx, fn)` | Scope a `CliContext` for the runner via AsyncLocalStorage. Concurrent-safe. | `src/context.ts` |
| `OutputContext` + `BufferSink` | Capture stdout/stderr into a buffer instead of writing to the terminal. | `src/output/`, `src/test-utils/buffer-sink.ts` |
| `runAction(out, fn)` | Wrap a runner so thrown `CliError`s become structured output + `process.exitCode`. Use this in tests AND production action callbacks. | `src/errors.ts` |
| `<XDeps>` (e.g. `DeviceAddDeps`) | Inject fakes for `getDeviceManager`, `confirm`, `loadCore` so the runner doesn't perform real USB walks / prompts / dynamic imports. | per-runner |

### Test pattern

```typescript
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { OutputContext } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { runDeviceAdd, type DeviceAddDeps } from './device.js';

function makeContext(/* ... */): CliContext { /* construct config + globalOpts + configResult */ }

function makeOut(json = true) {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = new OutputContext({ mode: json ? 'json' : 'text', /* ... */, stdout, stderr });
  return { out, stdout, stderr };
}

// Compose runWithContext + runAction so the test runs the same path production does.
function runAdd(ctx: CliContext, opts: Parameters<typeof runDeviceAdd>[0], out: OutputContext, deps?: DeviceAddDeps) {
  return runWithContext(ctx, () => runAction(out, () => runDeviceAdd(opts, out, deps)));
}

it('rejects an unknown --quality preset', async () => {
  const ctx = makeContext({ device: 'd' });
  const { out, stdout } = makeOut();
  await runAdd(ctx, { type: 'echo-mini', quality: 'bogus' as never }, out);
  expect(stdout.json<{ success: false; error: string; code: string }>()).toMatchObject({
    success: false,
    code: 'INVALID_QUALITY',
  });
});
```

### When to extract a runner

If a Commander action callback grows beyond ~100 lines, or has any branch you'd like to unit-test, extract it. The pattern: pull the body into `export async function runX(opts, out, deps?)`, leave the `.action()` callback as a one-liner that builds `out` and calls `runAction(out, () => runX(...))`.

For external dependencies the runner pulls in (`getDeviceManager`, `confirm`, dynamic `import('@podkit/core')`), put them behind a `XDeps` interface so tests can stub. See `DeviceAddDeps` in `commands/device.ts` as the canonical example.

### The deps seam, in detail

Every runner that touches the device manager or `@podkit/core` accepts a `XDeps` interface that extends `CoreLoaderDeps` (from `src/handler-deps.ts`):

```typescript
import { loadCoreOrFail, type CoreLoaderDeps } from '../handler-deps.js';

export interface MyDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
}

export async function runMyCommand(opts: MyOptions, out: OutputContext, deps: MyDeps = {}) {
  const core = await loadCoreOrFail(deps, MyErrorCodes.CORE_LOAD_FAILED);
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
  // …
}
```

`CoreLoaderDeps` carries `loadCore?: () => Promise<typeof import('@podkit/core')>`. In tests, pass a stub returning a fake module — the real dynamic import never runs.

`loadCoreOrFail(deps, code)` centralises the "core failed to load" CliError. The supplied `code` is the per-command error code (e.g. `SyncErrorCodes.CORE_LOAD_FAILED`). It is **throw-style** — use it only when a core-load failure should surface as a CLI error. Handlers that intentionally swallow failures (e.g. `runDeviceList` falls back to config-only output, `doctor.resolveDevice` returns `{ error }`) use `deps.loadCore` directly inside their own try/catch.

For tests, the minimal seam is `loadCore: async () => ({} as typeof import('@podkit/core'))` plus a `getDeviceManager` stub built with the small `fakeManager(overrides)` helper local to each test file. See `device-add.unit.test.ts` for the full pattern and `eject.unit.test.ts`, `mount.unit.test.ts`, `device-scan.unit.test.ts`, `device-list.unit.test.ts`, `device-info-runner.unit.test.ts`, `device-music-video.unit.test.ts`, `device-ipod-ops.unit.test.ts`, and `sync-runner.unit.test.ts` for variations on the same shape.

#### Behaviour-test seams: `openDevice` and `ipodDatabase`

Seam-check tests prove the runner *honours* the deps. **Behaviour tests** drive past `IpodDatabase.open(...)` and `openDevice(core, path)` so we can assert on `removeAllTracks`, track-list filtering, model-name reporting, etc. — without a real iTunesDB fixture.

Two extra seams enable this:

- **`OpenDeviceFn`** on `DeviceInfoDeps` / `DeviceMusicDeps` / `DeviceVideoDeps` — overrides the high-level `openDevice(core, path, deviceConfig, defaults)` helper from `commands/open-device.ts`. Returns a stubbed `OpenDeviceResult` (adapter + capabilities + optional iPod handle).
- **`IpodDatabaseStub`** on `DeviceOpDeps` (clear / reset / init / reset-artwork) — overrides `core.IpodDatabase` (the static surface: `open` / `hasDatabase` / `initializeIpod`). Each returns an `IpodAdapterStub` whose method surface mirrors the runners' actual call sites. `DeviceOpDeps` also carries `resetArtworkDatabase?: typeof core.resetArtworkDatabase` for that specific command.

Shared factories live in `src/test-utils/fake-ipod.ts`:

```typescript
import { makeFakeIpodAdapter, makeFakeIpodTrack, makeFakeOpenDeviceResult } from '../test-utils/fake-ipod.js';

// Fake adapter that records side effects
let removeAllCalled = false;
const adapter = makeFakeIpodAdapter({
  trackCount: 5,
  getTracks: () => [makeFakeIpodTrack({ title: 'A', mediaType: 1 })],
  removeAllTracks: () => { removeAllCalled = true; return { removedCount: 5, fileDeleteErrors: [] }; },
});

const deps: DeviceOpDeps = {
  loadCore: async () => fakeCore(),                        // minimal core stub
  getDeviceManager: () => fakeManager(),
  ipodDatabase: { open: async () => adapter, hasDatabase: async () => true, initializeIpod: async () => adapter },
};

await runWithContext(ctx, () => runAction(out, () => runDeviceClear({ type: 'all', confirm: true }, out, deps)));
expect(removeAllCalled).toBe(true);
```

Gotchas:

- **`existsSync` wall.** Every iPod-only runner gates with `if (!existsSync(devicePath)) { throw … }`. Behaviour tests use `mkdtemp` (in `beforeEach`) to satisfy the check without touching real iPod paths.
- **`runDeviceInfo` error-swallowing.** The live-status block catches and demotes failures to `status.databaseError` rather than throwing. Behaviour tests assert on the JSON payload shape, not on thrown `CliError`s. It also mutates `process.exitCode` directly on unexpected DB errors — `BufferExitCodeSink` won't capture that.
- **`DeviceAddDeps.ipodDatabase`** is intentionally a *narrower* shape (only `hasDatabase` / `open` / `initializeIpod` returning `{ trackCount; close }`). Don't conflate with the wider `IpodDatabaseStub` used by `DeviceOpDeps`.

See `device-ipod-ops.behavior.test.ts`, `device-music-video.behavior.test.ts`, and `device-info.behavior.test.ts` for working examples.

### Throwing `CliError` instead of `process.exitCode = 1`

Inside a runner, error paths should:

```typescript
throw new CliError({
  message: 'Path not found: ' + path,
  code: 'PATH_NOT_FOUND',           // machine-readable tag, optional but encouraged
  details: { path },                // command-specific extras, merged into JSON output
});
```

The wrapper translates this to:
- text mode: `out.error(err.message)`
- JSON mode: `{ success: false, error, code, ...details }` on stdout
- `process.exitCode = err.exitCode` (default 1)

Tests assert on the captured JSON shape. Don't write `expect(process.exitCode).toBe(1)` as the primary assertion — `process.exitCode` is process-global and prevents `it.concurrent` within a file. Asserting on the structured JSON is concurrent-safe.

### `it.concurrent` caveat

`process.exitCode` is process-global, so any test that *also* asserts on `process.exitCode` cannot be `it.concurrent` with peers in the same file. Tests that only inspect stdout/stderr buffers can be concurrent — `runWithContext` provides ALS isolation, and each test's `BufferSink` is per-test state.

When in doubt, default to plain `it()`. Cross-file parallelism (bun test workers) gives you most of the speedup for free.

### Canonical error output shape

Every CLI command returning JSON on failure emits the same shape:

```json
{
  "success": false,
  "error": "<human-readable message>",
  "code": "<machine-readable tag>",
  "...command-specific details": "..."
}
```

JSON consumers should branch on `success === false` and read `error` / `code`. The shape is enforced by `runAction` + `CliError` — every command's `.action()` callback wraps its body in `runAction(out, () => fn())`, every error path inside throws `CliError`. No command sets `process.exitCode` directly for error cases. (A small handful of commands set `process.exitCode = 1` AFTER emitting a successful-shape JSON to signal "ran cleanly but found problems" — e.g. `doctor` reporting an unhealthy device. That is not an error case.)

For multi-line text-mode output, pass a `printText: (out: OutputContext) => void` callback in the `CliError` payload:

```typescript
throw new CliError({
  message: 'Mount failed',
  code: 'MOUNT_REQUIRES_SUDO',
  details: { device: '/dev/disk4s2' },
  printText: (o) => {
    o.error('Mount failed.');
    o.error('Run: sudo podkit mount');
  },
});
```

Without `printText`, runAction defaults to `out.error(err.message)`. The JSON-mode payload is unaffected; details merge into the top-level object.

### Text-only commands

A few commands (`completions zsh`, `completions bash`) emit non-JSON content (shell scripts) on the success path because that output is meant to be `eval`'d by the shell. Wrapping it in `{ "success": true, "script": "..." }` would break the use case.

For these commands:

- The **success path** writes plain text to stdout via `console.log` or `out.stdout()`. `--json` is ignored on success — the output is still the script.
- The **error path** still goes through `CliError` + `runAction`. Errors emit canonical JSON when `--json` is set. This part is universal.

Don't add per-command JSON shapes for text-only commands. If a user pipes the output, they want the shell script, not metadata. Document the asymmetry in the command's docstring.

### Narrowing the discriminated union

Each command's `*Output` type is a discriminated union of its success variant `| CliErrorOutput`. Consumers narrow with the `success` field:

```ts
import type { MountOutput } from 'podkit/commands/mount';

function handle(output: MountOutput) {
  if (output.success) {
    // narrowed to MountSuccess: device, mountPoint, dryRunCommand, etc.
    console.log(`Mounted at ${output.mountPoint}`);
  } else {
    // narrowed to CliErrorOutput: error, code, details
    console.error(`[${output.code}] ${output.error}`);
    if (output.details.requiresSudo) {
      console.error('Try: sudo podkit mount');
    }
  }
}
```

The `code` field (typed per-command via `XErrorCode`) lets consumers branch on machine-readable tags without parsing English. The `details` object carries command-specific extras nested one level — never spread at the top level — so the canonical fields can't collide with payload contents.

For asserting on this shape in tests, use `expectCliError` from `../test-utils/cli-error.js` (in-process) or `../helpers/cli-error.ts` (e2e/subprocess) — see "Asserting on CliError shape" above.

### Test helper: `expectCliError`

Both the in-process (`packages/podkit-cli/src/test-utils/cli-error.ts`) and subprocess (`test-packages/e2e-tests/src/helpers/cli-error.ts`) helpers collapse the standard "parse JSON, narrow, check fields" flow into one call:

```ts
// in-process
expectCliError(stdout, exitCode, {
  code: MountErrorCodes.MOUNT_REQUIRES_SUDO,
  error: /elevated privileges/,
  details: { device: '/dev/disk4s2' },
  exitCode: 1,           // optional, default 1
});

// e2e (spawns the CLI)
const { json } = await expectCliError(
  ['--config', cfg, 'mount', '--json'],
  { code: 'MOUNT_REQUIRES_SUDO', error: /sudo/ }
);
```

The helper asserts `success === false`, matches `code` exactly, optionally substring/regex-matches `error`, optionally checks `details` with `toMatchObject`, and asserts the exit code. Returns the parsed payload for additional inspection.

### Where the patterns live

| Pattern | Canonical file |
|---------|----------------|
| Runner extraction | `commands/device.ts` (`runDeviceAdd`), `commands/collection.ts` (`runCollectionMusic`) |
| Deps injection seam | `commands/device.ts` (`DeviceAddDeps`) |
| Test helper composition | `commands/collection.integration.test.ts` (`runMusic`, `runVideo`), `commands/device-add.unit.test.ts` (`runAdd`) |
| ALS isolation test | `context.test.ts` (the `runWithContext isolation` describe block) |
| Choices()-driven argv test (no runner) | `commands/doctor.test.ts` |

## Writing E2E Tests

Use `@podkit/e2e-tests` helpers for CLI testing:

```typescript
import { withTarget } from '../targets';
import { runCli, runCliJson } from '../helpers/cli-runner';

it('syncs tracks to iPod', async () => {
  await withTarget(async (target) => {
    // target.path is the iPod mount point (dummy or real)
    const result = await runCli(['sync', '--device', target.path, '--source', '/music']);
    expect(result.exitCode).toBe(0);

    // Verify tracks were added
    const count = await target.getTrackCount();
    expect(count).toBeGreaterThan(0);
  });
});
```

See [test-packages/e2e-tests/README.md](../test-packages/e2e-tests/README.md) for full documentation.

**Config files must include `version = 1`.** Every test config — whether created via `createTempConfig()` or inline — must start with `version = 1`. Configs without a version field are treated as version 0 and cause a hard error requiring migration. Use the helpers when possible:

```typescript
// Helper handles version automatically
const configPath = await createTempConfig('/path/to/music');

// For inline configs, always start with version = 1
await writeFile(configPath, `version = 1

[music.main]
path = "${musicPath}"

[defaults]
music = "main"
`);

// For minimal/empty configs
await writeFile(configPath, 'version = 1\n');
```

## Docker-Based E2E Tests

E2E tests that need Docker (Navidrome for Subsonic, future containerised back-ends) live in the `src/docker-source/` surface directory of `@podkit/e2e-tests`. The `test:e2e` task excludes that directory so contributors who don't need Docker aren't paying the container-pull cost on every `bun run test:e2e`; the `test:e2e:docker` task runs only that directory. See also [agents/docker.md](docker.md) for the Docker image architecture.

**Running Docker tests:**

```bash
bun run test:e2e:docker                              # From the repo root, runs the full Docker suite.
bun run --filter @podkit/e2e-tests test:e2e:docker   # Same thing, scoped explicitly.
```

Docker availability is checked in each test file's `beforeAll`; missing Docker throws with a focused error instead of silently skipping the suite. There is no `SUBSONIC_E2E=1` flag — the `src/docker-source/` directory is the gate.

**Container cleanup:**

Containers are automatically cleaned up on test completion, Ctrl+C, and crashes via signal handlers registered in `test-packages/e2e-tests/src/setup/preload.ts` (loaded by the package's `bunfig.toml`). If orphaned containers remain:

```bash
bun run --filter @podkit/e2e-tests cleanup       # Remove stopped containers
bun run --filter @podkit/e2e-tests cleanup:list  # List orphaned containers
bun run --filter @podkit/e2e-tests cleanup:force # Force remove all
```

**Adding a new Docker test:**

1. Add the test file under `test-packages/e2e-tests/src/docker-source/` as a bare `*.test.ts` (the directory is the Surface gate — no filename suffix needed).
2. At the top: `requireBinary`/`requireFFmpeg`/`requireMetaflac` for tools your test execs, `ensureFixturesExist(...)` for fixture sets, and a `beforeAll` that calls `isDockerAvailable()` and throws if `false`. See `test-packages/e2e-tests/src/docker-source/compilation-subsonic.test.ts` for the template.
3. Spawn containers via `startContainer({...})` from `../docker/index.js` — they're auto-registered for cleanup:

   ```ts
   import { startContainer, stopContainer } from '../docker/index.js';

   const result = await startContainer({
     image: 'service/image:latest',
     source: 'service-name',
     ports: ['0:8080'], // host port 0 → kernel assigns; multi-container concurrency safe
     env: ['CONFIG=value'],
   });
   ```

4. Use `withTarget` from `../targets/index.js` to scope each test to a fresh iPod (dummy by default).

See [test-packages/e2e-tests/README.md](../test-packages/e2e-tests/README.md) for the full layout.
