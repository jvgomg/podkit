---
title: "ADR-016: Linux VM Test Harness"
description: Device test stack for device-discovery code using injectable transports, native subprocess tests, and a Linux test VM with dummy_hcd for real kernel-level USB gadget simulation. Builder VM and test VM are physically separated to prevent dev libraries from masking binary linkage issues.
sidebar:
  order: 17
---

# ADR-016: Linux VM Test Harness

## Status

**Accepted**

## Context

The m-18 device-capability architecture introduced a layered inquiry pipeline spanning USB control transfers, SCSI `INQUIRY`/`IDENTIFY` commands, `lsblk`/`system_profiler`/`diskutil` parsing, device classification, and capability resolution. The CLI doctor surface adds its own layer of checks on top of this pipeline.

Testing this pipeline adequately requires exercising three qualitatively different things:

1. **Logic correctness** — does the parsing, classification, and synthesis code do the right thing for a given input?
2. **Host subprocess integration** — does the code correctly invoke `ffmpeg`, `gpod-tool`, `lsblk`, `system_profiler`, `diskutil`, and handle their real output on each host OS?
3. **Kernel-level USB/SCSI integration** — does the full stack (libusb, `SG_IO`, `lsblk`, kernel udev) behave correctly against a real virtual device seen through the actual OS device model?

No single test environment satisfies all three requirements. Mocks cannot substitute for real subprocess invocations; real subprocess invocations on a dev host cannot manufacture a USB device node that libusb, `SG_IO`, and `lsblk` all see. A dedicated kernel-level environment is needed for VM tests.

A second concern motivates this ADR: **dev libraries on the host PATH have historically masked binary linkage problems**. The compiled `podkit` binary statically links libgpod (matching the homebrew and Docker distributions), but a developer's host typically has `libgpod-dev`, koffi development copies, etc. installed, which can shadow the bundled artefacts and let a broken binary pass its tests. The test environment must contain **only what a real user has** — no dev tooling, no source tree.

## Decision Drivers

- Tests must run on every developer host (mac, linux, windows) without special permissions or hardware
- Host subprocess behaviour (real `lsblk`, real `system_profiler`, real `ffmpeg`) must be tested on each OS, not mocked out
- The full inquiry stack must be testable against a synthetic iPod that real libusb/`SG_IO`/`lsblk` see as a real device
- The test environment **must not contain dev tools, Bun, Node, node_modules, or the source tree** — only the compiled binary and the system packages a real user would have
- `bun run test` must succeed in under a minute on a warm Turbo cache with no external services
- CI builds artefacts (prebuild.yml, build-platform.yml) but does not execute the test suite

## Options Considered

### Option A: Single tier — mocks only

Test the entire pipeline with injectable mock transports. No subprocess tests, no VM.

**Pros:** Simple. Runs everywhere instantly.

**Cons:** Subprocess invocations (`lsblk`, `system_profiler`, `diskutil`) are entirely untested. The logic-mock gap is wide enough that a real device could fail in ways unit tests cannot detect. Historically, the most common class of bugs in device identification has been in subprocess output parsing, not in synthesis logic.

### Option B: Two tiers — mocks + native subprocess

Add per-OS tagged tests that invoke real subprocesses with canned fixtures. Still no VM.

**Pros:** Closes the subprocess gap. Runs on every host.

**Cons:** The kernel layer (libusb enumeration, SG_IO over a real device node, udev `lsblk` output, SCSI VPD responses) is still mocked. This tier cannot catch regressions in the USB gadget interaction itself.

### Option C: Three tiers — mocks + native subprocess + Linux test VM (Chosen)

Add a third tier that runs the full inquiry stack against a synthetic USB device served by a FunctionFS userspace daemon inside a Linux environment with `dummy_hcd` loaded. **The test environment is a dedicated minimal VM physically isolated from the build environment**, so dev libraries cannot mask binary issues.

**Pros:** Closes all three gaps. The VM tier is opt-in and Turbo-cached, so the cost on cache hit is zero. Catches the dev-library-shadowing bug class.

**Cons:** New infrastructure. Requires a FunctionFS daemon, two new Lima VM configurations (builder + test), a `test-packages/device-testing/` package, and a state-layering mechanism via `apply-state.sh`. `dummy_hcd` is unavailable in Docker Desktop's LinuxKit kernel and in GH Actions `ubuntu-latest`'s Azure-flavor kernel, so VM tests run on developer mac hosts only (see "CI: build-only" section below).

## Decision

**Option C: three-tier test architecture, with strict builder/test VM separation for Tier 3.**

### Unit tests: injectable transports

Pure TypeScript tests that inject fake transports into existing injectable interfaces:

- `UsbBinding` — USB control transfer responses
- `ScsiSyscall` — raw SCSI command responses
- `ProbeFsPlatform` / `ProbeFs` / `UsbLoader` — filesystem probe and USB enumeration results
- `SubprocessRunner` — `ffmpeg`, `lsblk`, `system_profiler`, `diskutil` outputs (hand-rolled stubs returning canned stdout)

These interfaces already exist in `packages/ipod-firmware/` and `packages/podkit-core/`. Unit tests import TypeScript objects directly from `@podkit/device-testing` (see ADR-017) and inject them as the transport layer.

**Runs on:** every host (mac, linux, windows). Always on.

### Host tests: native integration tests

Tests that invoke real subprocesses against real fixtures on disk:

- `ffmpeg -version` and `ffmpeg -encoders` parsing
- `gpod-tool` invocation and JSON output
- `lsblk -J` output parsing (Linux)
- `system_profiler SPUSBDataType -json` output parsing (mac only)
- `diskutil list -plist` output parsing (mac only)

Test files are tagged by OS suffix: `*.darwin.test.ts` runs only on macOS; `*.linux.test.ts` runs only on Linux. The Bun test runner skips files whose tag does not match the current host.

**Runs on:** mac and linux hosts natively. Windows via WSL2 (future). Always on.

### VM tests: Linux test VM integration tests

The full inquiry pipeline — USB enumeration, SCSI VPD, `lsblk`, capability resolution — is exercised against synthetic USB devices created by a FunctionFS userspace daemon. The daemon loads a `DevicePersona` (see ADR-017) at startup and serves the USB descriptors, SCSI VPD responses, and filesystem structure that the persona defines. The host Linux kernel sees a real device node via `dummy_hcd`.

**Builder VM / test VM split** (the cornerstone of this ADR):

| VM | Yaml | Role | Contents |
|----|------|------|----------|
| **Builder VM** | `test-packages/device-testing/lima/podkit-linux-builder.yaml` | Compiles native prebuilds + standalone binary; runs only when source changes (turbo-cached) | Debian 12.10 + Bun, Node, build-essential, libgpod-dev, libglib2.0-dev, etc. |
| **Test VM** | `test-packages/device-testing/lima/podkit-device-harness.yaml` | Runs the test suite against the compiled binary | Debian 12.10 + ffmpeg, `dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, `usb_f_fs`, FunctionFS daemon binary, gpod-tool binary, and `/usr/local/bin/podkit` (compiled statically-linked binary). **NO Bun, NO Node, NO node_modules, NO source tree, NO libgpod-dev or other -dev packages.** |

Both Lima yamls pin Debian to the exact point release (`debian-12.10` or the current stable 12.x point release at time of setup) to ensure reproducible kernel version and module availability. The disk field is set to the smallest viable size (5–8 GB) for each VM.

The binary moves from builder VM to test VM via `limactl copy` (or equivalent atomic copy). The test VM never has access to the source tree or developer dependencies. If the binary references something it should bundle (a koffi prebuild, a glib symbol path, an iTunesDB schema file), the test fails because dev libraries aren't around to mask it.

**What gpod-tool is and is not:** `gpod-tool` is a test-time dependency only. It is produced by `@podkit/gpod-testing` (via the `@podkit/gpod-testing#build:linux-binary` turbo task, which compiles `tools/gpod-tool/Makefile` inside the builder VM against apt's `libgpod-dev`) and is always installed into the test VM by `bun run harness:install` — the harness treats it as required and fails fast if the binary is missing. It is **not** bundled into the podkit binary and is **not** required to build podkit.

**State layering via `apply-state.sh`**:

Doctor system-scope checks (FFmpeg, libgpod, libusb, SCSI transport, udev rule, sg permissions) need to be tested against **manipulated system state**, not just mocked. We do this in the test VM by staging and running an in-VM `apply-state.sh` script for each `SystemState` group:

- Before each test group, `applyState(stateId)` copies `test-packages/device-testing/scripts/apply-state.sh` into the VM, makes it executable, and runs `sudo apply-state.sh <stateId>`.
- The script performs the required mutations (e.g. `apt remove ffmpeg`, permission changes, modprobe manipulation) to bring the VM to the named state.
- State definitions live in `test-packages/device-testing/src/system-states/`.

Each `applyState` call takes ~800ms. The current 6-state matrix adds ~5s of state-change overhead per full pass — negligible.

**Infrastructure components:**

| Component | Location | Purpose |
|-----------|----------|---------|
| FunctionFS daemon | `test-packages/device-testing-daemon/` | Userspace daemon; synthesises USB gadget responses (vendor control transfers, mass-storage backing file) from a `DevicePersona` JSON payload |
| Builder Lima yaml | `test-packages/device-testing/lima/podkit-linux-builder.yaml` | Debian 12.10 VM with dev toolchain; produces linux-x64 prebuilds + standalone binary |
| Test Lima yaml | `test-packages/device-testing/lima/podkit-device-harness.yaml` | Debian 12.10 VM with kernel modules + ffmpeg + gpod-tool only; runs the test suite against the binary |
| `test-packages/device-testing/` | Harness library + self-tests | `DevicePersona` + `SystemState` registries, `TestRuntime` interface, `local-linux` + `lima-test-vm` runners, `SubprocessRunner` re-exports, plus the harness's own e2e self-tests (`personas-baseline`, `backing-file-content`) |
| `test-packages/e2e-vm-tests/` | podkit feature VM tests | Pure consumer of `@podkit/device-testing`; exercises `podkit device scan`, `doctor`, discovery reconciliation, dual-daemon lifecycle, mass-storage binding, etc. against synthesised personas. Mirrors how `@podkit/e2e-tests` is a test app that imports podkit. |

**VM test backends:**

The `TestRuntime` interface abstracts how a test connects to the Linux environment. Two implementations ship:

- `local-linux` — runs the FunctionFS daemon as a subprocess on the current host. Used on Linux dev hosts directly.
- `lima-test-vm` — wraps `local-linux` execution inside a Lima test VM using `test-packages/device-testing/lima/podkit-device-harness.yaml`. Used on macOS dev hosts.

One test file, swappable backend. Tests do not need to know which backend is active.

**Opt-in detection:** `bun run test:vm` detects VM availability at runtime:
1. If running on Linux: `local-linux` is available; VM tests run.
2. If running on macOS and Lima is installed with the test VM instance reachable: `lima-test-vm` is available; VM tests run.
3. Otherwise: VM tests are skipped with a single-line warning (`[vm] Linux VM not available — skipping device integration tests`).

Turbo caches VM test results against the `test-packages/device-testing-daemon/`, `test-packages/device-testing/`, and `test-packages/e2e-vm-tests/` input sets, so the cost on cache hit is zero regardless of platform.

### Binary quality parity

The test harness exercises the **same statically-linked binary** that ships via homebrew and Docker. There is no test-only build flavor and no test-specific linker flags. libgpod is statically linked at build time into both `@podkit/libgpod-node` (the N-API native addon) and the standalone podkit binary. This ensures:

- A binary linkage bug that would manifest for homebrew users is caught by VM tests before it ships.
- The test VM's deliberate absence of `-dev` packages means a dynamic-link regression (missing `.so` at runtime) surfaces as a test failure rather than passing silently because the dev machine happened to have `libgpod.so` on PATH.
- `ldd /usr/local/bin/podkit` in the test VM must show only stable system libraries (glibc, libpthread, etc.); any unresolved libgpod symbol indicates a build regression.

### Build tooling: one implementation, two callers

The builder VM and the existing GHA workflows share native-build code. There is one source of truth:

- **`tools/prebuild/build-static-deps.sh`** — builds all static C dependencies (libgpod, gdk-pixbuf, glib, libplist, etc.). Already used by `.github/workflows/prebuild.yml` and `.github/workflows/build-platform.yml`.
- The builder VM's provisioning invokes this same script (or a thin glibc-specific wrapper that calls it) before running `bunx prebuildify --napi --strip` and `bun build --compile`.
- The GHA workflows are refactored (as part of TASK-321.07) so they invoke the shared script via a turbo task or a new thin wrapper — no shell commands duplicated between the Lima yaml and the GHA workflow.

The musl variant (Alpine, used by `podkit-docker`) continues to build via the existing GHA Alpine container path — out of scope for the builder VM, no regression intended.

### Test speed strategy

VM tests can be slow if every test re-applies state independently. To keep the suite tractable:

**Group tests by required `SystemState`:** the test orchestrator collects all tests that require the same `SystemState`, runs `applyState` once for that group, then runs all tests in the group sequentially against that single applied state. State application happens once per group, not once per test.

**Snapshot-based state layering (historical):**

The original design called for `limactl snapshot apply` (~1s per restore) to layer system states on top of a `base-healthy` snapshot, with names like `base-no-ffmpeg`, `base-no-libgpod`, etc. `applyState` would check whether `base-<stateId>` existed (fast path: restore), or fall back to running `apply-state.sh` and capturing a new snapshot (slow path).

This design was never reachable on the deployed hardware. Lima 2.x's default driver on Apple Silicon is `vz` (Apple Virtualization framework); `limactl snapshot {create,apply,delete}` exits with `level=fatal msg=unimplemented` on `vz` — snapshots are QEMU-only in Lima 2.x. Every snapshot call silently no-oped, and `apply-state.sh`-every-time was the actual behaviour in all real test runs.

Measured `apply-state.sh` cost on `podkit-device-harness` (aarch64): ~800ms per state. The 6-state matrix adds ~5s per full pass — negligible.

**As of May 2026**, the snapshot codepath was deleted entirely. `applyState` is now a single path: stage `apply-state.sh` → chmod → exec. No fast/slow paths, no `base-<state-id>` snapshot tags, no snapshot creation or restore.

If Lima `vz` ever gains snapshot support, the optimisation can be reintroduced. Until then, YAGNI.

**Future optimisations (documented, not implemented now):**

- **Parallel VM execution:** run multiple VM instances concurrently, each handling a different `SystemState` group. Requires a second Lima instance or QEMU instance per parallel slot. Documented as a scaling option when the test matrix outgrows sequential-per-group.
- **Prebuilt snapshot caching:** ship pre-snapshotted VM disk images as CI artefacts (or store them in a Lima-compatible registry). Eliminates the one-time snapshot-creation cost on first-run developer onboarding (only viable if/when the underlying driver supports snapshots).

### Mass storage backing file

For mass-storage device personas (Echo Mini, generic mass storage), the gadget presents a FAT32 block device to the kernel via `usb_f_mass_storage`. This backing file is **separate from the VM disk image** — it is a dedicated FAT32 image file staged inside the test VM at a known path.

Tests that mutate iPod/device state (e.g. `podkit sync` writing to the device) mutate this backing file. The backing file must be reset between tests to ensure isolation. Two reset strategies:

1. **Per-test copy from a reference image:** before each test, copy the persona's canonical FAT32 image to the backing-file path. Simple; slightly slower for large images.
2. **Pre-built image swap:** stage a separate reference copy of the FAT32 image alongside the active backing file. A reset is an atomic file rename/swap. Faster for large images.

The `DevicePersona` schema includes an optional `massStorageBackingFile` field (see ADR-017) that either points to a pre-built FAT32 image committed to the persona directory, or describes a synthesis recipe (partition size, filesystem type, initial content) that the runner materialises before the first test in a group.

When `massStorageBackingFile` is set, the `lima-test-vm` runner stages the FAT32 image to the known backing-file path in the test VM during `prepare()`. Between tests within the same group, the runner resets the backing file using whichever strategy is configured for the persona.

**Echo Mini is included as a starter mass-storage persona** (`echo-mini-empty`). The persona set is designed to be extensible — Rockbox, FiiO, and other mass-storage devices can be added later following the same `DevicePersona` pattern.

### Native build pipeline (shared with existing GHA)

The builder VM produces two artefacts via turbo-cached tasks:

- `build:linux-prebuild` — `@podkit/libgpod-node` linux-x64 glibc prebuild
- `build:linux-binary` — podkit standalone binary via `bun build --compile --target=bun-linux-x64`

Critical constraint: the builder VM **must share its native-build implementation with the existing `.github/workflows/prebuild.yml`** (which builds glibc + musl variants of libgpod-node prebuilds via `tools/prebuild/build-static-deps.sh`). No duplicated build commands. Either the builder VM invokes the same shared script the GHA workflow invokes, or the GHA workflow is refactored to invoke the new turbo task. Either way: one source of truth. See TASK-321.07.

The musl variant (Alpine, used by `podkit-docker`) continues to build via the existing GHA Alpine container path — out of scope for this ADR, no regression intended.

### Why not macOS VMs for VM tests

macOS has no userspace equivalent to `dummy_hcd`. Apple's USB stack requires signed, notarised DriverKit extensions to create virtual host controllers; there is no configfs, no FunctionFS, and no way for an unsigned userspace process to synthesise a USB device that the OS driver stack sees as real. macOS coverage is therefore:

- **Unit tests**: injectable mocks for all transport layers
- **Host tests**: native subprocess tests against canned fixtures on the mac host
- **Opt-in**: real iPod (developer hardware only)

No macOS VM is created or maintained.

### Why not Docker for VM tests

Docker containers share the host kernel (or Docker Desktop's LinuxKit kernel on mac/windows). `dummy_hcd` requires the module to be present in the running kernel; Docker Desktop's bundled LinuxKit kernel does not ship `dummy_hcd`. The cross-platform promise of Docker collapses precisely when kernel modules are needed. Lima provides an actual Linux kernel with module access.

### Lima `virtual-ipod.yaml` is off-limits

`tools/lima/virtual-ipod.yaml` is the user-facing demo VM (see doc-028). The test harness gets its own yamls under `test-packages/device-testing/lima/` to avoid any risk of the demo environment being disturbed by test workloads. The naming convention is deliberate: anything under `test-packages/device-testing/` is test infrastructure.

### CI: build-only

CI (GH Actions `prebuild.yml`, `build-platform.yml`) builds artefacts but does **not** execute the test suite. Unit and host tests run locally on developer machines; VM tests run on mac dev hosts with Lima.

A spike (TASK-320) confirmed that GH Actions `ubuntu-latest` is not suitable for Tier 3: the runner uses the `linux-azure` cloud kernel flavor (e.g. `6.17.0-1010-azure`), which is built without `CONFIG_USB_DUMMY_HCD`. The `linux-modules-extra-*-azure` package installs successfully but does not ship `dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, or `usb_f_fs`. All four `modprobe` calls fail with `FATAL: Module not found`. This is recorded here as historical context; CI test execution is out of scope for m-19.

### Reuse of existing infrastructure

- `test-packages/gpod-testing/` — test iPod templates used by VM tests to populate the gadget filesystem
- `test-packages/e2e-tests/` — existing target abstraction reused for CLI-level VM assertions
- Injectable transports in `packages/ipod-firmware/` — reused unchanged by unit tests

## Consequences

### Positive

- **Full stack coverage.** Logic bugs (unit), subprocess-parsing bugs (host), and kernel-level USB/SCSI bugs (VM) each have a dedicated test level.
- **Always-fast default.** `bun run test` is fast: unit + host tests always run; VM tests are either cached or skipped.
- **Builder/test VM separation catches a real bug class.** Dev libraries on the host PATH cannot mask binary linkage problems because the test VM contains no dev libraries.
- **Binary quality parity.** The binary under test is the same statically-linked binary that ships to homebrew and Docker users — no test-only build flavor.
- **State-mutation testing is cheap.** `apply-state.sh` runs in ~800ms per state; the 6-state matrix adds ~5s overhead per full pass. Test grouping by SystemState reduces apply-state runs from N-per-test to N-per-group.
- **One test interface, two backends.** `local-linux` and `lima-test-vm` share the `TestRuntime` contract; test files don't fork on platform.
- **Demo VM is untouched.** The test harness lives under a different directory tree from `virtual-ipod.yaml`.
- **Mass-storage extensibility.** Echo Mini ships as a starter persona; Rockbox, FiiO, and others can follow the same pattern.

### Negative

- **New infrastructure to maintain.** The FunctionFS daemon, two Lima yamls, and `device-testing` package are new build artefacts.
- **VM tests require Linux kernel access.** Cannot run inside Docker Desktop on mac/windows; cannot run on GH Actions `ubuntu-latest`.
- **VM tests run on developer mac hosts only.** CI does not execute the test suite; test coverage gates on developers running VM tests locally.
- **Builder VM is a separate VM to boot.** First-time onboarding cost is one extra Lima instance.
- **Windows not yet covered by VM tests.** WSL2 can load `dummy_hcd`; a `wsl2-linux` `TestRuntime` backend is a future addition.

## Related Decisions

- [ADR-005](/developers/adr/adr-005-test-ipod-environment) — iPod test environment (gpod-tool + temp directories); VM tests reuse `gpod-testing` templates
- [ADR-014](/developers/adr/adr-014-device-capability-architecture) — Device capability architecture; the code under test in host and VM tests
- [ADR-017](/developers/adr/adr-017-device-persona-fixtures) — Device persona + system state fixtures; the shared fixture registry consumed by unit-test mocks and the VM-test FunctionFS daemon

## References

- [doc-028](../backlog/docs/doc-028%20-%20Virtual-iPod-Architecture-and-Package-Design.md) — Virtual iPod architecture (demo VM; separate from test harness)
- [doc-029](../backlog/docs/doc-029%20-%20PRD-Automated-iPod-Device-Identification-via-SysInfoExtended.md) — PRD: Automated iPod device identification
- [doc-032](../backlog/docs/doc-032%20-%20Spec-Phase-1-—-ipod-firmware-SCSI-delivery.md) — Spec: P1 ipod-firmware SCSI delivery (injectable transport interfaces)
- [doc-033](../backlog/docs/doc-033%20-%20Spec-Phase-2-—-USB-inquiry-consolidation.md) — Spec: P2 USB inquiry consolidation
- `packages/ipod-firmware/` — injectable transport interfaces (`UsbBinding`, `ScsiSyscall`, `ProbeFs`)
- `test-packages/gpod-testing/` — test iPod template utilities
- `.github/workflows/prebuild.yml` — existing native-build CI workflow; builder VM shares its implementation
- `tools/prebuild/build-static-deps.sh` — shared static-deps build script
- TASK-320 — GH Actions `dummy_hcd` spike (FAIL recorded; CI test execution is out of scope)
- TASK-323 — CI VM test matrix (archived)
- Milestone m-19: VM testing
