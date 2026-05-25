---
title: "ADR-017: Device & System Fixture Registry"
description: A single shared package (`@podkit/device-testing`) exporting `DevicePersona` and `SystemState` fixture registries, consumed by unit-test injectable mocks and the VM-test FunctionFS USB gadget daemon. Single source of truth prevents mock/integration drift.
sidebar:
  order: 18
---

# ADR-017: Device & System Fixture Registry

## Status

**Accepted**

## Context

The device test stack (ADR-016) exercises the inquiry pipeline at two distinct levels:

- **Unit tests** inject fake data directly into the TypeScript transport layer (`UsbBinding`, `ScsiSyscall`, `ProbeFs`, `SubprocessRunner`).
- **VM tests** run the full stack against a FunctionFS userspace daemon that synthesises a real USB gadget on `dummy_hcd` inside the test VM.

Two kinds of fixture data are needed:

- **Device fixtures** (`DevicePersona`) — USB descriptors, SCSI VPD payloads, partition layouts, mass-storage backing file info, expected capabilities for each iPod model and rejection case.
- **System fixtures** (`SystemState`) — host-environment states the doctor command must handle (FFmpeg missing, libgpod missing, udev rule missing, `/dev/sg*` permissions denied, etc.). Unit tests mock these at the subprocess boundary; VM tests manipulate the real test VM state via `apply-state.sh`.

Without a shared registry, the fake data used in T1 mocks and the data served by the T3 daemon would diverge independently. A T1 test could pass while a T3 test using nominally the same device or system state fails because the two representations were authored separately and fell out of sync. This is the classic mock-drift problem applied to hardware and host-environment simulation.

An additional problem is capture and provenance: SCSI VPD payloads, `lsblk -J` JSON, `system_profiler` JSON, and `diskutil` plists are large, brittle, and tedious to synthesise by hand. They should be captured once from real hardware and committed as authoritative fixtures.

## Decision Drivers

- T1 mocks and T3 gadget/VM responses must derive from the same source of truth
- Fixtures must be capturable from real hardware and auditable (provenance)
- Adding a new persona or system state must not require changes to any test file — only the registry
- Fixture data must be immutable across test runs (mutations are test-local)
- Schema changes must be breaking and visible
- One package, not two — fixtures and the runtime/harness that consumes them ship together

## Options Considered

### Option A: Inline fixture objects per test file

Each test file defines its own fake VPD payload, `lsblk` JSON, etc.

**Pros:** Simple. No new packages.

**Cons:** Classic mock drift. T1 and T3 files define the same device independently. A VPD format change requires hunting down every test file that fakes that field. No provenance.

### Option B: Shared JSON files, no TypeScript registry

Raw JSON fixtures committed to a `fixtures/` directory, imported ad hoc.

**Pros:** Avoids a new package. JSON is easy to diff.

**Cons:** No schema enforcement. No typed `expectedCapabilities` or `expectedDoctorOutput` alongside the raw data. Tests importing from `fixtures/` must each know the schema and which file maps to which device.

### Option C: Two packages — `device-fixtures` + `device-harness`

Originally proposed as two separate packages: one for fixture data, one for the `TestRuntime` interface + runners.

**Pros:** Separation of concerns.

**Cons:** The runners and fixtures are tightly coupled (the `lima-test-vm` runner serialises the persona registry to a JSON sidecar consumed by the FunctionFS daemon; the `lima-test-vm` runner needs the `SystemState` registry to drive `applyState`). Splitting them adds workspace boilerplate without preventing coupling.

### Option D: Single `test-packages/device-testing/` package (Chosen)

One package consolidates all test-harness foundations: `DevicePersona` registry, `SystemState` registry, `TestRuntime` interface + runners, `SubprocessRunner` re-exports. Unit tests import TypeScript objects; the VM-test daemon and lima runners read JSON sidecars derived from the same TypeScript registry.

**Pros:** Single source of truth across both fixture types and the harness that consumes them. No cross-package import friction. Schema is enforced by TypeScript. Named handles give tests a stable reference regardless of internal layout changes.

**Cons:** Larger package than either of the two it replaces. Schema changes are breaking and require coordinated migration.

## Decision

**Option D: a single `test-packages/device-testing/` package** holding `DevicePersona` and `SystemState` registries plus the `TestRuntime` harness.

### Package layout

```
test-packages/device-testing/
├── package.json
├── tsconfig.json
├── README.md                       # Cross-references agents/device-testing.md
├── src/
│   ├── index.ts                    # public exports
│   ├── persona.ts                  # DevicePersona type
│   ├── personas/                   # one subdir per persona
│   │   ├── ipod-video-5g-fresh/
│   │   │   ├── persona.ts
│   │   │   ├── sysinfo.xml
│   │   │   ├── lsblk.json
│   │   │   ├── system-profiler.json
│   │   │   ├── diskutil.plist
│   │   │   └── provenance.md
│   │   ├── ipod-nano-7g-populated/
│   │   └── echo-mini-empty/
│   │       ├── persona.ts
│   │       ├── backing-file.img    # Pre-built FAT32 image (or synthesis recipe)
│   │       └── provenance.md
│   ├── system-state.ts             # SystemState type
│   ├── system-states/              # one entry per state
│   │   ├── healthy.ts
│   │   ├── no-ffmpeg.ts
│   │   ├── no-libgpod.ts
│   │   ├── no-udev.ts
│   │   ├── no-sg-perms.ts
│   │   └── corrupt-configfs.ts
│   ├── runtime.ts                  # TestRuntime interface
│   ├── runners/
│   │   ├── local-linux.ts
│   │   └── lima-test-vm.ts
│   ├── subprocess.ts               # SubprocessRunner re-exports (interface + default runner)
│   └── vm/                         # VM integration tests
└── scripts/
    ├── capture-persona.ts          # capture a persona from a connected device
    └── apply-state-vm.sh           # in-VM script to mutate state
```

### `DevicePersona` schema (v2, current)

Schema version 2 landed under TASK-332 (2026-05-23). See `test-packages/device-testing/src/personas/types.ts` for the canonical TypeScript definitions, including TSDoc on every field. The shape below is illustrative — the source file is authoritative.

```typescript
interface DevicePersona {
  /** Stable identifier used in test assertions and the daemon's --persona flag */
  id: string;
  /** Human-readable label for error messages and logs */
  description: string;
  /** Schema version; bump on any breaking field change. Current: 2. */
  schemaVersion: number;

  // --- USB layer (v2 — full descriptor hierarchy) ---
  usbDescriptor: {
    // Device descriptor (USB 2.0 §9.6.1)
    vendorId: number;
    productId: number;
    /** `null` when iSerialNumber = 0 in the descriptor (e.g. Sony NW-HD5). */
    deviceSerial: string | null;
    deviceClass: number;        // typically 0 on composite devices
    deviceSubclass: number;
    deviceProtocol: number;
    bMaxPacketSize0: number;
    bcdUSB: number;
    bcdDevice: number;
    bNumConfigurations: number;
    // Configuration / interface / endpoint hierarchy
    configurations: Array<{
      bConfigurationValue: number;
      bNumInterfaces: number;
      bmAttributes: number;
      bMaxPower: number;
      interfaces: Array<{
        bInterfaceNumber: number;
        bAlternateSetting: number;
        bInterfaceClass: number;       // 0x08 = Mass Storage (lives here, not on device)
        bInterfaceSubClass: number;    // 0x06 = SCSI transparent
        bInterfaceProtocol: number;    // 0x50 = Bulk-Only Transport
        endpoints: Array<{
          bEndpointAddress: number;
          bmAttributes: number;
          wMaxPacketSize: number;
          bInterval: number;
        }>;
      }>;
    }>;
    /** String descriptor table, keyed by descriptor index. */
    stringDescriptors: Record<number, string>;
  };

  // --- SCSI / firmware layer ---
  sysInfoExtendedXml: string | null;

  // --- Host OS probe layer ---
  lsblkJson: object | null;
  systemProfilerJson: object | null;
  diskutilPlist: string | null;

  // --- Filesystem (v2 — partition tables now grouped by LUN) ---
  partitionLayout: {
    luns: Array<{
      lun: number;                // 0-based LUN index
      partitions: Array<{
        index: number;
        type: string;             // e.g. "FAT32", "HFS+", "empty"
        sizeMiB: number;
        mountpoint?: string;
      }>;
    }>;
  };

  // --- Mass storage backing file (optional; set for mass-storage personas) ---
  massStorageBackingFile: {
    imagePath?: string;
    synthesis?: {
      sizeMiB: number;
      filesystem: 'FAT32' | 'FAT16';
      label: string;
      initialContent?: Array<{ path: string; sourceFixture: string }>;
    };
    resetStrategy: 'copy' | 'swap';
  } | null;

  // --- Expected outcomes (for assertion) ---
  expectedCapabilities: DeviceCapabilities | null;
  expectedReadiness: ReadinessResult;
  expectedDoctorOutput: object;

  // --- Provenance ---
  provenance: {
    provenanceDoc: string;
    source: 'physical-capture' | 'synthesised';
  };
}
```

### Schema v2 — May 2026 (TASK-332)

Three coordinated changes to the schema, surfaced during the TASK-321.02 persona-capture pass and landed under TASK-332 as a single registry-wide commit:

1. **`usbDescriptor` hierarchy.** v1 only modelled device-level fields (vendor/product/serial + the top-level class/subclass/protocol triple). v2 adds the full USB descriptor tree: device descriptor + one or more configurations, each containing interfaces, each containing endpoints, plus a string-descriptor table. The flat-only schema could describe "a device exists" but could not drive a FunctionFS daemon to synthesise a believable gadget — Mass Storage class `0x08` lives on the **interface descriptor**, not the device descriptor, and every iPod and every Sony Walkman reports `deviceClass = 0` because they are composite devices.

2. **`partitionLayout.luns[]`.** v1 flattened all partitions into a single `partitions[]` array. v2 reshapes to `{ luns: Array<{ lun, partitions[] }> }`. Echo Mini is the canonical multi-LUN device (internal FAT32 firmware on LUN 0 + SD-card ExFAT on LUN 1); v1 modelled both LUNs as a single flat partition array with an apologetic comment. Future multi-LUN devices hit the same issue without this reshape.

3. **`deviceSerial: string | null`.** Sony NW-HD5 (and the older NW-A HDD Walkmans) advertise `iSerialNumber = 0` in the device descriptor — no serial-descriptor index assigned. v1 used `''` as a workaround; v2 makes it `null` so the absence is semantically explicit, eliminating the `if (persona.deviceSerial) {...}` empty-string-as-falsy footgun.

**Daemon compatibility note.** The sidecar wire shape (`test-packages/device-testing/src/personas/sidecar.ts`) was deliberately **not** changed. The dummy-hcd daemon only needs vendor/product IDs, an optional serial string, and class/subclass/protocol fields to bind the configfs gadget — the richer hierarchy stays host-side. The sidecar builder (`sidecar-build.ts`) was updated to project `deviceSerial: null` to an omitted `serial` field (rather than serialising `null`), so the daemon's existing optional-string fallback (`'000000000001'`) continues to work.

**Migration scope.** All 17 personas migrated mechanically: `schemaVersion: 1 → 2`, `partitions[...] → luns: [{ lun: 0, partitions: [...] }]`, `usbDescriptor` extended with synthesised hierarchy fields drawn from raw probe data (`raw/sysfs-usb.txt`, `raw/ioreg.txt`, `raw/udev.txt`) where available. Personas without raw probe data (mini 2G, nano 2G, video 5G, touch 5G, shuffle, malformed-sysinfo, synthetic state-variants) inherit hierarchy values from the matching family pattern and flag a follow-up Linux capture in `provenance.md`. Sony NW-A1000, NW-A1200, NW-A3000, NW-HD5 migrate `deviceSerial: ''` → `null` (all four advertise `iSerialNumber = 0`); other personas keep their non-empty serials.

### `SystemState` schema

A `SystemState` describes a particular host-environment configuration that affects doctor system-scope checks. Lives alongside `DevicePersona` in the same package.

```typescript
interface SystemState {
  /** Stable identifier (used as the QEMU snapshot name `base-${id}`) */
  id: string;
  description: string;
  schemaVersion: number;

  // --- Host environment ---
  ffmpeg: 'present' | 'missing' | 'no-aac-encoder' | 'no-h264-encoder' | 'old-version';
  libgpod: 'present' | 'missing';
  udevRule: 'present' | 'missing' | 'wrong-path';
  sgPermissions: 'group-readable' | 'denied';
  configfs: 'mounted' | 'unmounted' | 'corrupt';

  // --- Expected outcomes ---
  /** What doctor's system-scope checks[] must produce in this state */
  expectedDoctorSystemOutput: {
    overallStatus: 'healthy' | 'warn' | 'fail';
    checks: Array<{
      id: string;
      status: 'pass' | 'warn' | 'fail';
      summary?: string;
    }>;
  };
  /** Exit code the doctor command should produce (per TASK-308) */
  expectedExitCode: 0 | 1 | 2;
}
```

The unit-test mock layer uses `SystemState` by injecting matching subprocess responses (e.g., `ffmpeg: 'no-aac-encoder'` → the `SubprocessRunner` returns a canned `ffmpeg -encoders` output that omits AAC). The VM-test layer applies the state via `apply-state.sh` before running the test group and restores to `healthy` after. State IDs map 1-to-1 to `SystemState.id`.

### Starter persona set (v1)

Three personas ship as the bootstrap set. They are sufficient to cover the happy-path iPod workflow, a mass-storage DAP workflow, and one rejection case:

| ID | Device | State | Purpose |
|----|--------|-------|---------|
| `ipod-video-5g-fresh` | iPod 5G Video (MA147, iFlash 1TB mod) | Empty database | SCSI-fallback inquiry path |
| `ipod-nano-7g-populated` | iPod nano 7G (16GB) | ~5 000 tracks | USB-inquiry path, populated iTunesDB |
| `echo-mini-empty` | FiiO Snowsky Echo Mini DAP | Empty / freshly formatted | Mass-storage preset path |

The starter set is sized to cover the three principal inquiry/discovery paths (SCSI fallback, USB inquiry, mass-storage) using devices from the user's hardware inventory (`documents/test-devices.md`). Original MC297 entries were swapped because that model is not in the inventory.

The `echo-mini-empty` persona uses a mass-storage backing file (FAT32 image) for its `usb_f_mass_storage` gadget function. The design is extensible: additional mass-storage device personas (Rockbox-enabled iPod, FiiO DAP, generic USB drive) can be added later by following the same `DevicePersona` pattern and providing their own `massStorageBackingFile` entry.

**Note on gpod-tool:** `gpod-tool` (produced by `@podkit/gpod-testing`) is installed in the test VM as a test-time dependency for populating iPod databases in test setup. It is not required to build podkit and is not bundled into the podkit binary.

**Binary quality note:** All unit and VM tests exercise the same statically-linked podkit binary that ships via homebrew and Docker. There is no test-specific build flavor. libgpod is statically linked at build time.

### Starter system-state set (v1)

Five to six states ship as the bootstrap set:

| ID | Purpose |
|----|---------|
| `healthy` | All system tools present; baseline |
| `no-ffmpeg` | FFmpeg uninstalled; doctor codec-encoders check fails |
| `no-libgpod` | libgpod runtime missing; readiness reports failure |
| `no-udev` | podkit udev rule missing; doctor udev-rule check fails |
| `no-sg-perms` | `/dev/sg*` not readable by the test user; SCSI probe fails |
| `corrupt-configfs` | `configfs` mount missing or unwritable; gadget setup blocked |

### Phase 5 expansion (12 additional personas)

The following personas are planned for subsequent delivery. They extend coverage to SCSI-fallback generations, alternative firmwares, and additional rejection cases:

| ID | Device | Notes |
|----|--------|-------|
| `ipod-video-5g-corrupt-db` | iPod 5G Video | Corrupt iTunesDB; tests repair path |
| `ipod-nano-7g-fresh` | iPod nano 7G (Blue) | USB-inquiry path, empty iTunesDB; pairs with starter `ipod-nano-7g-populated` |
| `ipod-nano-4g` | iPod nano 4G | Older USB-inquiry generation; SysInfoExtended quirks |
| `ipod-nano-3g` | iPod nano 3G | Older USB-inquiry generation |
| `ipod-nano-2g` | iPod nano 2G | "Post-2006 SysInfo 0-byte" edge case (see test-devices.md) |
| `ipod-mini-2g` | iPod mini 2G | SCSI-fallback generation |
| `ipod-rockbox` | nano or other host device with Rockbox firmware installed | Tests firmware-variant capability synthesis (requires Rockbox install on existing hardware) |
| `echo-mini-populated` | FiiO Snowsky Echo Mini | Paired with starter `echo-mini-empty`; populated state |
| `ipod-touch-not-supported` | iPod touch 5G (iOS) | Expected rejection; not-supported reason asserted |
| `ipod-shuffle-not-supported` | iPod shuffle (NOT in current inventory; synthesised) | Expected rejection; not-supported reason asserted |
| `non-ipod-usb-disk` | Synthesised: unbranded USB drive | Expected rejection; no iPod VID/PID |
| `malformed-sysinfo` | Synthetic | Corrupted SysInfoExtended XML; parser error path |

Additional mass-storage personas (Rockbox-enabled device, FiiO DAP) are in scope for Phase 5 and beyond. Any device with a USB mass-storage profile can be added as a persona with a `massStorageBackingFile` entry.

### Capture methodology

Real SCSI VPD payloads, `lsblk` output, `system_profiler` JSON, and `diskutil` plists are captured from physical hardware using the existing `documents/sysinfo-captures/` workflow for VPD, plus new capture scripts at `test-packages/device-testing/scripts/capture-persona.ts` for the host-OS probe layers.

**Human-in-the-loop capture flow:**

1. User plugs the physical device into their Mac.
2. Agent runs `bun run device-testing:capture --persona <id>` on the mac host (or invokes `test-packages/device-testing/scripts/capture-persona.ts` directly). The script prompts for the device path, then captures `system_profiler SPUSBDataType -json`, `diskutil list -plist <disk>`, and USB descriptor fields automatically.
3. For Linux-side captures (`lsblk -J`): user connects the device to a Linux machine OR passes the device through Lima USB passthrough to a VM. Agent runs the lsblk capture step inside the VM.
4. Agent commits captured data + auto-generated `provenance.md` (capture date, hardware serial, host OS, operator).

Each persona's `provenance.provenanceDoc` links to a `provenance.md` file in the same directory that records:

- Hardware serial number
- Capture date
- Capture script and command used
- Operator

Synthesised personas (used where hardware is unavailable, e.g. `echo-mini-empty` if no physical device is handy) document the synthesis method and rationale instead. Physical capture is preferred when the hardware is available.

### Consumption by unit tests

Unit tests import TypeScript objects directly:

```typescript
import { personas, systemStates } from '@podkit/device-testing';

const persona = personas['ipod-video-5g-fresh'];
const state = systemStates['no-ffmpeg'];

const usbTransport = new FakeUsbBinding(persona.usbDescriptor, persona.sysInfoExtendedXml);
// Inject a hand-rolled stub that returns canned subprocess output for the state under test:
const subprocessRunner: SubprocessRunner = { async run() { return { stdout: '', stderr: '', exitCode: 1 }; } };
```

No serialisation round-trip. Type errors surface at compile time if a test references a field that doesn't exist.

### Consumption by VM tests

The FunctionFS daemon (`test-packages/device-testing-daemon/`) accepts a `--persona <id>` flag at startup. The `lima-test-vm` runner serialises the registry to a JSON sidecar and passes it to the daemon, which loads the named persona and serves its USB descriptors, VPD responses, and partition layout. The daemon does not import TypeScript; it reads the JSON sidecar produced by the runner.

For mass-storage personas, the runner also stages the `massStorageBackingFile` image at the known backing-file path in the test VM during `prepare()`. The runner resets the backing file between tests in the same SystemState group using the persona's configured `resetStrategy`.

For `SystemState`, the `lima-test-vm` runner runs `apply-state.sh <state.id>` before invoking the test group. The runner never imports the registry at runtime in the VM — `apply-state.sh` is the materialised state.

This ensures the daemon, snapshots, and T1 mocks always consume the same data: JSON or VM state produced from the same TypeScript objects.

### Immutability

Personas and system states are read-only across all tests. A test that needs a mutated state (e.g. a post-sync populated database) clones the relevant persona fields locally and works on the copy. No test may modify the shared registry.

### Schema versioning

`schemaVersion` is a top-level integer on every persona and state. When the schema changes in a breaking way (field added as required, field removed, field renamed), `schemaVersion` is bumped and all existing entries are migrated in the same commit. No backwards-compatibility shims. The bump is a clear signal to reviewers that a breaking migration is taking place.

## Consequences

### Positive

- **Single source of truth.** T1 and T3 can never drift: they consume the same TypeScript object (T1 directly; T3 via a JSON serialisation or named VM snapshot).
- **Two fixture types in one place.** `DevicePersona` and `SystemState` co-locate in the same package, so adding a doctor test that asserts behaviour against a (device, state) pair is one import.
- **Named stable handles.** Tests refer to personas and states by ID, not by inline fake data.
- **Provenance.** Every persona links to a capture session or synthesis rationale; firmware payloads are not magic strings.
- **Type-enforced expectations.** `expectedCapabilities`, `expectedDoctorOutput`, and `expectedDoctorSystemOutput` are typed alongside the protocol data; a schema change causes a compile error in the fixtures package, not a silent test failure.
- **Zero-code fixture addition.** Adding a persona or state to the registry automatically makes it available to every test that iterates over the registry.
- **Mass-storage extensibility.** Echo Mini ships as a starter; Rockbox, FiiO, and others follow the same pattern with a `massStorageBackingFile` entry.

### Negative

- **One large package.** `test-packages/device-testing/` ships fixtures + runners + framework. Mitigated by clear subpath structure (`src/personas/`, `src/system-states/`, `src/runners/`).
- **Physical-capture dependency for new personas.** Some personas require physical hardware access to capture VPD payloads and `lsblk` output. Synthesised personas are a fallback but may not match real device behaviour exactly. The human-in-the-loop capture flow makes physical capture tractable without fully automating it.
- **Snapshot management overhead for new system states.** Each new `SystemState` requires the test VM to be prepared, mutated, and snapshotted once. Mitigated by `apply-state.sh` automation.
- **Schema migrations are synchronised commits.** A breaking schema change requires updating every entry in one commit; there is no incremental migration path.

## Alternatives Considered

- **Inline fixture objects per test** — Rejected (Option A). Causes mock/integration drift and duplicates maintenance burden.
- **Raw JSON files, no TypeScript registry** — Rejected (Option B). No type enforcement, no `expectedCapabilities`, no stable named handles.
- **Two packages (`device-fixtures` + `device-harness`)** — Rejected (Option C). Tight coupling between fixtures and runners; splitting adds workspace boilerplate without preventing coupling.
- **Separate `SystemState` package** — Rejected. System states are pointless without device personas; they are consumed by the same test cases.

## Related Decisions

- [ADR-005](/developers/adr/adr-005-test-ipod-environment) — iPod test environment; `gpod-testing` templates remain separate for database-layer tests; this package covers the USB/SCSI/probe/system-environment layers
- [ADR-014](/developers/adr/adr-014-device-capability-architecture) — Device capability architecture; `expectedCapabilities` in each persona is a `DeviceCapabilities` record produced by `resolveCapabilities`
- [ADR-016](/developers/adr/adr-016-linux-vm-test-harness) — Linux VM test harness; this ADR provides the fixture and harness package that ADR-016's device test stack consumes

## References

- [doc-028](../backlog/docs/doc-028%20-%20Virtual-iPod-Architecture-and-Package-Design.md) — Virtual iPod architecture (shares FunctionFS/configfs approach)
- [doc-029](../backlog/docs/doc-029%20-%20PRD-Automated-iPod-Device-Identification-via-SysInfoExtended.md) — PRD: Automated iPod device identification
- [doc-032](../backlog/docs/doc-032%20-%20Spec-Phase-1-—-ipod-firmware-SCSI-delivery.md) — Spec: P1 ipod-firmware SCSI delivery (VPD payload format)
- [doc-033](../backlog/docs/doc-033%20-%20Spec-Phase-2-—-USB-inquiry-consolidation.md) — Spec: P2 USB inquiry consolidation (USB descriptor format)
- `packages/ipod-firmware/` — injectable transport interfaces that consume persona data in T1
- `test-packages/device-testing-daemon/` — FunctionFS daemon that consumes persona data in T3
- `documents/test-devices.md` — canonical hardware inventory; each persona cross-references the matching entry
- `documents/sysinfo-captures/` — existing SysInfoExtended XML captures reused as fixture source
- `agents/device-testing.md` — agent guide for the device test stack, persona capture, and runner ops (created by TASK-321.08)
- Milestone m-19: VM testing
