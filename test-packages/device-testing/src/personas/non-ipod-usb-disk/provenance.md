# Provenance: non-ipod-usb-disk

**Source:** synthesised (no hardware)
**Created:** 2026-05-15 (TASK-324 Phase 5 — synthesised rejection personas)
**Operator:** James Greenaway (via Claude Code)

## Synthesised because

The "wrong USB stick plugged into `podkit sync`" failure mode is exactly
the case where the user does not need (and should not have to procure) a
specific physical fixture. Any non-music-player USB drive should behave
identically; SanDisk Cruzer Blade is the canonical Linux-usb-test
reference device and the most likely real-world stand-in.

This persona pairs with the SanDisk entry added to `UNSUPPORTED_VENDORS`
in `packages/devices-mass-storage/src/unsupported.ts` (same task). The
persona drives the test that pins the mass-storage classifier's
vendor-recognised-but-no-preset rejection on a non-Apple, non-Sony
vendor.

## Synthesis recipe

### USB descriptor

| Field | Value | Source |
|-------|-------|--------|
| `vendorId` | `0x0781` | SanDisk Corp. — linux-usb.org usb.ids registry, accessed 2026-05-15. |
| `productId` | `0x5567` | "Cruzer Blade" — the most common Cruzer-family PID per usb.ids and widely reported in `dmesg` / `udevadm` output across Linux distributions. |
| `deviceSerial` | `4C530001071224119242` | Representative Cruzer-format serial (20 hex chars; SanDisk uses Luhn-style serial IDs). Synthesised — not a real device serial. |
| `deviceClass / Subclass / Protocol` | `0 / 0 / 0` | Composite mass-storage flash drive — mass storage class `0x08` lives on the interface descriptor, not at device level. Same convention as every other non-Apple persona in this registry. |
| `manufacturer` / `_name` strings | `SanDisk` / `Cruzer Blade` | Standard strings the device reports in its USB string descriptors; matches what `system_profiler` and `lsusb -v` print verbatim on macOS / Linux respectively. |

### Host-probe payloads

Unlike `ipod-shuffle-not-supported`, this persona ships full host-probe
data because the non-Apple rejection happens at the mass-storage
classifier (after `classifyAsIpod` and `classifyAsMassStorage` have
already rejected the device) — and the classifier runs on populated
`PlatformDeviceInfo`, so the probes must look plausible.

| File | Synthesised from | Notes |
|------|------------------|-------|
| `raw/system-profiler.json` | `sony-nwz-e384/raw/system-profiler.json` shape | Same top-level keys + `Media`/`volumes` nesting macOS produces for any single-LUN MBR/FAT32 USB drive. Vendor strings, sizes, BSD names rewritten for a 16 GB Cruzer. |
| `raw/diskutil.plist` | `sony-nwz-e384/raw/diskutil.plist` shape | Standard `AllDisksAndPartitions` skeleton — `FDisk_partition_scheme` whole-disk wrapping a single `DOS_FAT_32` partition. Volume name `CRUZER`, mount at `/Volumes/CRUZER`. |
| `raw/lsblk.json` | Composed from `lsblk -J -O` examples in the repo | Linux equivalent of the macOS plist: removable USB disk `sdb` with a single `vfat` child partition `sdb1`. Vendor `SanDisk ` and model `Cruzer Blade    ` are reproduced exactly as Linux sysfs reports them (trailing-space-padded fixed-width fields). |

The probe payloads are deliberately consistent with the USB descriptor
(same sizes, same vendor strings, same serial) so a test that reads any
one of them lands on the same logical device.

### Expected outcomes

`expectedReadiness.level: 'unsupported'` with the canonical reason
string `'Non-Apple USB storage device (SanDisk); podkit has no preset
for this vendor (USB 0x0781:0x5567).'` — produced by the SanDisk entry's
`reason(vendorId, productId)` template in `UNSUPPORTED_VENDORS`. The
top-level `unsupportedReason` field on the `ReadinessResult` and the
`usb` stage's `details.unsupportedReason` carry the same text — see the
`rejection-personas.test.ts` smoke test for the byte-for-byte assertion.

`expectedCapabilities: null` because no preset matched.

## Cross-references

- Mass-storage unsupported table: `packages/devices-mass-storage/src/unsupported.ts` (SanDisk entry added in TASK-324)
- Mass-storage classifier composer: `packages/devices-mass-storage/src/classify.ts` (where the SanDisk vendor lookup runs)
- Sibling rejection personas: `ipod-shuffle-not-supported/` (Apple unsupported-PID variant), `sony-nwz-e384/` (Sony vendor-no-preset variant — same UNSUPPORTED_VENDORS path)
- Capture playbook: `documents/persona-capture-playbook.md` §"Synthesised personas (no hardware)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Parent task: TASK-324 Phase 5 (AC #3)
