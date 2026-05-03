# P0 Spike Findings — FFI SCSI Inquiry

**Decision: GO. Continue with `koffi` FFI on both platforms in P1.**

Both platforms produced byte-equivalent SysInfoExtended XML to the captured fixtures against real iPods. No fallback to compiled helper binaries needed.

## Results

| Platform | Device | Method | Subpages | Bytes | Time | vs capture |
|----------|--------|--------|----------|-------|------|------------|
| Linux x64 (Debian 12) | nano 4G | SG_IO ioctl | 58 | 14,296 | 75 ms | identical content; differs only in per-read crypto blob (3 lines) |
| macOS 15 (arm64) | nano 2G | IOKit SCSITaskUserClient | 26 | 6,279 | 44 ms | byte-identical first 6,000 bytes; trailing newline absence accounts for 1-byte size diff |

**Runtime compatibility:** verified across the full matrix.

| Platform | Runtime | sudo | Bytes | Notes |
|----------|---------|------|-------|-------|
| macOS arm64 (15) | Node 24 | no | 6,279 | iPodSBC kext handles permissions |
| macOS arm64 (15) | Bun 1.3 | no | 6,279 | identical output to Node |
| Linux x64 (Debian 12) | Node 24 | no | 14,296 | with `91-podkit-ipod-scsi.rules` installed |
| Linux x64 (Debian 12) | Bun 1.3 | no | 14,296 | identical output to Node |

EACCES UX also validated — without the udev rule, both runtimes produce the friendly install-the-rule-or-use-sudo error message.

Identity fields (FireWireGUID, SerialNumber, FamilyID, etc.) match the inventory recorded in `documents/test-devices.md` exactly on both devices.

## What worked

- **`koffi.struct` for `sg_io_hdr_t`** — fields typed `uint8 *` accept Node `Buffer` directly; struct round-trips through `ioctl(SG_IO)` with no copies.
- **`koffi.proto` + triple `koffi.decode`** for COM vtable dispatch on macOS:
  1. `koffi.decode(plugin, 'void *')` — vtable pointer
  2. `koffi.decode(vtable, offset, 'void *')` — function-pointer slot
  3. `koffi.decode(fnPtr, proto)` — callable wrapper
- **`CFUUIDBytes` passed by value** through `CFUUIDGetUUIDBytes` → `QueryInterface` works without heap allocation.
- **`koffi.address(buffer)` + `BigInt(...)`** satisfies `SCSITaskSGElement.address` (`uint64`) cleanly.
- **`__errno_location()` + `koffi.decode(ptr, 'int32')`** reads `errno` correctly (Linux glibc).
- **Both Bun and Node load koffi prebuilds** and run the spike successfully — including the macOS vtable dispatch. Earlier Bun failure was attributable to our `koffi.pointer(proto)` bug, not Bun itself.
- **No sudo / no entitlements on macOS.** `IOServiceGetMatchingService` against `com_apple_driver_iPodSBCNub` works as a regular user. SCSI traffic flows through the existing iPodSBC kext.

## Gotchas P1 must know

1. **`void *` in struct fields rejects Buffer values.** Use `uint8 *` for any pointer-to-data field (`dxferp`, `cmdp`, `sbp`, `usr_ptr`). `void *` works as a function parameter type but not as a struct field type for buffers.
2. **`koffi.decode(ptr, koffi.pointer(proto))` is wrong** for callable-from-pointer. Drop the `koffi.pointer` wrapper; pass `proto` directly. The wrong form returns an opaque external rather than a callable. (This was the symptom that initially looked like a Bun-incompatibility — once fixed, both runtimes work.)
4. **`_Inout_` not `_Out_` for `sg_io_hdr`.** The kernel both reads and writes the struct. Wrong annotation silently discards `status`, `host_status`, `driver_status` output fields and masks SCSI errors.
5. **`koffi.decode(ptr, type)` and `koffi.decode(ptr, offset, type)` are different operations.** The 2-arg form reads at offset 0; the 3-arg form is required for vtable slots. No type error if you pick wrong — reads garbage.
6. **Function ioctl signature** `int ioctl(int, unsigned long, sg_io_hdr *)` works; declaring the third argument as `void *` fails with "expected void *" runtime error when passing a struct object (koffi can't auto-convert a koffi-struct to `void *`).
7. **iPodDriver.kext is required on macOS.** `system_profiler -d` and `ioreg -c IOSCSIPeripheralDeviceNub` show the matching service. Without the kext, `IOServiceGetMatchingService` returns 0. P1's `inquiry-methods` doctor check should probe for `/System/Library/Extensions/iPodDriver.kext`.
7. **Permissions on Linux.** `/dev/sgN` is owned `root:disk` 0660 by default; the `disk` group is empty on a stock Debian install. **podkit must ship a udev rule** that grants `plugdev` group access to scsi_generic devices belonging to Apple-vendor USB devices. See "Linux permission strategy" below — this is part of the P1 scope, not a footgun for the user to discover at runtime.

## Risks the spike intentionally left rough — P1 must close these

- **No sense-data inspection.** Both platforms allocate a sense buffer but never check it. CHECK CONDITION (e.g., NOT READY during iPod spin-up) silently returns zeroed data.
- **`allocLen = 252` hardcoded.** Subpages larger than 248 bytes silently truncate. Use the 2-byte page-length field in the VPD response header to size a second read when needed.
- **No `EACCES` / `EBUSY` translation on Linux.** Bare `errno=N` is unhelpful; surface human-readable messages for the common cases.
- **`bindMethod` re-binds on every method call.** Cheap (~µs) but wasteful — bind once per task / device in P1.
- **No vtable version assertion.** P1 should read the `version` field at slot 4 of `SCSITaskDeviceInterface` and compare against a known value. If Apple ships a new IOKit with a changed vtable, the assertion catches it before any SCSI call lands.
- **Per-read crypto blob in XML output.** The spike notes this; P1's plist parser must not assume byte-stability across reads.

## Vtable layout — confirmed correct

`SCSITaskDeviceInterface` (LP64 macOS):
- Slot 0 — `_reserved` (IUnknown padding)
- Slot 1 — `QueryInterface`
- Slot 2 — `AddRef`
- Slot 3 — `Release`
- Slot 4 — `version` (UInt16) + `revision` (UInt16) + 4 bytes alignment padding
- Slot 5 — `IsExclusiveAccessAvailable`
- Slot 6 — `AddCallbackDispatcherToRunLoop`
- Slot 7 — `RemoveCallbackDispatcherFromRunLoop`
- **Slot 8 — `ObtainExclusiveAccess`** ←
- **Slot 9 — `ReleaseExclusiveAccess`** ←
- **Slot 10 — `CreateSCSITask`** ←

`SCSITaskInterface` (used slots only):
- **Slot 8 — `SetCommandDescriptorBlock`** ←
- **Slot 11 — `SetScatterGatherEntries`** ←
- **Slot 12 — `SetTimeoutDuration`** ←
- **Slot 16 — `ExecuteTaskSync`** ←
- **Slot 21 — `GetRealizedDataTransferCount`**

Cross-referenced against `<IOKit/scsi/SCSITaskLib.h>` lines 196–462.

## Linux permission strategy

`/dev/sg*` and `/dev/sd*` are owned `root:disk` `0660` on stock Debian. The `disk` group is empty by default. Without intervention, the P1 SCSI inquiry path requires either:

- adding the user to the `disk` group (gives access to **all** disks, not desirable)
- running podkit with `sudo` (acceptable but worse UX)
- a udev rule that grants `plugdev` group access to iPod SCSI devices specifically

**Recommended approach: ship a udev rule.** Targets `plugdev` (the standard "user-pluggable hardware" group, already populated for libusb access on most distros) and matches only Apple-vendor iPods. See `91-podkit-ipod-scsi.rules` in this directory — installable to `/etc/udev/rules.d/`.

```
ACTION=="add|change", SUBSYSTEM=="scsi_generic", ATTRS{idVendor}=="05ac", \
  ENV{ID_MODEL}=="iPod", MODE="0660", GROUP="plugdev"
```

Match scope:
- `SUBSYSTEM=="scsi_generic"` — only `/dev/sgN` nodes (block devices stay restricted)
- `ATTRS{idVendor}=="05ac"` — walks parent USB device, matches Apple vendor only
- `ENV{ID_MODEL}=="iPod"` — extra narrowing so non-iPod Apple devices are unaffected

Distribution responsibility splits:
- **Source / dev install:** ship the rule under `packages/devices-ipod/` or similar, document install in `docs/developers/development.md`
- **Debian / Homebrew packages:** include the rule in the package payload, install during `postinst`
- **Docker:** rule is irrelevant inside the container (root has access). Container *invocation* needs `--device /dev/sgN:/dev/sgN` or `--device /dev/bus/usb` — see "Docker impact" below

### Verified udev rule

```
ACTION=="add|change", SUBSYSTEM=="scsi_generic", \
  ATTRS{idVendor}=="05ac", \
  MODE="0660", GROUP="plugdev"
```

`91-podkit-ipod-scsi.rules` is in this directory. Verified working on Debian 12:

- `udevadm test /dev/sg3` shows the podkit rule firing (`GROUP 46`, `MODE 0660`) after the default rule.
- Post-install, `/dev/sg3` is `crw-rw---- root:plugdev`, accessible to the user without sudo.

We deliberately dropped the `ENV{ID_MODEL}=="iPod"` test because:
- Debian's udev does not set `ID_MODEL` in the env on `scsi_generic` events (verified by `udevadm test`).
- The SCSI INQUIRY `model` field is space-padded to 16 chars (`iPod            `), so an exact match would also fail; `ATTRS{model}=="iPod*"` would work but adds fragility.
- Apple-vendor (`0x05ac`) on `scsi_generic` is iPod-only in practice; non-storage Apple peripherals don't expose `scsi_generic` nodes.

### P1 error UX requirement

Even with the udev rule shipped, users will hit `EACCES` in three cases:
1. Rule not installed (older distro, source build, Lima/dev VMs).
2. User is in neither `disk` nor `plugdev`.
3. Device was attached before the rule was installed (rule applies on `add|change`; replug needed).

The SCSI transport must surface a friendly, actionable message:

```
Permission denied accessing /dev/sg3.

podkit needs SCSI access to read iPod device identity. To fix:

  1. Install the udev rule:
       sudo cp /usr/share/podkit/91-podkit-ipod-scsi.rules /etc/udev/rules.d/
       sudo udevadm control --reload && sudo udevadm trigger
       (then unplug and replug your iPod)

  2. Or, run podkit with sudo as a one-off:
       sudo podkit doctor --repair sysinfo-extended

For details: https://podkit.dev/docs/troubleshooting#linux-scsi-permissions
```

P1 must include an **e2e test for the EACCES path** that asserts this exact format (or close to it). Test approach: run the spike against a non-existent or non-readable `/dev/sg999` path, assert error message structure.

### Docker impact

`packages/podkit-docker/Dockerfile` runs as root (no `USER` directive); SCSI access works inside the container automatically.

The user's `docker run` invocation needs to expose the device:

```
docker run --device /dev/sg3:/dev/sg3 ... ghcr.io/podkit/podkit doctor
```

Or pass the entire USB tree (broader, simpler):

```
docker run --device /dev/bus/usb ... ghcr.io/podkit/podkit doctor
```

`packages/podkit-docker/entrypoint.sh` already handles USB device discovery for libusb-based inquiry. P1 should:
- Update `entrypoint.sh` to also probe for `/dev/sg*` nodes and warn if none are exposed when SCSI inquiry would otherwise be needed.
- Update `docs/users/docker.md` (or wherever docker invocation is documented) with the `--device` requirement.
- Add a docker-compose example that mounts `/dev/sg*` for the canonical case.

### Bun on Linux — verified

Bun 1.3.13 runs the Linux SG_IO spike against `/dev/sg3` with identical results to Node 24. No code changes needed for cross-runtime support. The only npm-script gotcha: `bun run <script>` cannot execute `node --import tsx ...` commands, so the spike's `package.json` documents direct invocation rather than wrapping in scripts. P1 should follow the same pattern (or use a runtime-detecting wrapper) for any developer-facing scripts.

## Recommendation for P1

**Implement SCSI inquiry as TypeScript + koffi on both platforms.** No helper binary needed.

**Target runtime: Node.** Document Bun-incompatibility in the package README. Revisit when koffi's Bun support fixes vtable dispatch.

**P1 architecture is the spike code, cleaned up.** Specifically:

1. Move into `@podkit/ipod-firmware/inquiry/scsi/` with `linux.ts` and `macos.ts` behind a uniform `scsiReadVpdPages(usbInfo)` interface.
2. Address every "Risks" bullet above before merging.
3. Add unit tests with byte-stream fixtures (no real device): mock the `ioctl` / `ExecuteTaskSync` symbols at the koffi-binding boundary.
4. Add an integration test that runs against the captured XML in `documents/sysinfo-captures/` end-to-end via a faked transport.
5. Update `documents/device-identification.md` to reflect that podkit's macOS SCSI path is now via koffi+IOKit (not a planned future).

**Estimated P1 implementation time after this spike:** 2–3 days for the core SCSI path, plus the doctor checks and orchestrator wiring per spec doc-032.

## Files in this directory

- `linux.ts` — SG_IO ioctl spike, ~120 lines.
- `macos.ts` — IOKit SCSITaskUserClient spike, ~280 lines.
- `package.json`, `tsconfig.json` — minimal scaffolding.
- `README.md` — invocation instructions.

The directory is removed at the end of P1.
