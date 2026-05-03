---
id: doc-033
title: 'Spec: Phase 2 — USB inquiry consolidation'
type: other
created_date: '2026-05-03 11:18'
---
## Phase

P2 of doc-030 (PRD: Device Capability Architecture).

## Goal

Move USB-vendor inquiry out of the `@podkit/libgpod-node` native binding and into `@podkit/ipod-firmware`. After this phase, all iPod firmware I/O lives in TypeScript and the libgpod binding has no USB / libusb concerns.

User-visible outcome: none. The user-facing behaviour is identical to P1. P2 is the architectural cleanup that consolidates inquiry under one package.

## Scope

### Added in `@podkit/ipod-firmware`

- A real USB transport implementation in `inquiry/usb.ts` that uses `koffi` against `libusb-1.0`. Replaces the P1 transitional shim that delegated to libgpod-node.
- libusb context lifecycle handling — open, claim, transfer, release, close — with proper cleanup on error paths.
- The Apple vendor control transfer (request type vendor + device-to-host, request `0x40`, value `0x02`, index = page) iterating until short-read terminator.

### Removed from `@podkit/libgpod-node`

- `native/gpod_binding.cc` — the entire `ReadSysInfoExtendedFromUsb` function (including the dlsym shim and `ReadSysInfoExtendedFn` typedef around lines 25–35 and 283–322).
- `native/gpod_binding.cc` — the `exports.Set("readSysInfoExtendedFromUsb", ...)` line in `Init` (around line 343).
- `binding.ts` — the `readSysInfoExtendedFromUsb` field on the `NativeBinding` interface and the loader plumbing for it.
- `src/index.ts` — the `readSysInfoExtendedFromUsb` re-export.
- The TypeScript wrapper file housing it (if standalone).

### Updated in `@podkit/core`

- `device/sysinfo-extended.ts` — its `getDefaultUsbReader` helper currently dynamic-imports `@podkit/libgpod-node` to obtain the USB reader. Replaced by direct use of the firmware package (which `ensureSysInfoExtended` already calls indirectly via the inquiry orchestrator since P1). The dynamic-import fallback path becomes dead code and is removed.

### Updated build configuration

- `@podkit/libgpod-node`'s `binding.gyp` — drop the libusb pkg-config dependency. The native binding still links libgpod (which itself may or may not link libusb internally), but the binding surface no longer requires it.
- `tools/libgpod-macos/` — the macOS libgpod build still uses `HAVE_LIBUSB=1` for now (libgpod's internal use), but a follow-up may drop it. Out of scope for P2.

## Key function signatures

```typescript
// @podkit/ipod-firmware/src/inquiry/usb.ts (new implementation; same external signature as P1's shim)
export async function readUsbInquiry(bus: number, devnum: number): Promise<Uint8Array>;

// internally:
async function withLibusbContext<T>(fn: (ctx: LibusbContext) => Promise<T>): Promise<T>;
async function openDevice(ctx: LibusbContext, bus: number, devnum: number): Promise<DeviceHandle>;
async function readVendorBlock(handle: DeviceHandle, pageIndex: number): Promise<Uint8Array>;
```

The orchestrator in `inquiry/orchestrator.ts` calls `readUsbInquiry` exactly as it did in P1 — only the implementation changes.

## Acceptance criteria

1. `@podkit/ipod-firmware` USB transport reads SysInfoExtended XML via libusb on macOS and Linux against real iPods.
2. Hardware validation: nano 4G and nano 7G (the two USB-inquiry-supporting devices in the inventory) produce identical XML to what they produced under P1's libgpod-shim path.
3. `@podkit/libgpod-node` binding contains no libusb references. `grep -r 'libusb\|sysinfo_extended\|read_sysinfo' packages/libgpod-node/native/` returns nothing.
4. `@podkit/libgpod-node` builds successfully on Linux distros where libgpod is built without `HAVE_LIBUSB`. (This was the primary motivation for the dlsym shim — it can now be deleted because libusb is no longer a binding-level concern.)
5. All existing tests pass with no regressions.
6. P1's hardware validation re-run on all five devices, results unchanged.
7. Native binding build size measurably smaller. (Optional success metric — recorded in the changeset.)

## Test plan

### Unit tests

- USB transport implementation tests using a fake libusb FFI surface (intercepted at the koffi-level): verify control transfer parameters, chunk concatenation, short-read termination, error propagation, context cleanup on failure paths. Replaces and extends the thin shim tests from P1.

### Integration tests

- Existing inquiry orchestrator tests continue to pass with the new USB transport in place — they stub the transport, so nothing actually changes from their perspective. Confirms the contract.

### Hardware validation

- Re-run all five inventory devices through `podkit doctor --repair sysinfo-extended`. Confirm:
  - nano 4G, nano 7G (USB-inquiry path): XML content unchanged.
  - mini 2G, nano 2G, iPod 5G Video (SCSI-fallback path): unchanged behaviour, since SCSI is not touched in P2.

### Native binding regression

- `@podkit/libgpod-node` integration tests (database operations) continue to pass — verifies that removing USB inquiry has no side-effects on database operations.
- Manually build libgpod-node on a Debian system that lacks libusb development headers. Build should succeed (which it could not before P1's runtime dlsym, and which it should now succeed at build time too).

## Migration steps

1. Implement `inquiry/usb.ts` real transport. Tests pass against a fake libusb.
2. Wire orchestrator to use the new transport. P1's shim file deleted.
3. Hardware validation: run all 5 devices through doctor; confirm parity with P1.
4. Delete `ReadSysInfoExtendedFromUsb` from `gpod_binding.cc`, including the dlsym shim and the typedef.
5. Delete `readSysInfoExtendedFromUsb` from libgpod-node's TypeScript wrapper.
6. Update `binding.gyp` to drop libusb pkg-config dependency.
7. Rebuild libgpod-node prebuilds for all target platforms.
8. Re-run libgpod-node integration tests.
9. Re-run podkit-core tests — confirm `sysinfo-extended.ts`'s `getDefaultUsbReader` no longer needed; remove if unused.
10. Hardware re-validation.
11. Changeset entries: `@podkit/libgpod-node` (breaking removal of `readSysInfoExtendedFromUsb` export), `@podkit/ipod-firmware` (no API change).
12. Release. Document the libgpod-node export removal as a breaking change in CHANGELOG; note that all in-tree callers were already routed through `@podkit/ipod-firmware` since P1.

## Risks

- **libusb FFI complexity.** libusb structures (`libusb_context`, `libusb_device_handle`, `libusb_transfer`) are non-trivial. If the P0 spike did not cover libusb, schedule a 1-day FFI prototype before committing. The control-transfer call pattern is simple but the handle lifecycle is the gotcha.
- **libusb version variance.** libusb-1.0 ABI is stable, but distro packaging varies (`libusb-1.0.0`, `libusb-1.0.so.0`). Loader needs to handle multiple library names.
- **Hidden libgpod-node consumers.** External users of `@podkit/libgpod-node` (if any exist outside the monorepo) lose `readSysInfoExtendedFromUsb`. Not a project-internal concern but flag in the changeset.
- **macOS code-signing for libusb.** When podkit is shipped as a signed binary, FFI'd libusb needs the correct dyld permissions. Verify the packaged binary works, not just the dev environment.

## Out of scope

- Anything related to SCSI inquiry — done in P1.
- Capability resolution, identity tables — P3.
- SysInfoExtended file write — P4.
- Removing libgpod-macos's `HAVE_LIBUSB` build flag — separate cleanup, not blocking.
