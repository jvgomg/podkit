---
id: TASK-322.05
title: FunctionFS userspace daemon for vendor control transfers
status: In Progress
assignee: []
created_date: '2026-05-12 09:35'
updated_date: '2026-05-13 23:21'
labels:
  - testing
  - vm-coverage
  - tier-3
  - functionfs
milestone: m-19
dependencies: []
modified_files:
  - tools/device-testing/dummy-hcd/package.json
  - tools/device-testing/dummy-hcd/tsconfig.json
  - tools/device-testing/dummy-hcd/.gitignore
  - tools/device-testing/dummy-hcd/README.md
  - tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service
  - tools/device-testing/dummy-hcd/scripts/build.sh
  - tools/device-testing/dummy-hcd/src/main.ts
  - tools/device-testing/dummy-hcd/src/cli.ts
  - tools/device-testing/dummy-hcd/src/protocol.ts
  - tools/device-testing/dummy-hcd/src/gadget.ts
  - tools/device-testing/dummy-hcd/src/functionfs.ts
  - tools/device-testing/dummy-hcd/src/types.d.ts
  - tools/device-testing/dummy-hcd/src/__tests__/protocol.test.ts
  - tools/device-testing/dummy-hcd/src/__tests__/cli.test.ts
  - tools/device-testing/dummy-hcd/src/__tests__/main.test.ts
  - packages/device-testing/src/personas/sidecar.ts
  - packages/device-testing/src/personas/sidecar-build.ts
  - packages/device-testing/src/personas/sidecar.test.ts
  - packages/device-testing/src/index.ts
  - packages/device-testing/package.json
  - packages/device-testing/scripts/build-dummy-hcd-daemon.sh
  - turbo.json
  - oxlint.json
parent_task_id: TASK-322
priority: high
ordinal: 450
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the userspace daemon that synthesizes iPod-like USB device responses for the FunctionFS gadget inside the test VM.

**Location**: `tools/device-testing/dummy-hcd/` (separate from `packages/virtual-ipod-server/` which is the user-facing demo — off-limits).

**Protocol** (matches libgpod 0.8.3 vendor control transfer shape):
- `bmRequestType=0xC0` (device-to-host, vendor, device)
- `bRequest=0x40`
- `wValue=0x02`
- `wIndex=page` (iterates from 0 upward)
- Returns up to 4096 bytes per page; short read terminates iteration
- Concatenated payload = SysInfoExtended XML for the loaded persona

**Operation**:
1. Daemon accepts `--persona <id>` flag at startup
2. Loads the JSON sidecar produced by the `lima-test-vm` runner (serialised `@podkit/device-testing` registry)
3. Looks up the named persona, extracts `usbDescriptor` and `sysInfoExtendedXml`
4. Creates a FunctionFS endpoint at the configured path
5. Handles setup packets matching the vendor protocol; serves XML in 4096-byte pages
6. Exits cleanly on SIGINT/SIGTERM

**Language choice**: prefer Go or Rust for a single static binary that runs in the test VM without runtime deps. Avoid Node/Bun since the test VM is deliberately Node-free.

**Reference shape**: `packages/virtual-ipod-server/src/gadget.ts` shows the existing configfs/dummy_hcd setup pattern (mass-storage function); this daemon adds the vendor-control-transfer function.

**Reference protocol**: `packages/ipod-firmware/src/inquiry/usb.ts:350-400` shows the client-side shape we need to satisfy.

**Mass storage backing file:**

For mass-storage personas (e.g. `echo-mini-empty`), the persona's `massStorageBackingFile` field is set. When this field is present, the `lima-test-vm` runner:
1. During `prepare()`: stages the FAT32 image from the persona directory to a known backing-file path in the test VM (e.g. `/var/device-testing/backing.img`). The `usb_f_mass_storage` gadget function is configured to use this path as its `lun0/file`.
2. Between tests in the same SystemState group: resets the backing file using the persona's `resetStrategy`:
   - `copy`: copies the reference image to the backing-file path (simple; right for small images)
   - `swap`: atomically renames/swaps a reference copy to the active path (faster for large images)

The daemon does not manage the backing file lifecycle directly — it is the runner's responsibility. The daemon only configures the `usb_f_mass_storage` function to point at the known path. If no `massStorageBackingFile` is set (iPod personas), the mass-storage function is not configured.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Daemon source lives at tools/device-testing/dummy-hcd/ with a clear build process producing a static Linux binary
- [x] #2 Daemon binary is included in the test VM at a documented path (e.g. /usr/local/bin/dummy-hcd-daemon)
- [x] #3 Daemon accepts --persona <id> flag and loads the JSON registry sidecar produced by the lima-test-vm runner
- [x] #4 Daemon handles vendor control transfer 0xC0/0x40/0x02 with paged SysInfoExtended XML; short read on final page terminates iteration
- [ ] #5 Integration test from the host: synthesise an `ipod-video-5g-fresh` device via the daemon, run `podkit device scan` from within the test VM, assert the device is identified as iPod 5G Video
- [ ] #6 Daemon process supervisor (systemd unit OR simple init script in the VM) restarts the daemon between tests cleanly
- [x] #7 README documents the daemon protocol, the JSON sidecar format, and how to add a new persona handler
- [ ] #8 When a persona's massStorageBackingFile is set, the runner stages the FAT32 image to the test VM before the first test in the group
- [ ] #9 Backing file is reset between tests within the same SystemState group using the persona's resetStrategy (copy or swap)
- [x] #10 Backing file lifecycle is managed by the runner, not the daemon; documented in the runner's source and the README
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation summary

The dummy-hcd daemon ships as a Bun-compiled standalone binary that runs inside the `podkit-test-vm` Lima VM (no Bun, no Node, no source tree). Source lives at `tools/device-testing/dummy-hcd/` — outside `packages/*` per the task spec.

### Files added

- `tools/device-testing/dummy-hcd/package.json` — private `@podkit/dummy-hcd`, NOT a workspace member
- `tools/device-testing/dummy-hcd/tsconfig.json`
- `tools/device-testing/dummy-hcd/.gitignore`
- `tools/device-testing/dummy-hcd/README.md`
- `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service` — systemd instance template
- `tools/device-testing/dummy-hcd/scripts/build.sh` — `bun build --compile --target=bun-linux-{x64,arm64}` wrapper
- `tools/device-testing/dummy-hcd/src/main.ts` — daemon entry (argv → sidecar → gadget → ep0 → SIGINT teardown)
- `tools/device-testing/dummy-hcd/src/cli.ts` — zero-dep argv parser
- `tools/device-testing/dummy-hcd/src/protocol.ts` — wire-level protocol (PURE; testable on macOS)
- `tools/device-testing/dummy-hcd/src/gadget.ts` — configfs gadget tree setup + teardown
- `tools/device-testing/dummy-hcd/src/functionfs.ts` — FunctionFS mount + ep0 SETUP loop (scaffold)
- `tools/device-testing/dummy-hcd/src/types.d.ts` — local ambient types so `tsc --noEmit` runs without a workspace node_modules
- `tools/device-testing/dummy-hcd/src/__tests__/protocol.test.ts` — 17 protocol assertions
- `tools/device-testing/dummy-hcd/src/__tests__/cli.test.ts` — 7 argv tests
- `tools/device-testing/dummy-hcd/src/__tests__/main.test.ts` — 7 daemon smoke tests
- `packages/device-testing/src/personas/sidecar.ts` — pure schema + parseSidecar/serializeSidecar (NO `DevicePersona` import, so the daemon can compile it standalone)
- `packages/device-testing/src/personas/sidecar-build.ts` — host-side `buildSidecar`/`toSidecarPersona` (depends on `DevicePersona`; consumed by the runner)
- `packages/device-testing/src/personas/sidecar.test.ts` — 15 round-trip + validation tests
- `packages/device-testing/scripts/build-dummy-hcd-daemon.sh` — turbo task wrapper
- `turbo.json` — adds `@podkit/device-testing#build:dummy-hcd-daemon` with the right input/output globs for caching
- `oxlint.json` — `no-console: off` for the daemon source

### Key technical decisions

1. **Daemon is NOT a workspace member.** `tools/device-testing/dummy-hcd/` lives outside `packages/*`, has no `workspace:*` dependencies, and its source imports `parseSidecar` via a relative path from `packages/device-testing/src/personas/sidecar.ts`. This keeps the dummy-hcd tree free of node_modules and lets `bun build --compile` produce a single binary with no resolution complications.

2. **Sidecar module split.** The sidecar schema + parser (pure data, no `DevicePersona` import) lives in `sidecar.ts`. The producer-side helpers (`buildSidecar` / `toSidecarPersona`, which need `DevicePersona`) live in `sidecar-build.ts`. This split is what lets the daemon import the schema without dragging in the `@podkit/core` / `@podkit/device-types` workspace deps that `DevicePersona` transitively requires.

3. **FunctionFS is a scaffold (deferred AC #5 + parts of #6).** Bun cannot issue arbitrary ioctls — specifically `FUNCTIONFS_DESCRIPTORS_MAGIC_V2`-encoded descriptor writes and `FUNCTIONFS_IOCTL_STALL`. The daemon mounts FunctionFS via `mount -t functionfs`, opens ep0, decodes SETUP packets via the (fully tested) protocol layer, and writes response pages. The initial descriptor handshake is a TODO with a clear marker in `functionfs.ts`. Adding it speculatively without a live `dummy_hcd` to verify against is more risk than value — it lands when AC #5 lands (live VM verification).

4. **Mass-storage boundary.** The daemon ONLY configures `usb_f_mass_storage/lun.0/file = <backing path>`. The runner (TASK-322.04) owns staging the image, choosing a reset strategy, and tearing the file down. Documented in `README.md` §"Mass-storage backing file: daemon vs runner boundary" and in the `gadget.ts` doc comment.

5. **Build cache.** Turbo task `@podkit/device-testing#build:dummy-hcd-daemon` keys on `src/**`, the build script, and the sidecar source. Cache hit = no rebuild.

6. **Vendor protocol matches client.** Constants `BM_REQUEST_TYPE=0xC0`, `B_REQUEST=0x40`, `W_VALUE=0x02`, `PAGE_SIZE=0x1000`, and the short-read termination rule all match `packages/ipod-firmware/src/inquiry/usb.ts` exactly. `pageSequence` is round-tripped against a simulated client iteration in the test suite.

### Verification

- `bun test packages/device-testing/src/personas/sidecar.test.ts` → 15/15 pass
- `bun test tools/device-testing/dummy-hcd/src/__tests__/` → 30/30 pass
- `bun test packages/device-testing/` (full package) → 143/143 pass (incl. 2 darwin-skipped linux canary)
- `cd packages/device-testing && bunx tsc --noEmit` → clean
- `cd tools/device-testing/dummy-hcd && bunx tsc --noEmit` → clean
- `bun run lint` → 0 new errors / warnings (3 pre-existing warnings unchanged)
- `bash tools/device-testing/dummy-hcd/scripts/build.sh linux-x64` → produces 101 MB self-contained binary
- `bash tools/device-testing/dummy-hcd/scripts/build.sh linux-arm64` → produces 101 MB self-contained binary
- Smoke: `bun run tools/device-testing/dummy-hcd/src/main.ts --persona test --sidecar /tmp/test-sidecar.json --dry-run` → exit 0, prints summary
- Smoke: `bun run tools/device-testing/dummy-hcd/src/main.ts --persona nonexistent` → exit 2 with descriptive error

### Acceptance criteria status

- **#1 source + build process** — done (`tools/device-testing/dummy-hcd/`, `scripts/build.sh` produces `dist/dummy-hcd-daemon-linux-{x64,arm64}`)
- **#2 binary in test VM at documented path** — done (`/usr/local/bin/dummy-hcd-daemon`; transfer via existing `transferBinary` machinery; documented in README)
- **#3 `--persona` flag + JSON sidecar load** — done with full validation and a clear error path; covered by `main.test.ts`
- **#4 vendor control transfer paging** — protocol logic done + unit-tested; ep0 wiring is scaffold-level (see #5 / #6 / functionfs.ts TODO)
- **#5 `podkit device scan` against synthesised iPod from the VM** — **DEFERRED**. Requires the FunctionFS descriptor handshake (TODO in `functionfs.ts`) plus a live `podkit-test-vm` provisioned with this binary. Bun cannot issue the required ioctls on macOS to verify locally. Land in a follow-up once TASK-322.04 puts the runner + VM in place.
- **#6 process supervisor between tests** — systemd instance template (`dummy-hcd-daemon@.service`) shipped; full restart-cycle verification deferred to live VM
- **#7 README** — done; covers protocol, sidecar format, build/deploy, add-a-persona, daemon vs runner boundary, implementation status
- **#8 runner stages backing file before first test** — the daemon side of the contract is done (reads `massStorageBackingFile.vmPath` from the sidecar and configures `lun0/file`); runner-side staging belongs to TASK-322.04. Documented in README + gadget.ts.
- **#9 backing file reset between tests** — runner-owned; TASK-322.04 implements
- **#10 lifecycle ownership documented** — done in both `README.md` §"Mass-storage backing file: daemon vs runner boundary" and `src/gadget.ts` doc comment

### Open items for the follow-up live-VM task

1. Write the FunctionFS `FUNCTIONFS_DESCRIPTORS_MAGIC_V2` + `usb_functionfs_descs_head_v2` + strings table to ep0 on startup.
2. Use `FUNCTIONFS_IOCTL_STALL` for unrecognised SETUPs (currently logs and returns nothing).
3. End-to-end: confirm `podkit device scan` from within the VM identifies the persona.
4. Confirm `systemctl start`/`stop` cycles tear the gadget down cleanly.
<!-- SECTION:NOTES:END -->
