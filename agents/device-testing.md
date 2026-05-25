# device-testing: Device Test Harness

Canonical reference for agents writing tests for device identification, doctor checks, and readiness pipelines. Read this before touching `@podkit/device-testing`, any file named `*.e2e.test.ts`, or tasks in milestone m-19.

Also see [test-packages/device-testing/README.md](../test-packages/device-testing/README.md) for package-level API details, [ADR-016](../adr/adr-016-linux-vm-test-harness.md) for the full architecture decision, and [ADR-017](../adr/adr-017-device-persona-fixtures.md) for the fixture registry design.

## Quick start (developer)

First time:

```bash
bun install
bun run harness:setup
bun run test:vm
```

Subsequent runs:

```bash
bun run harness:start  # if VM is stopped
bun run test:vm
bun run harness:stop   # when done
```

`bun run harness:status` prints a single-screen health check of the VM, binaries, systemd unit, and kernel modules. `bun run harness:install` re-runs the turbo builds and re-transfers everything (cheap; sha256-skips no-op transfers). All `harness:*` scripts dispatch into `test-packages/device-testing/scripts/harness.ts`.

## Purpose

`@podkit/device-testing` is the single package that supplies fixture data and the test runtime to every test tier. It exports:

- **`DevicePersona` registry** — typed fixtures describing real or synthetic devices (USB descriptors, SCSI VPD payloads, host-OS probe outputs, expected capabilities).
- **`SystemState` registry** — typed fixtures describing host-environment configurations (FFmpeg present/missing, udev rule installed/absent, SCSI permissions, etc.).
- **`TestRuntime` interface + runners** — abstraction over "where does the test execute?" (`local-linux` for Linux hosts; `lima-test-vm` for macOS dev hosts, landed in TASK-322).
- **`SubprocessRunner` re-exports** — the interface and default runner, re-exported for tests that need a single import path.

The package ships no production code. It is a `devDependency` of packages that write device tests, never a runtime dependency.

## Device test stack summary

| Level | What runs | When it runs | Test filename pattern |
|-------|-----------|-------------|----------------------|
| **Unit** | Injectable TypeScript fakes | Always, every host | `*.test.ts` (no special tag) |
| **Host** native subprocess | Real subprocesses on the host | Always; skipped on wrong OS | `*.darwin.test.ts` / `*.linux.test.ts` |
| **VM** Linux test VM | Full stack against `dummy_hcd` USB gadget | macOS + Lima via `bun run test:vm` | `*.e2e.test.ts` |

See [ADR-016](../adr/adr-016-linux-vm-test-harness.md) for the architecture decision and why Docker is not suitable for VM tests.

## `DevicePersona` schema

The full TypeScript interface lives in [`test-packages/device-testing/src/personas/types.ts`](../test-packages/device-testing/src/personas/types.ts). Top-level fields (schema v3):

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `string` | Stable registry key; used as the FunctionFS daemon's `--persona` flag |
| `description` | `string` | Human-readable label for logs and error messages |
| `schemaVersion` | `3` | Bump on any breaking field change; migrate all entries in the same commit |
| `usbDescriptor` | object | USB vendor/product IDs, serial, class/subclass/protocol + configuration/interface/endpoint hierarchy |
| `sysInfoExtendedXml` | `string \| null` | SCSI VPD page 0xC0 payload; `null` for devices that don't answer |
| `lsblkJson` / `systemProfilerJson` / `diskutilPlist` | objects | Canned host-OS probe output (Linux, macOS, macOS) |
| `partitionLayout` | object | Per-LUN partition tables; used by readiness stage and T3 gadget setup |
| `massStorageBackingFile` | object \| null | FAT32 backing image info for mass-storage personas (Echo Mini, etc.) |
| `provenance` | object | Links to `provenance.md`; records hardware serial, capture date, operator |

**Schema v3 (2026-05-25):** the expectation fields `expectedCapabilities`, `expectedReadiness`, and `expectedDoctorOutput` were lifted out of `DevicePersona` and now live in `@podkit/e2e-vm-tests/src/expectations/<persona-id>.ts` (with an aggregated `expectations` map in `index.ts`). The persona fixture carries only inputs; tests own their assertion shape. See [ADR-017 §"Schema v3"](../adr/adr-017-device-persona-fixtures.md).

### Starter persona set

TASK-321.02 captured 14 personas — far beyond the originally-planned 3 starters. The 3 starter aliases (used by the VM-test baseline tests) map to:

| Starter alias | Captured persona ID | Inquiry path |
|-----------------------------|---------------------|-------------|
| `ipod-video-5g-fresh` | `ipod-video-5g-iflash-1tb` | SCSI fallback |
| `ipod-nano-7g-populated` | `ipod-nano-7g-space-gray` | USB inquiry |
| `echo-mini-empty` | `echo-mini` | Mass-storage preset |

The mapping lives in `test-packages/device-testing/src/vm/vm-runtime-setup.ts` (`STARTER_PERSONA_IDS`). The registry lives in `src/personas/` (one subdirectory per persona) and is enumerated by `src/personas/index.ts`. Additional captures + remaining synthesised personas are tracked in TASK-324 (Phase 5).

### Synthesised personas (no hardware)

Five personas have no physical-hardware capture — they exercise rejection / error paths and content-state variants that cannot be driven from real devices alone:

| Persona ID | Purpose |
|------------|---------|
| `ipod-shuffle-not-supported` | Apple unsupported-PID rejection (shuffle 3G `0x05ac:0x1302`). |
| `non-ipod-usb-disk` | Non-Apple vendor-no-preset rejection (SanDisk Cruzer Blade `0x0781:0x5567`). |
| `malformed-sysinfo` | SIE-parser error path. Real iPod 5G USB identity + deliberately-truncated SIE XML. |
| `echo-mini-populated` | State variant of `echo-mini` with five 64-byte sentinel `.mp3` files seeded into `Music/`. Exercises the "populated mass-storage device" sync-target path. |
| `ipod-video-5g-corrupt-db` | State variant of `ipod-video-5g-iflash-1tb` with a 512-byte truncated iTunesDB (`mhbd` magic + zeros) seeded at `iPod_Control/iTunes/iTunesDB`. Exercises the database-parse failure surface (parser throws "mhbd header too small"). |

Each has a `provenance.md` documenting its synthesis recipe (no `raw/` capture session). Smoke tests in `src/personas/rejection-personas.test.ts` and `src/personas/malformed-sysinfo.test.ts` pin the fixture shapes; the two state-variant personas seed their FAT32 backing images via `synthesis.initialContent` (see "Mass-storage backing files" below).

### Raw-fixture imports (do not `readFileSync` at module-eval)

Every persona's raw fixtures (XML, plist, JSON, lsblk dumps, etc.) are
imported directly with Bun's import-attribute syntax:

```ts
import sysInfoExtendedXml from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist       from './raw/diskutil.plist'      with { type: 'text' };
import systemProfilerJson  from './raw/system-profiler.json' with { type: 'json' };
import lsblkJson           from './raw/lsblk.json'          with { type: 'json' };

export const myPersona: DevicePersona = {
  // ...
  sysInfoExtendedXml,
  systemProfilerJson,
  diskutilPlist,
  lsblkJson,
  // null fields stay plain — no import needed.
};
```

The Bun bundler inlines the file's contents as a string or object literal
directly into `dist/index.js` at build time. At dev time (running TS
directly), Bun's loader resolves the file without ever calling
`fs.readFileSync`. Either way, module-eval performs zero filesystem I/O.

This matters because importing `personas` from outside `@podkit/device-testing`
used to crash with `ENOENT`: the bundler doesn't copy `raw/` directories
into `dist/`, and even before bundling the persona registry coupled its
load order to filesystem state. The smoke test
[`src/personas/no-fs-at-load.test.ts`](../test-packages/device-testing/src/personas/no-fs-at-load.test.ts)
pins the contract by spawning a subprocess that patches `fs.readFileSync`
before importing the registry and asserts the call count stays at zero.

**Why this pattern over alternatives:**

- **Direct `import` (no codegen)** — readers see the actual file the data
  comes from, not a generated base64 blob. Diffs of raw fixtures are
  meaningful in code review; the imports themselves never churn.
- **No build step** between editing a raw fixture and running tests.
  Just save the file.
- **Bun-native** — text + JSON loaders ship in the runtime and bundler;
  no plugin, no preprocessor.

**TypeScript declarations.** TypeScript doesn't ship built-in
declarations for `*.xml` / `*.plist` / `*.txt` imports. Ambient
declarations live in
[`test-packages/device-testing/src/personas/text-imports.d.ts`](../test-packages/device-testing/src/personas/text-imports.d.ts)
and apply to every persona in the registry. JSON imports are handled by
`resolveJsonModule: true` in the workspace `tsconfig.json`.

**When you add a new persona:**

1. Drop the raw capture files in `src/personas/<id>/raw/` as usual.
2. In `persona.ts`, `import` each raw fixture directly with the
   appropriate `with { type: ... }` attribute (`text` for XML / plist /
   any string blob, `json` for JSON).
3. Assign the imported binding to the matching `DevicePersona` field
   (no getter wrapper needed — the import already evaluates to the
   final value).
4. Never call `readFileSync` at module top level. Never resolve paths
   relative to `import.meta.url` for raw fixtures — the bundler will
   collapse the URL and the resolution will silently break.

### Capture flow (human-in-the-loop)

See [`documents/persona-capture-playbook.md`](../documents/persona-capture-playbook.md) for the full step-by-step (the playbook supersedes the auto-capture script originally planned in TASK-321.02). High-level:

1. Plug the physical device into the Mac.
2. Run the macOS-side capture commands documented in the playbook (`system_profiler SPUSBDataType -json`, `diskutil list -plist`, USB descriptor fields).
3. For the Linux-side capture (`lsblk -J`): connect the device to a Linux machine or pass it through Lima USB passthrough; run the lsblk capture step inside the VM.
4. Commit the captured payloads alongside a hand-written `provenance.md` per the playbook template (hardware serial, capture date, operator).

**When to capture a new persona:** when adding support for a new device family, when changing the `DevicePersona` schema (re-capture to populate new fields), or when touching device-identification logic and you want a new fixture to pin regression coverage.

### Mass-storage backing files (FAT32 synthesis)

Personas that drive `usb_f_mass_storage` (Echo Mini today; future Sony Walkman variants) declare a `massStorageBackingFile.synthesis` recipe instead of committing a multi-MiB binary fixture. The lima-test-vm runner synthesises the image inside the VM via `truncate` + `mkfs.vfat --invariant` — byte-deterministic and cheap (~100 ms per persona, dominated by limactl round-trip).

Two seeding paths:

- **Empty backing image** — set `synthesis: { sizeMiB, filesystem: 'FAT32', label }` only. The image is formatted and left empty. Used by `echo-mini` (sync-target detection on an empty device).
- **Seeded backing image** — add `synthesis.initialContent: Array<{path, sourceFixture}>`. `path` is the in-image absolute path (no leading `/`, ASCII-safe charset only). `sourceFixture` is the persona-relative host path (e.g. `./raw/iTunesDB`). The runner `limactl copy`s each fixture into a per-persona scratch dir, then `mcopy`s into the post-`mkfs.vfat` image with `SOURCE_DATE_EPOCH` fixed so the seeded bytes don't perturb determinism. Used by `echo-mini-populated` and `ipod-video-5g-corrupt-db`.

Determinism contract: two runs of the same persona must produce a byte-identical sha256. The runner's `EnsureBackingFileResult.sha256` is the tripwire — assert it in your test if you depend on byte-stability. See `src/vm/backing-file-content.e2e.test.ts` for the canonical determinism check (one `it` runs `ensureBackingFile` twice and compares).

**Runner implementation:** `test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts` (`ensureBackingFile`, `resolveSeedEntries`, `buildSeedCommands`). Persona-side validation runs up front on the host so a bad `initialContent` entry surfaces before the VM is touched.

**VM provisioning prerequisites** for seeding: `mtools` package (provides `mcopy` + `mmd`), provisioned by `test-packages/device-testing/lima/podkit-device-harness.yaml`. Operates on partition-less FAT32 images via `MTOOLS_SKIP_CHECK=1`.

## `SystemState` registry

The full TypeScript interface is in [`test-packages/device-testing/src/system-states/types.ts`](../test-packages/device-testing/src/system-states/types.ts). Detailed guidance is in [`test-packages/device-testing/src/system-states/README.md`](../test-packages/device-testing/src/system-states/README.md).

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

For VM tests: once TASK-322 lands, also run the matching VM-mutation script and snapshot the VM as `base-<id>`.

## `TestRuntime` + runner selection

`TestRuntime` abstracts where a VM test executes. Two implementations:

- **`local-linux`** — runs the FunctionFS daemon as a subprocess on the current Linux host. Auto-registered when `@podkit/device-testing` is imported on Linux. Use on Linux dev hosts directly.
- **`lima-test-vm`** — wraps `local-linux` execution inside the Lima test VM at `test-packages/device-testing/lima/podkit-device-harness.yaml`. Use on macOS dev hosts. Forthcoming in TASK-322.04.

Auto-register pattern: importing `@podkit/device-testing` registers `local-linux` via `src/index.ts`. The `lima-test-vm` runner registers itself when its module loads. Tests call `getRunner(id)` and receive whichever backend is available.

## Test-file tagging convention

| Pattern | Runs on | Guard |
|---------|---------|-------|
| `*.test.ts` | Any OS | None (default) |
| `*.darwin.test.ts` | macOS only | `describe.skipIf(process.platform !== 'darwin')` |
| `*.linux.test.ts` | Linux only | `describe.skipIf(process.platform !== 'linux')` |
| `*.e2e.test.ts` | Linux or macOS + Lima | Excluded from default `bun test`; run via `bun run test:vm` |

See [agents/testing.md](testing.md) §"Per-OS Test Tagging" for the exact `describe.skipIf` pattern and the `console.log` placement that makes skips visible in CI output.

## SubprocessRunner DI seam

`SubprocessRunner` is the DI seam every module uses instead of calling `execFile` or `spawn` directly. The interface lives in `@podkit/device-types`; the default (live) implementation is `defaultSubprocessRunner` from `@podkit/core`. Both are re-exported from `@podkit/device-testing` for tests that need a single import path.

Tests inject a fake `SubprocessRunner` — typically a hand-rolled stub that returns canned stdout for each command the module under test invokes:

```ts
import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-testing';

function makeStubRunner(responses: Record<string, SubprocessRunResult>): SubprocessRunner {
  return {
    async run(command, args) {
      const key = [command, ...args].join(' ');
      const result = responses[key];
      if (!result) throw new Error(`No stub for: ${key}`);
      return result;
    },
  };
}
```

Pass the stub as the `subprocess` option to the module under test — the same DI seam production uses for the real `execFile`-backed runner.

## Build pipeline

Single source of truth: `tools/prebuild/build-linux-glibc.sh`.

| Path | Purpose |
|------|---------|
| `test-packages/device-testing/lima/podkit-linux-builder.yaml` | Builder VM — Debian 12.10 + full dev toolchain; produces linux-x64 glibc prebuilds + standalone binary |
| `test-packages/device-testing/lima/podkit-abi-verify.yaml` | ABI verify VM — stock Debian 12.10 + ffmpeg only; no dev packages; smoke-checks `ldd` |
| `test-packages/device-testing/lima/podkit-device-harness.yaml` | Test VM (`podkit-device-harness`, TASK-322.01) — kernel modules + gpod-tool runtime libs; runs T3 tests |

For the full operator manual, see [`test-packages/device-testing/lima/README.md`](../test-packages/device-testing/lima/README.md).

**Local build:**

```bash
mise run device-testing:build-linux   # turbo-cached; invokes builder VM
```

**CI:** `.github/workflows/prebuild.yml` invokes the same `build-linux-glibc.sh` script. No duplicated logic.

## Where to write a VM test

VM tests live in two packages:

- **`test-packages/device-testing/src/vm/`** — harness self-tests (e.g. `personas-baseline.e2e.test.ts`, `backing-file-content.e2e.test.ts`). Anything that pins the harness's own correctness (persona grouping, backing-file byte-determinism, daemon lifecycle smoke). These tests use relative imports into the harness because they ARE the harness's tests.
- **`test-packages/e2e-vm-tests/src/`** — podkit feature tests (e.g. `discovery.e2e.test.ts`, `doctor-output-contract.e2e.test.ts`, `mass-storage-binding.e2e.test.ts`). Anything that exercises the podkit binary against a synthesised persona. These tests import everything from `@podkit/device-testing` — never reach into the harness's relative file layout.

Reference implementation for harness self-tests: `test-packages/device-testing/src/vm/personas-baseline.e2e.test.ts`. Reference for podkit feature tests: `test-packages/e2e-vm-tests/src/discovery.e2e.test.ts`.

**Filename:** `*.e2e.test.ts` under the appropriate package's `src/` (harness self-tests stay under `src/vm/`; feature tests live at `src/` root of `@podkit/e2e-vm-tests`). The `bunfig.toml` `pathIgnorePatterns` in both packages excludes `*.e2e.test.ts` from the default `bun test` run; `bun run test:vm` opts them back in by passing the test directory explicitly.

**Imports (podkit feature tests in `@podkit/e2e-vm-tests`):** Everything comes from `@podkit/device-testing`:
- `limaTestVmRunner` — the `TestRuntime` implementation that executes commands inside `podkit-device-harness`.
- `groupPersonasByState`, `resolveStarterPersonas`, `VM_WARM_TIMEOUT_MS`, `VM_COLD_TIMEOUT_MS`.
- `withPersona`, `runJsonCommand`.
- Persona + `SystemState` named exports (`ipodVideo5gIflash1tb`, `echoMini`, `healthy`, etc.).

**Suite shape** — prepare/teardown, then one `describe` per state group (no availability gate in the file — the preflight handles that):

```ts
const groups = groupPersonasByState(resolveStarterPersonas());

describe('my VM suite', () => {
  beforeAll(() => limaTestVmRunner.prepare(),  VM_COLD_TIMEOUT_MS);
  afterAll(()  => limaTestVmRunner.teardown(), VM_COLD_TIMEOUT_MS);

  for (const group of groups) {
    describe(`SystemState: ${group.state.id}`, () => {
      beforeAll(() => limaTestVmRunner.applyState(group.state), VM_COLD_TIMEOUT_MS);
      for (const persona of group.personas) {
        it('exercises X', async () => {
          const result = await withPersona({ persona }, () =>
            runJsonCommand(limaTestVmRunner, '/usr/local/bin/podkit …', VM_WARM_TIMEOUT_MS)
          );
          // assertions on result.parsed / result.exitCode
        }, VM_WARM_TIMEOUT_MS);
      }
    });
  }
});
```

**Running VM tests locally:**

```bash
bun run harness:install                    # builds podkit + dummy-hcd-daemon, transfers everything (sha256-skips no-ops)
bun run test:vm                            # from repo root (or: bun run --cwd test-packages/device-testing test:vm)
```

`bun run harness:setup` is the first-time superset (creates the VM, starts it, then runs `harness:install`). See §"Quick start" above. `mise run device-testing:build-linux` still works for build-only invocations (the harness install script uses the same turbo task internally).

VM tests are excluded from the default `bun test` run via `bunfig.toml`
`pathIgnorePatterns`. The `test:vm` script passes `src/vm` explicitly,
which overrides the ignore pattern.

**Preflight contract:** `bun run test:vm` runs `podkit-vm-preflight` before the test suite. If the Lima VM is not reachable, the preflight exits 1 with a remediation message pointing at `bun run harness:setup` / `harness:start` / `harness:status`. No tests run and nothing is silently skipped. To run non-VM tests instead, use `bun run test:unit` or `bun run test:integration`.

**Do NOT add skipped tests for assertions blocked on a dep task** — pause
that stream of work in code and document the dependency in the backlog
task. The reference test file documents this convention in its header.

### Multi-daemon VM tests

The `dummy-hcd-daemon@<persona>.service` systemd template derives its
configfs gadget directory (`podkit-<persona>`) and FunctionFS mountpoint
(`/dev/ffs-podkit-<persona>`) from the persona id, so two units start
side-by-side without colliding on either kernel resource. Two
infrastructure pieces back this:

- `dummy_hcd num=4` (via `/etc/modprobe.d/podkit-device-harness-dummy-hcd.conf`)
  exposes four virtual UDCs at `/sys/class/udc/dummy_udc.{0..3}`.
- `attachUdc` in `test-packages/device-testing-daemon/src/gadget.ts` walks
  `/sys/kernel/config/usb_gadget/*/UDC` and picks the first UDC not
  already claimed. Caller (VM test / runner) must serialise
  `systemctl start` invocations — the read-then-write is not atomic.

Reference test: `test-packages/e2e-vm-tests/src/dual-daemon-lifecycle.e2e.test.ts`. Boots
two personas concurrently, asserts both configfs trees + extra `/dev/sg*`
nodes, verifies clean teardown.

## Cross-references

- [ADR-016](../adr/adr-016-linux-vm-test-harness.md) — device test stack architecture decision
- [ADR-017](../adr/adr-017-device-persona-fixtures.md) — `DevicePersona` + `SystemState` fixture registry design
- [test-packages/device-testing/README.md](../test-packages/device-testing/README.md) — package-level API and public exports
- [agents/testing.md](testing.md) — test stack overview, tagging convention, quick-reference commands
- [test-packages/device-testing/lima/README.md](../test-packages/device-testing/lima/README.md) — builder and ABI-verify VM operator manual
