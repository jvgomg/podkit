---
id: TASK-293.01
title: P2.1 — libusb FFI implementation in ipod-firmware
status: Done
assignee: []
created_date: '2026-05-03 11:31'
updated_date: '2026-05-05 17:49'
labels:
  - device-capability-architecture
  - phase-2
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
parent_task_id: TASK-293
ordinal: 9010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the P1 transitional shim with a real libusb-1.0 FFI implementation via koffi. Owns libusb context lifecycle (open, claim, transfer, release, close) with proper cleanup on error paths. Implements the Apple vendor control transfer (request type vendor + device-to-host, request 0x40, value 0x02, index = page) iterating until short-read terminator.

Loader handles common libusb library names (libusb-1.0.so.0, libusb-1.0.0.dylib, etc.).

See spec doc-033, Scope > Added in @podkit/ipod-firmware.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 readUsbInquiry(bus, devnum) implementation uses libusb-1.0 via koffi (no libgpod-node delegation)
- [x] #2 libusb context lifecycle handled with cleanup on all error paths
- [x] #3 Apple vendor control transfer iterates pages until short-read termination
- [x] #4 Loader handles libusb library name variance across distros
- [x] #5 Unit tests with fake libusb FFI surface cover control transfer params, chunk concatenation, error propagation, context cleanup
- [x] #6 Same external signature as P1 — orchestrator unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation summary

Replaced `packages/ipod-firmware/src/inquiry/usb.ts` with a koffi+libusb-1.0 FFI implementation. External signature unchanged — orchestrator and downstream consumers are oblivious to the swap. `inquiry/probe.ts` now loads libusb-1.0 directly via the same loader (no more `@podkit/libgpod-node` import).

## Protocol verified

Source of truth: libgpod 0.8.3 `src/itdb_usb.c` (in-tree at `tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_usb.c`). The Apple SysInfoExtended vendor control transfer is:

- `bmRequestType = 0xC0` — `LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE`
- `bRequest      = 0x40`
- `wValue        = 0x02`
- `wIndex        = page` — counter starts at 0, increments per-page
- `wLength       = 0x1000` (4096-byte buffer)
- `timeout       = 0` in libgpod (we expose `timeoutMs` instead, default 0)
- No interface claim — vendor control transfers on default control endpoint don't require one.
- Termination: short read (`transferred != PAGE_SIZE`) ends the loop. Empty initial response → `empty-response` error.

## Loader candidates

- macOS: `libusb-1.0.0.dylib`, `libusb-1.0.dylib`, `/opt/homebrew/lib/libusb-1.0.0.dylib`, `/usr/local/lib/libusb-1.0.0.dylib`
- Linux: `libusb-1.0.so.0`, `libusb-1.0.so`
- All-fail surface: `UsbInquiryError { kind: 'libusb-not-loadable' }`.

## Cleanup discipline

`withLibusbContext` (init/exit) and `withDeviceHandle` (open/close + unref) wrap the work in try/finally. Tests assert refcount/handle balance even on control-transfer error, on `open` failure, and on device-not-found.

## Hardware validation

- macOS local: libusb load verified — Homebrew `libusb-1.0.0.dylib` resolves and `libusb_init` returns 0. iPod nano 4G not plugged in (mini 2G is, but it's SCSI-only). Per task brief, macOS USB hardware validation is deferred to TASK-293.03 hardware-parity batch.
- Linux (linka): libusb-1.0.so.0 load + init/exit confirmed via koffi. **iPod nano 4G was not connected to linka at the time of this work** (lsusb -d 05ac: returned nothing). End-to-end SysInfoExtended read against real iPod could not be performed and is deferred to TASK-293.02/03 hardware parity.

## Tests

`src/inquiry/usb.test.ts` rewritten with a fake `LibusbBinding` injected via the `_binding` parameter. 16 tests cover:

- Page concatenation and short-read termination
- Control transfer params (bmRequestType=0xC0, bRequest=0x40, wValue=0x02, wIndex=page)
- Iteration of wIndex 0,1,2…
- Default + override timeout
- Lifecycle balance (init/exit, open/close, ref/unref, freeList) on success
- Lifecycle balance on control-transfer error, open failure, device-not-found
- Error paths: init-failed, device-not-found, control-transfer-failed (with libusbCode), empty-response
- bus/devnum forwarding from `UsbFingerprint`

## Quality gates

- `mise exec -- bun run --cwd packages/ipod-firmware test`: 189/189 pass
- `mise exec -- bun run --cwd packages/podkit-core test:unit`: 2509 pass / 1 skip / 0 fail
- `mise exec -- bun run typecheck`: clean
- `mise exec -- bun run lint`: clean (14 pre-existing warnings, all unrelated)
- `mise exec -- bun run build --filter @podkit/ipod-firmware`: clean

## Public surface changes

- Removed: `LibgpodReader` type export.
- Added: `loadLibusb`, `UsbInquiryError`, `UsbInquiryErrorKind`, `LibusbBinding`, `LibusbPtr`, `LibusbLoadResult`.
- `UsbReadOptions.timeoutMs` is now actually honored (was a documented no-op in P1).

## Flagged for follow-up tasks

- **TASK-293.02/03**: Real-hardware end-to-end SysInfoExtended read against nano 4G (Linux) and a USB-capable iPod on macOS. The FFI is exercised by tests but not yet by hardware in this task because no iPod was plugged into linka.
- **TASK-293.04**: `@podkit/libgpod-node`'s `readSysInfoExtendedFromUsb` is now dead code from `@podkit/ipod-firmware`'s perspective. Safe to delete the C++ shim, the dlsym lookup, and the binding's libusb dependency.
- The `koffi.decodeDeviceAt` step assumes 8-byte pointers (64-bit Bun). Fine for current targets but if 32-bit support is ever needed, swap to `koffi.sizeof('void *')`.
<!-- SECTION:NOTES:END -->
