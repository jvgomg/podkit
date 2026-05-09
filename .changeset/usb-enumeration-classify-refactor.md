---
"podkit": patch
"@podkit/core": patch
"@podkit/devices-ipod": patch
"@podkit/devices-mass-storage": patch
---

Fix `podkit device scan` reporting phantom "Unknown iPod (USB only)" entries for non-iPod USB peripherals (mice, hubs, Thunderbolt docks, Ethernet adapters, USB drives). Each phantom suggested `podkit device init` — a destructive operation that could mutate an unrelated device.

Root cause was architectural: a single `discoverUsbIpods()` function mixed three concerns — USB enumeration, iPod-domain enrichment, and the function name's implied filter (which it didn't actually do). Refactored into clean layers:

- **`@podkit/core` — pure USB enumeration.** `enumerateUsb()` returns `EnumeratedUsbDevice[]` with vendor/product/serial/bus/devnum/diskIdentifier ONLY. No iPod-domain knowledge.
- **`@podkit/devices-ipod` — iPod classifier.** `classifyAsIpod(dev)` returns `IpodClassification | null` (matches Apple-vendor with iPod or iOS PIDs).
- **`@podkit/devices-mass-storage` — mass-storage classifier.** `classifyAsMassStorage(dev)` returns `MassStorageClassification | null` (matches `USB_PRESET_HINTS` entries like Echo Mini).
- **`@podkit/core` composer.** `classifyUsbDevices()` runs both classifiers and returns recognized devices as a tagged union; drops unknown peripherals.
- **CLI `device scan`** now calls `enumerateUsb()` → `classifyUsbDevices()` → renders by `kind`. No domain logic in the command layer.

Added `kind: 'mass-storage'` rendering branch so mass-storage DAPs are no longer mis-labeled as "Unknown iPod".

Removed `discoverUsbIpods` and the leaky `UsbDiscoveredDevice` type (which previously carried iPod-domain fields). Adding a new mass-storage device now means adding one entry to `USB_PRESET_HINTS` — no `@podkit/core` change required. Adding a new iPod generation means updating `@podkit/devices-ipod` tables — no other package changes.

Also split `usb-discovery.ts` into `usb-enumeration.ts` (bus walk) + `usb-path-resolution.ts` (mount-path → fingerprint resolver) since those two concerns were unrelated.
