# Provenance: echo-mini

**Source:** physical-capture
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka (Debian 12, kernel 6.1.0-41-amd64)
**USB serial:** `USBV1.00` (generic — shared across all Echo Mini units; cannot disambiguate individuals)

## Mac capture session

- Date / time: 2026-05-13
- Volumes:
  - `/Volumes/ECHO MINI` (LUN 0, `/dev/disk4s1`, FAT32, 7.53 GB)
  - `/Volumes/Echo SD` (LUN 1, `/dev/disk5s1`, ExFAT, 126.4 GB)
- USB vendor/product: `0x071b / 0x3203` — matches `usb-hints.ts` entry → preset auto-detect resolves to `echo-mini`.
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json`
  - `diskutil list -plist /dev/disk4` → `raw/diskutil.plist` (LUN 0)
  - `diskutil list -plist /dev/disk5` → `raw/diskutil-disk5.plist` (LUN 1)
  - `ioreg -p IOUSB -l -w 0 -r -n "ECHO MINI"` → `raw/ioreg.txt` (USB descriptor authoritative source)
  - `ls -laR "/Volumes/ECHO MINI/"` → `raw/echo-mini-dirlisting.txt` (LUN 0 filesystem contents)
- Notes:
  - **Vendor ID literal:** unlike Apple devices, `system_profiler` reports the real hex string `"0x071b"` (not a vendor alias). Encoded as-is.
  - USB `bDeviceClass / bDeviceSubclass / bDeviceProtocol` confirmed `0` from `ioreg.txt`. Composite-device convention: device-level descriptor is 0/0/0; the Mass Storage class (`0x08`) lives on the interface descriptor (not captured in this top-level dump). Linux sysfs corroborates (see Linux capture session below).
  - **Two LUNs.** The Echo Mini is a multi-LUN USB Mass Storage device — macOS presents each LUN as a separate `/dev/diskN`, not as two partitions on one disk. The `DevicePersona.partitionLayout.partitions` schema lacks a LUN field, so both volumes are flattened into a single `partitions` array (entry 1 = LUN 0, entry 2 = LUN 1). The schema may need a `lun` field in a future revision if VM USB synthesis needs to model multi-LUN behaviour.
  - **Backing-image dump skipped — synthesis used instead.** The playbook's "firmware partition" assumption (< 16 MiB) does not match this device — LUN 0 (`ECHO MINI`) is 7.53 GB, far too large to commit as a backing image. The VM fixture uses the `synthesis` recipe in `types.ts` (see "Mass-storage backing file (VM synthesis)" below) rather than dumping the real device.
  - LUN 1 (`Echo SD`) is the sync target. LUN 0 is exposed but not written to by podkit.
  - SD card is `Windows_NTFS` in the plist `iocontent` field but reports as `ExFAT` in `file_system` — macOS plist labels `Windows_NTFS` for both NTFS and ExFAT iocontent types. The user-visible filesystem is ExFAT (confirmed by `file_system`). Encoded as `'ExFAT'`.

## Mac ioreg supplement (authoritative USB descriptor)

From `raw/ioreg.txt`:

| Key | Value | Notes |
|-----|-------|-------|
| `idVendor` | `1819` (`0x071b`) | matches `system_profiler` |
| `idProduct` | `12803` (`0x3203`) | matches `system_profiler` |
| `bDeviceClass` | `0` | composite-device convention |
| `bDeviceSubClass` | `0` | composite-device convention |
| `bDeviceProtocol` | `0` | composite-device convention |
| `bMaxPacketSize0` | `64` | endpoint-0 max packet (USB 2.0 high speed) |
| `bcdUSB` | `512` (`0x0200`) | USB 2.0 |
| `bcdDevice` | `512` (`0x0200`) | firmware version |
| `bNumConfigurations` | `1` | single configuration |
| `iManufacturer` / `iProduct` / `iSerialNumber` | `1` / `2` / `3` | string-descriptor indices |
| `USB Vendor Name` / `USB Product Name` | `ECHO MINI` / `ECHO MINI` | both strings identical |
| `USB Serial Number` | `USBV1.00` | generic, shared across units |
| `USBSpeed` / `Device Speed` | `3` / `2` | high speed (480 Mbps) |
| `UsbDeviceSignature` | `<1b070332000255534256312e3030000000080650>` | composite of vid/pid/serial/etc. |

Interface descriptors (Mass Storage class `0x08`, subclass `0x06` SCSI transparent, protocol `0x50` Bulk-Only) are not surfaced in this top-level `ioreg` dump but can be retrieved with `ioreg -p IOUSB -l -w 0 -r -n "ECHO MINI" | grep -A20 IOUSBInterface` if needed.

## LUN 0 filesystem contents (`/Volumes/ECHO MINI`)

From `raw/echo-mini-dirlisting.txt`:

- `/Volumes/ECHO MINI/` is **empty** from the user's perspective — only macOS-generated `.fseventsd/` (a single `fseventsd-uuid` file, 36 bytes) and `.Spotlight-V100/` (Operation not permitted — Spotlight metadata blocked by macOS for this volume).
- **No vendor system folder** (no `SYSTEM/`, `FIRMWARE/`, `.snowsky/`, configuration files, or firmware blobs). The device firmware lives in onboard NOR flash, not on the LUN 0 FAT32 partition. LUN 0 is exposed empty — appears to be a scratch / firmware-update staging volume.
- Implication for VM synthesis: a synthesised LUN 0 backing image needs no marker files. An empty FAT32 of any size (a few MiB suffices) should pass the preset auto-detect test. The `synthesis` recipe in `types.ts` is sufficient — no real-device dump is required.

## Linux capture session

- Date / time: 2026-05-13
- Capture host: linka (Debian 12, kernel 6.1.0-41-amd64)
- Device nodes: `/dev/sdc` (LUN 0, ECHO MINI firmware) + `/dev/sdd` (LUN 1, Echo SD card) — both backed by the same USB device at sysfs path `/sys/devices/.../usb1/1-2`.
- USB enumeration: `lsusb` → `ID 071b:3203 Domain Technologies, Inc. Rockchip Media Player` (see "OEM identity" finding below)
- Commands run:
  - `lsblk -J -O /dev/sdc` → `raw/lsblk-lun0.json`
  - `lsblk -J -O /dev/sdd` → `raw/lsblk-lun1.json`
  - `udevadm info` for sdc, sdd, sdc1, sdd1 → `raw/udev.txt`
  - sysfs USB descriptor dump → `raw/sysfs-usb.txt`
  - `readlink -f /sys/block/sd{c,d}` → confirmed both LUNs share the same USB-device sysfs path

### Multi-LUN architecture confirmed

Linux exposes the Echo Mini as **two distinct `/dev/sdX` block devices** (sdc + sdd) under a **single USB device** (`1-2` on bus 1). Same model macOS uses (`/dev/disk4` + `/dev/disk5`). The schema gap (`DevicePersona.partitionLayout.partitions` lacks a LUN field) remains relevant — VM USB synthesis will need to model both LUNs explicitly. This persona keeps the flattened layout but captures **two separate lsblk JSONs** in `raw/` so the multi-LUN structure is preserved on disk.

### USB descriptor sysfs reconciliation (vs Mac ioreg)

| Field | Mac ioreg | Linux sysfs | Status |
|-------|-----------|-------------|--------|
| `idVendor` | `0x071b` | `0x071b` | ✓ agree |
| `idProduct` | `0x3203` | `0x3203` | ✓ agree |
| `serial` (USB descriptor) | `USBV1.00` | `USBV1.00` | ✓ agree |
| `bDeviceClass` | `0` | `0` | ✓ agree |
| `bDeviceSubClass` | `0` | `0` | ✓ agree |
| `bDeviceProtocol` | `0` | `0` | ✓ agree |
| `bMaxPacketSize0` | `64` | `64` | ✓ agree |
| `bcdDevice` | `0x0200` | `0x0200` | ✓ agree |
| `bcdUSB` / `version` | `0x0200` | `2.00` | ✓ agree |
| `bNumConfigurations` | `1` | `1` | ✓ agree (**single-config** — contrast iPods which advertise 2) |
| `manufacturer` | `ECHO MINI` | `ECHO MINI` | ✓ agree |
| `product` | `ECHO MINI` | `ECHO MINI` | ✓ agree |

Full agreement, no divergences. Notably the Echo Mini advertises **only one USB configuration** — unlike Apple iPods (two-config: MSC + iAP). This is the simpler, more typical USB Mass Storage device shape.

### Linux-side new observations

- **OEM identity surfaces in `lsusb`.** Linux's `usb.ids` database maps `071b:3203` to **"Domain Technologies, Inc. Rockchip Media Player"** — not the FiiO/Snowsky retail brand. The descriptor strings themselves say `ECHO MINI / ECHO MINI`, so the friendly product name comes from the device. The Linux mapping reveals the OEM platform: Rockchip SoC + Domain Technologies firmware. Useful context if podkit ever needs to detect Rockchip-based DAPs as a family.
- **LUN 0 (`/dev/sdc`)**: 512-byte sectors, MBR (`pttype` not shown in summary but `parttype: "0xb"` confirms FAT32 MBR), partition starts at sector 64 (= 32 KiB into disk). Volume label `ECHO MINI`.
- **LUN 1 (`/dev/sdd`)**: 512-byte sectors, MBR, `parttype: "0x7"` (HPFS/NTFS/exFAT), `fstype: "exfat"`. Partition starts at sector 32768 (= 16 MiB into disk — large MBR padding, typical for SD cards). Volume label `Echo SD`. exFAT UUID `9C33-6BBD`.
- **Capacity arithmetic difference**: Linux reports 7 GiB + 117.8 GiB (binary GiB units); Mac reported 7.53 GB + 126.42 GB (decimal GB). Same actual content (7,532,937,216 B and 126,420,516,864 B); display-unit difference only.
- **No `pttype: "mac"`** — both LUNs are MBR-formatted (`pttype: "dos"` family), not APM.

### Linux capture status

Complete. `lsblkJson` populated with LUN 0 (FAT32 firmware partition — the one the preset framework cares about). LUN 1 (Echo SD card) lsblk JSON sits at `raw/lsblk-lun1.json` for future multi-LUN schema work. USB descriptor matches Mac ioreg exactly. Multi-LUN architecture preserved in `raw/`.

## SysInfoExtended source

None — mass-storage devices have no `SysInfoExtended`.

## Expected-* fields status

Provisional. `expectedCapabilities` mirrors the built-in `echo-mini` preset shape (`packages/devices-mass-storage/src/presets/built-in.ts`). `expectedReadiness` carries a placeholder stage layout — the compute-expected pass (per TASK-321.02 ACs) re-derives both against the real readiness pipeline (mass-storage devices likely return a different stage layout than iPod-specific stages).

## Mass-storage backing file (VM synthesis)

**Source:** synthesised inside `podkit-device-harness` at `prepare()` time — no
host-side artefact, no committed binary, no git LFS.

**Recipe:** `massStorageBackingFile.synthesis = { sizeMiB: 64, filesystem:
'FAT32', label: 'ECHO_MINI' }` in `persona.ts`.

**mkfs.vfat invocation (from `runners/lima-test-vm-backing-files.ts`):**

```
truncate -s 64M /var/device-testing/backing-files/echo-mini.img
mkfs.vfat --invariant -F 32 -n ECHO_MINI -I <path>
```

**Why FAT32:** matches the real-device LUN 0 (`ECHO MINI` firmware
volume). Echo Mini's LUN 1 is exFAT (the SD card) but the
`DevicePersona` schema is single-LUN-flat — this entry models LUN 0.
HFS+ is irrelevant for non-Apple DAPs; only FAT32 is wired up in the
VM synthesiser.

**Why 64 MiB:** the real LUN 0 is 7.53 GB — far too large to commit or
synthesise verbatim, and irrelevant to what the preset-resolution code
path actually inspects. The directory listing in
`raw/echo-mini-dirlisting.txt` confirms LUN 0 is empty (only macOS-
generated `.fseventsd/`). A 64 MiB FAT32 satisfies the auto-detect path
that maps `0x071b:0x3203` → `echo-mini` preset.

**Why empty:** TASK-348 starter content policy. The real device's LUN 0
is itself empty (no vendor system folder, no firmware blobs on disk —
firmware lives in NOR flash). The synthesised image is a faithful
projection of that.

**Determinism:** `mkfs.vfat --invariant` fixes the FAT volume ID, OEM
string, and any timestamps. Re-running the recipe is byte-identical.

**Source of truth:** the recipe in `persona.ts`. Re-derive with
`bun run build:backing-file echo-mini` from `test-packages/device-testing/`.

**Closes TASK-324 AC #8** ("echo-mini sidecar payload requirement").

## Cross-references

- Inventory entry: `documents/test-devices.md` §"FiiO Snowsky Echo Mini (mass-storage DAP)"
- Preset definition: `packages/devices-mass-storage/src/presets/built-in.ts`
- USB hints: `packages/devices-mass-storage/src/usb-hints.ts`
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
- TASK-348 — mass-storage backing-file synthesis
- TASK-317.12 — HFS+ refusal on Linux (why FAT32)
