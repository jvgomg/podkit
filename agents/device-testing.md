# device-testing: Three-Tier Device Test Harness

Canonical reference for agents writing tests for device identification, doctor checks, and readiness pipelines. Read this before touching `@podkit/device-testing`, any file named `*.linux.tier3.test.ts`, or tasks in milestone m-19.

Also see [packages/device-testing/README.md](../packages/device-testing/README.md) for package-level API details, [ADR-016](../adr/adr-016-linux-vm-test-harness.md) for the full architecture decision, and [ADR-017](../adr/adr-017-device-persona-fixtures.md) for the fixture registry design.

## Purpose

`@podkit/device-testing` is the single package that supplies fixture data and the test runtime to every test tier. It exports:

- **`DevicePersona` registry** — typed fixtures describing real or synthetic devices (USB descriptors, SCSI VPD payloads, host-OS probe outputs, expected capabilities).
- **`SystemState` registry** — typed fixtures describing host-environment configurations (FFmpeg present/missing, udev rule installed/absent, SCSI permissions, etc.).
- **`TestRuntime` interface + runners** — abstraction over "where does the test execute?" (`local-linux` for Linux hosts; `lima-test-vm` for macOS dev hosts, forthcoming in TASK-322).
- **Subprocess snapshot framework** — `CapturingSubprocessRunner` and `ReplaySubprocessRunner` for deterministic subprocess testing.

The package ships no production code. It is a `devDependency` of packages that write device tests, never a runtime dependency.

## Three-tier architecture summary

| Tier | What runs | When it runs | Test filename pattern |
|------|-----------|-------------|----------------------|
| **T1** unit | Injectable TypeScript fakes | Always, every host | `*.test.ts` (no special tag) |
| **T2** native subprocess | Real subprocesses on the host | Always; skipped on wrong OS | `*.darwin.test.ts` / `*.linux.test.ts` |
| **T3** Linux VM | Full stack against `dummy_hcd` USB gadget | macOS + Lima, or Linux | `*.linux.tier3.test.ts` (forthcoming, TASK-322) |

See [ADR-016](../adr/adr-016-linux-vm-test-harness.md) for why three tiers are needed and why Docker is not suitable for Tier 3.

## `DevicePersona` schema

The full TypeScript interface lives in [`packages/device-testing/src/personas/types.ts`](../packages/device-testing/src/personas/types.ts). Nine top-level fields:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `string` | Stable registry key; used as the FunctionFS daemon's `--persona` flag |
| `description` | `string` | Human-readable label for logs and error messages |
| `schemaVersion` | `number` | Bump on any breaking field change; migrate all entries in the same commit |
| `usbDescriptor` | object | USB vendor/product IDs, serial, class/subclass/protocol |
| `sysInfoExtendedXml` | `string \| null` | SCSI VPD page 0xC0 payload; `null` for devices that don't answer |
| `lsblkJson` / `systemProfilerJson` / `diskutilPlist` | objects | Canned host-OS probe output (Linux, macOS, macOS) |
| `partitionLayout` | object | MBR partition table; used by readiness stage and T3 gadget setup |
| `massStorageBackingFile` | object \| null | FAT32 backing image info for mass-storage personas (Echo Mini, etc.) |
| `expectedCapabilities` / `expectedReadiness` / `expectedDoctorOutput` | typed | Golden-file assertions built into the fixture |
| `provenance` | object | Links to `provenance.md`; records hardware serial, capture date, operator |

### Starter persona set (v1)

Three personas ship with Phase 1 (TASK-321.02, forthcoming):

| ID | Device | Inquiry path |
|----|--------|-------------|
| `ipod-video-5g-fresh` | iPod 5G Video (MA147, iFlash mod) | SCSI fallback |
| `ipod-nano-7g-populated` | iPod nano 7G, ~5 000 tracks | USB inquiry |
| `echo-mini-empty` | FiiO Snowsky Echo Mini DAP | Mass-storage preset |

The registry lives in `src/personas/` (individual subdirectories) and is populated via TASK-321.02.

### Capture flow (human-in-the-loop)

1. Plug the physical device into the Mac.
2. Run `bun run packages/device-testing/scripts/capture-persona.ts --persona <id>` (forthcoming in TASK-321.02). The script captures `system_profiler SPUSBDataType -json`, `diskutil list -plist`, and USB descriptor fields automatically and prompts for the mount path.
3. For the Linux-side capture (`lsblk -J`): connect the device to a Linux machine or pass it through Lima USB passthrough; run the lsblk capture step inside the VM.
4. Commit the captured payloads alongside an auto-generated `provenance.md` (hardware serial, capture date, operator, script version).

**When to capture a new persona:** when adding support for a new device family, when changing the `DevicePersona` schema (re-capture to populate new fields), or when touching device-identification logic and you want a new fixture to pin regression coverage.

## `SystemState` registry

The full TypeScript interface is in [`packages/device-testing/src/system-states/types.ts`](../packages/device-testing/src/system-states/types.ts). Detailed guidance is in [`packages/device-testing/src/system-states/README.md`](../packages/device-testing/src/system-states/README.md).

### Starter state set (v1)

| ID | What it simulates |
|----|------------------|
| `healthy` | All system tools present; baseline; doctor exits 0 |
| `no-ffmpeg` | FFmpeg binary missing; transcoding unavailable; doctor exits 1 |
| `no-libgpod` | libgpod runtime missing; iPod database access fails; doctor exits 1 |
| `no-udev` | podkit udev rule not installed; SCSI access requires sudo; doctor exits 1 |
| `no-sg-perms` | `/dev/sg*` present but not readable by test user; doctor exits 1 |
| `corrupt-configfs` | configfs not mounted; USB gadget setup blocked; doctor exits 1 |

Each state carries `expectedDoctorSystemOutput` (the full `checks[]` array and `overallStatus`) and `expectedExitCode`, so assertions are co-located with the fixture rather than scattered across test files.

### Adding a new state

1. Create `src/system-states/<id>.ts` exporting a `const` typed as `SystemState`.
2. Add an import and registry entry in `src/system-states/index.ts`.
3. Add a named re-export to `src/index.ts`.
4. Run `bun run test --filter @podkit/device-testing` to confirm the golden file passes.

For Tier 3: once TASK-322 lands, also run the matching VM-mutation script and snapshot the VM as `base-<id>`.

## `TestRuntime` + runner selection

`TestRuntime` abstracts where a Tier 3 test executes. Two implementations:

- **`local-linux`** — runs the FunctionFS daemon as a subprocess on the current Linux host. Auto-registered when `@podkit/device-testing` is imported on Linux. Use on Linux dev hosts directly.
- **`lima-test-vm`** — wraps `local-linux` execution inside the Lima test VM at `tools/device-testing/lima/test-vm.yaml`. Use on macOS dev hosts. Forthcoming in TASK-322.04.

Auto-register pattern: importing `@podkit/device-testing` registers `local-linux` via `src/index.ts`. The `lima-test-vm` runner registers itself when its module loads. Tests call `getRunner(id)` and receive whichever backend is available. If neither is available, Tier 3 tests skip with a single-line warning.

## Test-file tagging convention

| Pattern | Runs on | Guard |
|---------|---------|-------|
| `*.test.ts` | Any OS | None (default) |
| `*.darwin.test.ts` | macOS only | `describe.skipIf(process.platform !== 'darwin')` |
| `*.linux.test.ts` | Linux only | `describe.skipIf(process.platform !== 'linux')` |
| `*.linux.tier3.test.ts` | Linux or macOS + Lima | Skip if `lima-test-vm` unavailable (forthcoming) |

See [agents/testing.md](testing.md) §"Per-OS Test Tagging" for the exact `describe.skipIf` pattern and the `console.log` placement that makes skips visible in CI output.

## Subprocess snapshot framework

`SubprocessRunner` is the DI seam every module uses instead of calling `execFile` or `spawn` directly. The interface lives in `@podkit/device-types`; the default (live) implementation is `defaultSubprocessRunner` from `@podkit/core`; capture and replay implementations live in `@podkit/device-testing`.

See [`packages/device-testing/src/subprocess.md`](../packages/device-testing/src/subprocess.md) for full docs. Quick reference:

**Capture fresh fixtures:**

```bash
PODKIT_SNAPSHOT_CAPTURE=1 \
PODKIT_SNAPSHOT_DIR=packages/device-testing/src/personas/ipod-video-5g-fresh/subprocess-fixtures \
bun run test:unit --filter @podkit/core -- device/platforms
```

**Replay in tests:**

```bash
PODKIT_SNAPSHOT_REPLAY=1 \
PODKIT_SNAPSHOT_DIR=packages/device-testing/src/personas/ipod-video-5g-fresh/subprocess-fixtures \
bun run test:unit --filter @podkit/core
```

**Factory** (`createSubprocessRunner(env)`): picks `CapturingSubprocessRunner`, `ReplaySubprocessRunner`, or `defaultSubprocessRunner` based on env vars. Throws if both capture and replay are set simultaneously.

**Where to put fixtures:**

| Path | When to use |
|------|-------------|
| `src/personas/<persona-id>/subprocess-fixtures/*.json` | Output depends on which device is plugged in (`lsblk`, `system_profiler`) |
| `fixtures/shared/*.json` | Environment-independent output (`ffmpeg -encoders`, `ffmpeg -version`) |

## Build pipeline

Single source of truth: `tools/prebuild/build-linux-glibc.sh`.

| Path | Purpose |
|------|---------|
| `tools/device-testing/lima/builder.yaml` | Builder VM — Debian 12.10 + full dev toolchain; produces linux-x64 glibc prebuilds + standalone binary |
| `tools/device-testing/lima/abi-verify.yaml` | ABI verify VM — stock Debian 12.10 + ffmpeg only; no dev packages; smoke-checks `ldd` |
| `tools/device-testing/lima/test-vm.yaml` | Test VM (forthcoming, TASK-322.01) — kernel modules + gpod-tool; runs T3 tests |

For the full operator manual, see [`tools/device-testing/lima/README.md`](../tools/device-testing/lima/README.md).

**Local build:**

```bash
mise run device-testing:build-linux   # turbo-cached; invokes builder VM
```

**CI:** `.github/workflows/prebuild.yml` invokes the same `build-linux-glibc.sh` script. No duplicated logic.

## Where to write a Tier 3 test

**TBD — forthcoming in TASK-322.** Test file placement, the `withTier3` helper, and the `testVm` fixture will be documented once the `lima-test-vm` runner lands. Reserve `*.linux.tier3.test.ts` filename pattern; do not create T3 test files before TASK-322.

## Cross-references

- [ADR-016](../adr/adr-016-linux-vm-test-harness.md) — three-tier architecture decision
- [ADR-017](../adr/adr-017-device-persona-fixtures.md) — `DevicePersona` + `SystemState` fixture registry design
- [packages/device-testing/README.md](../packages/device-testing/README.md) — package-level API and public exports
- [agents/testing.md](testing.md) — test stack overview, tagging convention, quick-reference commands
- [tools/device-testing/lima/README.md](../tools/device-testing/lima/README.md) — builder and ABI-verify VM operator manual
