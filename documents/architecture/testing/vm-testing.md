---
title: VM Testing (Tier-3)
description: How podkit exercises the production CLI against a synthesised iPod USB device inside the device-harness Lima VM — personas, system states, FunctionFS daemon, mount lifecycle, and the mechanical constraints a test author must respect.
sidebar:
  order: 2
---

Describes how Tier-3 end-to-end tests run podkit against a real-looking
iPod inside the `podkit-device-harness` Lima VM. The VM is the only
place podkit's USB/SCSI/filesystem code paths get exercised against a
device-shaped target without real hardware; this doc captures the
contract the tests, the harness, and the synthetic-device daemon share.

Companion reading:

- [vm-build-orchestration](./vm-build-orchestration.md) — how
  `bun run test:vm` keeps the in-VM binary fresh and detects drift.
- [adr/adr-016 — Linux VM test harness](../../../adr/adr-016-linux-vm-test-harness.md) — overall split.
- [adr/adr-017 — Device persona fixtures](../../../adr/adr-017-device-persona-fixtures.md) — persona registry rationale.

---

## 1. Map

Tier-3 tests sit at the top of podkit's testing pyramid:

1. **Unit** — pure-function tests in each package. Run on macOS dev
   machines, never touch a VM.
2. **Integration** — multi-module tests inside one process. Run on
   macOS, no VM.
3. **End-to-end (VM)** — full `podkit` binary running inside
   `podkit-device-harness` against a synthesised USB device. This doc.

A Tier-3 test exercises the binary end-to-end: USB inquiry, SCSI passthrough,
device classification, readiness, doctor, sync, repair. None of those
paths can be exercised on macOS without hardware; equally, no piece of
this can be replaced by a unit fake without sacrificing the very
contract the test is meant to pin (libgpod, native fs syscalls, FunctionFS
gadget binding, the production binary's stripped seams).

Two artefacts make this possible:

- **`DevicePersona`** — a typed device fixture (USB descriptor,
  SysInfoExtended XML, optional FAT32 backing-file recipe, host probe
  payloads). Authored once and registered; consumed by both the
  FunctionFS daemon (USB-side) and the runner (FAT-side).
- **`SystemState`** — a host-environment snapshot (ffmpeg present /
  absent, libgpod present / absent, udev rule installed, etc.). Applied
  once per group, restores via the VM's snapshot machinery.

The combination — a persona attached over a chosen system state — is
the unit of test setup.

---

## 2. Primitives

### `DevicePersona`

Typed record at `test-packages/device-testing/src/personas/types.ts`.
Required fields a new persona must populate:

| Field | What it carries |
|-------|-----------------|
| `id` | kebab-case persona name; used as the systemd instance specifier and the configfs gadget directory name |
| `description` | human-readable summary; **written verbatim to USB string descriptor** — see [§5.1](#51-usb-string-descriptor-bytes) |
| `schemaVersion` | persona schema version (currently `3`); bumps in lockstep across all personas |
| `usbDescriptor` | vendor/product, endpoints, string descriptors |
| `sysInfoExtendedXml` | XML payload the FunctionFS daemon serves over the vendor control-transfer protocol |
| `lsblkJson` / `systemProfilerJson` / `diskutilPlist` | host probe payloads — `null` for synthesised personas that aren't exercising the host probe path |
| `partitionLayout` | declared partition table; the synthesised backing file may or may not realise the firmware partition (it doesn't today) |
| `massStorageBackingFile` | `null` for FunctionFS-only personas; an object with `synthesis` + `resetStrategy` for personas with FAT32 or HFS+ backing |
| `provenance` | source attribution + path to a `provenance.md` next to the persona |

The registry lives in
`test-packages/device-testing/src/personas/index.ts` — every persona
must be imported, re-exported, AND added to the `personas` Map.

### `SystemState`

Typed record at `test-packages/device-testing/src/system-states/types.ts`.
Today the registry only ships `healthy` (every tool present, FAT32 supported,
no environmental gotchas). The state is applied via
`limaTestVmRunner.applyState(state)` which runs
`test-packages/device-testing/scripts/apply-state.sh` inside the VM.

### `limaTestVmRunner`

A `TestRuntime` implementation at
`test-packages/device-testing/src/runners/lima-test-vm.ts:711` that
owns the VM-side primitives:

- `prepare()` — boot VM, transfer binaries (`transferBinary`,
  `transferGpodTool`, `transferDummyHcdDaemon`), publish persona
  sidecar JSON.
- `applyState(state)` — snapshot restore + run `apply-state.sh`.
- `run(command, opts)` — `limactl shell` wrapper returning
  `{stdout, stderr, exitCode}`.
- `teardown()` — restore base state for the next group.

### `withPersona({persona}, body)`

Daemon-only lifecycle wrapper
(`test-packages/device-testing/src/vm/persona-fixture.ts:69`):

- start `dummy-hcd-daemon@<personaId>.service`
- wait for `/dev/sg*` enumeration (mass-storage personas only)
- run `body`
- stop the daemon (best-effort)

Use this when the test only inspects the USB / SCSI inquiry surface.

### `mountPersona({...}) / unmountAndStop({...})`

Mount-and-uid lifecycle wrapper
(`test-packages/device-testing/src/vm/mount-persona.ts`):

- start the daemon (via `startDaemonForPersona`)
- find the matching `/dev/sd<x>` by walking
  `/sys/class/scsi_generic/sg*` and filtering by vendor / product ID
- mount with `-o uid=$(id -u),gid=$(id -g)` so podkit's
  writable-device readiness gate passes
- (`unmountAndStop`) reverse all of the above, best-effort

Use this when the test invokes a podkit command that reads or writes
the FAT32 backing — doctor, sync, repair, anything `-d <path>`.

### `runJsonCommand(runtime, command, timeoutMs)`

CLI-invocation helper (`persona-fixture.ts:206`). Parses stdout as
JSON regardless of exit code. Every podkit `--json` surface emits a
failure envelope on non-zero exits; gating parse on `exitCode === 0`
would hide every failure-path assertion. Tests that need to read the
JSON envelope on a failure exit MUST use this helper, not raw
`limaTestVmRunner.run()`.

---

## 3. Responsibility boundaries

| Concern | Owner |
|---------|-------|
| Authoring a new device shape (USB descriptor, SIE, partitions) | `test-packages/device-testing/src/personas/<id>/persona.ts` |
| Seeding files into the FAT32 backing at synthesis time | `massStorageBackingFile.synthesis.initialContent` on the persona |
| Serving USB descriptors + vendor control transfers (SIE) | `dummy-hcd-daemon` (`tools/device-testing/dummy-hcd/`) |
| Building the FAT32 backing image inside the VM (`mkfs.vfat --invariant` + mtools) | `lima-test-vm-backing-files.ts` |
| Building the HFS+ backing image on the HOST (pure-TS Volume Header writer; limactl-copied into the VM) | `hfsplus-image-writer.ts` + `lima-test-vm-backing-files.ts` (HFS+ branch) |
| Starting/stopping the daemon for a persona | `withPersona` or `mountPersona` |
| Mounting the FAT32 with the right uid/gid | `mountPersona` |
| Bootstrapping a valid iPod DB at runtime (SysInfo + iTunesDB + dirs) | `gpod-tool init <mount> --model <ModelNum>` inside the VM |
| Asserting the production CLI's behaviour | the test file (`*.e2e.test.ts`) |
| Keeping the in-VM binary fresh | turbo: [`vm-build-orchestration`](./vm-build-orchestration.md) |

The split between persona and runtime state is intentional: the
**persona** captures device identity (USB, SIE, partition shape); the
**runtime test setup** mutates filesystem state for that specific test
(stale ModelNumStr, truncated SIE, corrupt iTunesDB).
`gpod-tool init` is the canonical bootstrap tool — it writes what
podkit reads, so test setup and test assertion use independent code
paths (the "independent readers" pattern from
[conventions](../conventions.md)).

---

## 4. Conventions for new contributors

### Authoring a persona

1. Pick a short id. The configfs path `ffs.podkit-<id>` has a
   ~40-byte cap; keep `<id>` ≤ 32 chars. Reference siblings:
   `ipod-5g-modelnum-mismatch` (25), `ipod-5g-stale-guid` (18).
2. Write a short description. The string is written verbatim to the
   USB configuration descriptor; ≤ ~120 UTF-16 code units (~60
   ASCII chars to be safe).
3. Synthesised personas: clone an existing real-hardware persona's
   USB descriptor + SIE XML, change only `id`, `description`,
   `deviceSerial`, `partitionLayout` (when the variant is filesystem-
   specific), and `massStorageBackingFile`. Reuse the original
   SIE XML by importing it relatively (`'../<sibling>/raw/...'` is
   allowed in TS imports, but not in `initialContent.sourceFixture` —
   see [§5.3](#53-no--in-sourcefixture-paths)). `ipod-nano-7g-hfsplus`
   is the canonical example — it imports USB + SIE + macOS host probes
   from `ipod-nano-7g-space-gray` and only deltas the filesystem-shape
   fields.
4. `initialContent.sourceFixture` paths must live in the persona's
   own `raw/` directory — `..` segments are rejected by
   `resolveSeedEntries()`. Copy fixtures across personas rather than
   referencing siblings.
5. Register in `test-packages/device-testing/src/personas/index.ts`:
   import, re-export, add to the `personas` Map.
6. Re-export from `test-packages/device-testing/src/index.ts` so
   tests can import via `@podkit/device-testing`.
7. Add a `provenance.md` next to `persona.ts` documenting the source
   (real capture vs synthesised) and any non-obvious decisions (why
   the short id, why the description was trimmed, what state the
   test will mutate at runtime).

### Authoring a test

1. File path: `test-packages/e2e-vm-tests/src/<feature>.e2e.test.ts`.
   No `.tier3.` suffix — that was a planning label, not a code one.
2. Imports come from `@podkit/device-testing` only. Never reach into
   harness internals via a relative path.
3. Skeleton (canonical):

   ```typescript
   import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
   import {
     limaTestVmRunner,
     VM_COLD_TIMEOUT_MS,
     VM_WARM_TIMEOUT_MS,
     mountPersona,
     unmountAndStop,
     runJsonCommand,
     healthy,
     myPersona,
   } from '@podkit/device-testing';

   describe('VM: <feature>', () => {
     beforeAll(async () => {
       await limaTestVmRunner.prepare();
     }, VM_COLD_TIMEOUT_MS);

     afterAll(async () => {
       await limaTestVmRunner.teardown();
     }, VM_COLD_TIMEOUT_MS);

     describe(`SystemState: ${healthy.id}`, () => {
       const VM_MOUNT_POINT = '/mnt/podkit-<feature>';
       const PERSONA = myPersona;

       beforeAll(async () => {
         await limaTestVmRunner.applyState(healthy);
       }, VM_COLD_TIMEOUT_MS);

       beforeAll(async () => {
         try {
           await mountPersona({
             personaId: PERSONA.id,
             vendorId: PERSONA.usbDescriptor.vendorId,
             productId: PERSONA.usbDescriptor.productId,
             mountPoint: VM_MOUNT_POINT,
           });
           // bootstrap state — gpod-tool init, fixture overlays, etc.
         } catch (err) {
           await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
           throw err;
         }
       }, VM_COLD_TIMEOUT_MS);

       afterAll(async () => {
         await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
       }, VM_COLD_TIMEOUT_MS);

       it('<behaviour>', async () => {
         const result = await runJsonCommand(
           limaTestVmRunner,
           `/usr/local/bin/podkit -d ${VM_MOUNT_POINT} doctor --scope device --json`,
           VM_WARM_TIMEOUT_MS
         );
         // assertions
       }, VM_WARM_TIMEOUT_MS);
     });
   });
   ```

4. Use `--scope device` (not `--scope database-health` — the CLI flag
   only accepts `system | device | all`; internal scopes are an
   implementation detail).
5. Use `gpod-tool init <mount> --model MA446` as the canonical
   bootstrap when readiness needs to reach `ready` (it writes
   SysInfo + an empty iTunesDB + the dir hierarchy podkit's readiness
   pipeline expects).
6. For deferred test work, use `it.skip` with a descriptive name that
   names the blocker (e.g.
   `'...overwrites stale GUID — BLOCKED on daemon SCSI VPD scaffold'`).
   Inside the skipped body, leave a comment sketch of the test that
   would land — the next person picking up the work then knows what
   to assert.
7. Don't write `skipBug(...)` in Tier-3 tests — that helper belongs to
   the matrix harness (`test-packages/e2e-tests/src/matrix/`). The
   matrix and the VM tier have different visibility conventions.

### Test name conventions

Names describe behaviour, not internal tracking. Bad:
`'Bug 3: doctor output doesn't mention artwork-db'`. Good:
`'truncated on-disk SIE: human output names SysInfoExtended; does NOT bleed artwork-database failure copy'`.
The reader of a junit report doesn't know what "Bug 3" refers to.

### Independent readers

Setup uses one tool; verification uses another. Today that's
`gpod-tool init` (libgpod's C CLI) for setup, `podkit doctor` (which
reads via libgpod-node + native fs) for verification. Don't break
that split — a test that sets up state via libgpod-node and verifies
via libgpod-node would silently pass on a read / write asymmetry
inside libgpod-node.

---

## 5. Mechanical constraints

These are the parts of the kernel + Lima + FunctionFS surface that
reject perfectly-reasonable-looking persona definitions with cryptic
errors. The error usually points at the wrong layer — knowing the
real cause saves hours.

### 5.1 USB string descriptor bytes

The persona's `description` is written to
`configs/c.1/strings/0x409/configuration` during gadget setup
(`tools/device-testing/dummy-hcd/src/gadget.ts:110`). USB string
descriptors carry length in a `u8` `bLength` field — the full
descriptor (header + UTF-16-LE encoded body) must fit in 255 bytes.
Anything longer than ~120 UTF-16 code units (~60 ASCII chars)
overflows.

**Symptom:** daemon fails to start with
`error: EOVERFLOW: value too large for defined data type, write`,
systemd restart-loops the daemon, and the test times out waiting
for `/dev/sg*` to appear with a misleading "daemon binding
mass-storage correctly?" message.

**Fix:** keep `description` short. Move any long-form context to the
persona's `provenance.md` instead.

### 5.2 configfs FunctionFS path cap

The configfs path `ffs.podkit-<personaId>` is created by
`mkdir` (`tools/device-testing/dummy-hcd/src/gadget.ts:114`). The
kernel imposes a path-segment cap (~40 bytes); longer paths return
`ENAMETOOLONG`.

**Symptom:** same daemon restart-loop as above, this time with
`error: ENAMETOOLONG: name too long, mkdir '/sys/kernel/config/usb_gadget/podkit-<id>/functions/ffs.podkit-<id>'`.

**Fix:** persona id ≤ 32 chars. This is why we have
`ipod-5g-modelnum-mismatch` instead of
`ipod-video-5g-modelnum-mismatch`.

### 5.3 No `..` in `sourceFixture` paths

`massStorageBackingFile.synthesis.initialContent[].sourceFixture`
must resolve under the persona's own directory.
`resolveSeedEntries()` in
`test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts`
rejects any path containing a `..` segment.

**Symptom:** `ensureBackingFile` throws at test setup time with a
descriptive error naming the rejected path.

**Fix:** copy the source file into the persona's `raw/` directory.
TypeScript `import` statements may use `'../sibling/raw/...'` because
that is a build-time resolve, not a runtime path; the rule only
applies to `initialContent` strings.

### 5.4 Mount uid/gid

Without `-o uid=$(id -u),gid=$(id -g)`, `mount -t vfat /dev/sdX ...`
defaults to root-owned files. podkit runs as the unprivileged Lima
user; its writable-device readiness check tries to create a temp
file under the iPod root and fails with `EACCES`.

**Symptom (this one is the worst):** podkit returns a perfectly
well-formed JSON envelope with `readiness.stages.mount.status: 'warn'`,
`details.readOnly: true`, and an **empty** `checks: []` array. No
error. No stderr. The doctor pipeline silently filters every
device-bound check because readiness didn't reach `ready`.

**Fix:** use `mountPersona({...})` (or copy its mount line literally).
Never invoke `mount -t vfat` without the uid/gid options.

### 5.5 Doctor short-circuits on non-`ready` readiness

Even checks whose stated requirement is `writable-device` (e.g.
`sysinfo-modelnum-mismatch`) are filtered out when overall readiness
isn't `ready`. The readiness pipeline has stages
(usb / partition / filesystem / mount / sysinfo / database); any
failure short-circuits.

A common shape that bites: persona has SIE on disk but no iTunesDB,
so `database` stage `fails`, readiness is `needs-init`, and the
device-bound `checks` array comes back empty.

**Fix:** if a test asserts on device-bound checks, run
`gpod-tool init <mount> --model <ModelNum>` after mounting. That
writes SysInfo + an empty iTunesDB + the `iPod_Control/*` dir tree.
Override individual files at runtime to produce the specific failure
shape the test pins.

### 5.6 HFS+ refusal — MBR-wrapped image built on the host

The HFS+-on-Linux refusal scenario (persona `ipod-nano-7g-hfsplus`,
test `hfsplus-refusal.e2e.test.ts`) drives podkit through the same
discovery + readiness path a real Mac-formatted iPod takes on a Linux
host. Refusal fires once `findIpodDevices()` returns an `hfsplus`
partition; the policy itself short-circuits before any mount attempt.

The HFS+ backing image cannot be built inside the test VM: `hfsprogs`
(which provides `mkfs.hfsplus`) is unpackaged on arm64 in Debian
bookworm — the source-package's `Architecture: amd64 i386 …` clause
predates the arm64 port. Apple-Silicon hosts run the test VM as arm64,
so an in-VM `mkfs.hfsplus` is impossible.

Instead, the runner uses a pure-TypeScript MBR-wrapped HFS+ image
writer at
`test-packages/device-testing/src/runners/hfsplus-image-writer.ts`.
The on-disk shape:

```text
offset 0           MBR sector (512 B)
  offset 446         partition entry 1 — type 0xAF (HFS), LBA start=2048
  offset 510         boot signature 0x55 0xAA
offset 512..1 MiB  sparse zeros (1 MiB alignment convention)
offset 1 MiB       start of HFS+ partition (LBA 2048)
  offset 1 MiB + 1024  HFS+ Volume Header (512 B)
    signature='H+', version=4, blockSize=4096, totalBlocks=<rest>,
    finderInfo[6..7] = non-zero seed → blkid synthesises UUID
```

Apple TN1150 documents the Volume Header format; MBR is older still.
The writer is ~200 LOC, populates the minimum-viable subset, and
produces a sparse file — only the 512-byte MBR + 512-byte Volume
Header physically land on disk regardless of declared size.

**The finderInfo UUID seed is load-bearing.** Without it, blkid
returns no UUID for the partition. The Linux platform's `walk()` at
`packages/podkit-core/src/device/platforms/linux.ts:199` filters out
partitions without a UUID — they never reach `listDevices()`, so the
readiness pipeline never runs, and the HFS+ refusal in
`add.ts:953` never fires. Seeding `finderInfo[6..7]` with a stable
non-zero value gives blkid the 8 bytes it MD5-hashes into a
synthesised UUID, which keeps the device visible.

This MBR wrapping matches what a real Mac-formatted iPod presents on
a Linux host (modulo APM-vs-MBR — APM would be more authentic but
adds significant complexity for zero refusal-test value; the platform
code keys on `fstype`, not partition-table flavour).

Properties this approach gives us:

- **portability** — works on any host architecture; no apt repo / no
  Docker / no committed binary fixture.
- **decoupling** — end-user Linux hosts without `hfsprogs` or
  `hfsplus.ko` still hit the same refusal. The unit suite at
  `packages/podkit-core/src/device/filesystem-policy.test.ts` mocks
  `process.platform` and exercises the policy without any fs touch;
  the Tier-3 scenario exercises the full lsblk → blkid → walk() →
  readiness → CLI wiring.
- **production-shaped** — unlike the previous whole-disk-fstype
  approach (where `walk()` would have dropped the device for lack of
  partition table), the MBR-wrapped image exercises the same
  `listDevices()` shape a real iPod hits.
- **`initialContent` unimplemented for HFS+** by design — the only
  consumer (the refusal path) reads the volume header, never the data
  area. Adding file seeding would mean implementing the HFS+ catalog
  file from scratch, which is enormous for zero refusal-test value.

### 5.7 SCSI VPD page 0xC0 — open scaffold gap

The dummy-hcd daemon implements SIE inquiry via the **USB vendor
control transfer protocol** (`bmRequestType=0xC0, bRequest=0x40,
wValue=0x02`) that libgpod 0.8.3 uses. It does NOT yet implement the
SCSI VPD page 0xC0 path used by the SCSI-fallback iPods (5G video,
mini 2G, etc.).

Symptoms in tests: `podkit doctor --repair sysinfo-extended` or
`--repair sysinfo-consistency` against a SCSI-fallback persona
returns

```
{"success": false, "code": "REPAIR_FAILED",
 "details": {"source": "unavailable",
             "error": "Could not read device identity from SCSI:
                       SCSI CHECK CONDITION on VPD page 0xc0
                       (key=0x5 asc=0x24 ascq=0x00)"}}
```

Until the daemon learns VPD 0xC0, any test whose assertion depends on
USB-served SIE truth (the repair side of the
`sysinfo-consistency` / `sysinfo-extended` check pair) must be
`it.skip` with a comment naming this gap.
[See open work below.](#7-open-work)

---

## 6. Scope boundaries

This document does **not** cover:

- **Build orchestration** — how a fresh podkit binary lands in the VM
  before tests run. See
  [vm-build-orchestration](./vm-build-orchestration.md).
- **The daemon protocol layer.** The SETUP-packet decoding, paged SIE
  serving, FunctionFS descriptor handshake are documented in
  `tools/device-testing/dummy-hcd/README.md` and the daemon's
  per-file JSDoc.
- **CI vs local execution.** Today every Tier-3 test runs against the
  developer's local `podkit-device-harness` instance. CI runs the
  same suite against an identically-named VM provisioned per job.
  The provisioning script is the canonical source of both.
- **Matrix harness conventions.** `skipBug`/`skipRedundant`/
  `skipImpossible`/`skipEnvGated` belong to
  `test-packages/e2e-tests/src/matrix/`, not here. The matrix runs
  against real iPods + real source fixtures; the VM runs against
  synthetic ones.
- **macOS dev-machine testing.** Doctrine: no e2e harness for device
  flows on macOS. Linux VM is the authoritative end-to-end runtime
  check. Unit + integration cover the macOS dev path.

---

## 7. Open work

### Daemon SCSI VPD page 0xC0

The largest known gap. Closing it unblocks:

- `doctor --repair sysinfo-consistency` (rewrite stale on-disk SIE
  from USB truth).
- `doctor --repair sysinfo-extended` against a DB-less iPod (write
  fresh SIE from USB onto a clean FAT).

Both have skipped Tier-3 placeholders at
`test-packages/e2e-vm-tests/src/doctor-sysinfo-repair.e2e.test.ts`
with sketched assertions. Authoritative unit coverage in
`packages/podkit-core/src/diagnostics/checks/sysinfo-consistency-repair.test.ts`
and `sysinfo-extended.test.ts:57-66`.

Tracking: a follow-up backlog task should land. Until that task
lands, the `it.skip` comments are the canonical pointer.

### Cross-arch gpod-tool binary

`test-packages/device-testing/scripts/build-gpod-tool-linux.sh`
builds for the host's arch only (Apple Silicon → `linux-arm64`;
Intel → `linux-x64`). A future Linux x86 CI runner would need either
a separate Docker build or a cross-compile step. Not blocking today
because the device-harness VM matches the host arch.

### Persona schema validator

The four constraints above (description length, id length,
`sourceFixture` paths, uid/gid mount) should be enforced at registry
load time, not as crash-on-first-use. A persona that violates §5.1
or §5.2 silently breaks at the EOVERFLOW / ENAMETOOLONG syscall
which is hard to diagnose. Adding a pre-flight validator to
`personas/index.ts` (or to a vm-doctor check) would surface the same
information up-front. Not blocking; quality-of-life.

### Documentation surface

This doc and `vm-build-orchestration` cover the orchestration + author
surface. Two adjacent topics could land their own docs as the harness
grows:

- **System states** — today only `healthy` exists; once a second
  state lands the conventions for adding one deserve a doc.
- **Multi-persona / dual-iPod tests** — the harness daemon today
  binds a single persona's FunctionFS instance. Some discovery
  scenarios (TASK-351) need two iPods present simultaneously; the
  test pattern for that will warrant a dedicated section once the
  multiplexing lands.

---

## 8. References

### Code

- `test-packages/device-testing/src/personas/` — registry + per-persona dirs.
- `test-packages/device-testing/src/personas/types.ts` — `DevicePersona`.
- `test-packages/device-testing/src/system-states/` — system-state registry.
- `test-packages/device-testing/src/runners/lima-test-vm.ts` — `limaTestVmRunner`.
- `test-packages/device-testing/src/vm/persona-fixture.ts` — `withPersona`, `runJsonCommand`.
- `test-packages/device-testing/src/vm/mount-persona.ts` — `mountPersona`, `unmountAndStop`.
- `test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts` — FAT32 synthesis (in-VM `mkfs.vfat`) + `initialContent` (FAT32-only) + HFS+ branch (host-side; delegates to the TS writer).
- `test-packages/device-testing/src/runners/hfsplus-image-writer.ts` — pure-TS HFS+ Volume Header writer (Apple TN1150).
- `packages/podkit-core/src/device/filesystem-policy.ts` — HFS+-on-Linux refusal policy; exercised end-to-end by `hfsplus-refusal.e2e.test.ts`.
- `tools/device-testing/dummy-hcd/` — daemon source.
- `test-packages/e2e-vm-tests/src/*.e2e.test.ts` — feature-side tests.
- `test-packages/device-testing/src/vm/*.e2e.test.ts` — harness self-tests.

### Companion docs

- [testing/vm-build-orchestration](./vm-build-orchestration.md) — keep the in-VM binary fresh.
- [adr/adr-016 — Linux VM test harness](../../../adr/adr-016-linux-vm-test-harness.md) — the original design split.
- [adr/adr-017 — Device persona fixtures](../../../adr/adr-017-device-persona-fixtures.md) — persona registry rationale.
- `tools/device-testing/dummy-hcd/README.md` — daemon protocol + sidecar format.
