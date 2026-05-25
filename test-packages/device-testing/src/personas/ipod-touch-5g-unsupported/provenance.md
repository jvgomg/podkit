# Provenance: ipod-touch-5g-unsupported

**Source:** physical-capture (partial — USB descriptor only)
**Captured:** 2026-05-13
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS (Darwin 24.6.0)
**Capture host (Linux):** linka — not applicable (no block storage exposed; see Linux capture session below)
**Hardware serial (iOS UDID):** `637fea3cca37ff292e9cd4b26b1d411dfce06fd8`

## Mac capture session

- Date / time: 2026-05-13
- Volume: none — iPod touch in iOS mode does not expose a disk; no `/Volumes/` mount.
- Commands run:
  - `system_profiler SPUSBDataType -json` → `raw/system-profiler.json` (USB descriptor only)
- Notes:
  - `vendor_id` reported as `"apple_vendor_id"`; encoded as `0x05ac`.
  - `product_id`: `0x12aa` — matches the unsupported-PID entry in `packages/devices-ipod/src/tables/unsupported.ts:83`.
  - `serial_num`: 40-char hex UDID (iOS device identifier format), not the FireWire-style GUID of classic iPods.
  - `system_profiler` subtree contains no `Media` array (no disk mode) — `_name`, `manufacturer`, `vendor_id`, `product_id`, `serial_num`, `bcd_device`, `bus_power*`, `device_speed`, `location_id` only.
  - `diskutil list external` returned nothing for this device — confirms no disk-mode volume.
  - Per playbook recommendation, partition-layout + `lsblk` are intentionally skipped — no disk mode means no useful filesystem probes.

## Linux capture session

**Not applicable.** iPod touch in iOS mode does not expose block storage to the host kernel, so there is nothing for `lsblk` / `udevadm info -n /dev/sdX` to report. The device would appear in `lsusb` only (no `/dev/sdX` node) — and we already have authoritative USB descriptor data from the Mac-side `ioreg` capture (`raw/system-profiler.json`).

The `lsblkJson` field on this persona stays `null` permanently. The `usbDescriptor.deviceClass / Subclass / Protocol` stay at the composite-device `0/0/0` from Mac. No Linux capture is scheduled.

## SysInfoExtended source

None — iPod touch (iOS) does not expose `SysInfoExtended`.

## Expected-* fields status

Provisional. Rejection-case persona — `expectedCapabilities: null`. `expectedReadiness` uses `level: 'unknown'` because `ReadinessLevel` does not currently include an `'unsupported'` value (schema followup tracked under TASK-331). The single stage entry carries the canonical rejection message from `tables/unsupported.ts:43`. The compute-expected pass against the real readiness pipeline may emit a different `level` / stage layout; values will be reconciled at that point.

## Cross-references

- Inventory entry: `documents/test-devices.md` §"iPod touch 5th Generation (iOS)"
- Unsupported-table entry: `packages/devices-ipod/src/tables/unsupported.ts:83` (`'12aa': itouch('5th generation')`)
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md`
- TASK-321.02 (persona capture starter set)
