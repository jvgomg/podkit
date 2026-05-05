# @podkit/ipod-firmware

iPod firmware inquiry — reads SysInfoExtended XML via SCSI (Linux SG_IO + macOS IOKit via koffi) or USB (libgpod-node shim).

## Why this package exists

Identifying an iPod — its generation, codec support, and database schema version — requires reading the `SysInfoExtended` plist from device firmware. This was previously scattered across `@podkit/core`. `@podkit/ipod-firmware` extracts that concern into a focused package with:

- A SCSI transport that works even when the USB path fails (iPod mini 2G, nano 2G, iPod 5G Video in some host configurations)
- A method-availability probe so callers know which transports to attempt before touching any device
- A pure TypeScript plist parser and structured extractor
- A single deep entry point (`inquireFirmware`) that handles USB-first / SCSI-fallback orchestration automatically

## Platform support

| Platform | SCSI | USB |
|----------|------|-----|
| Linux | SG_IO ioctl via koffi | libgpod-node shim |
| macOS | IOKit SCSITaskUserClient via koffi | libgpod-node shim |
| Windows | — (not implemented) | libgpod-node shim |

## Linux permissions

By default `/dev/sg*` nodes require root access. podkit ships a udev rule that grants access to members of the `plugdev` group:

```
podkit doctor --repair udev-rule
```

After installing the rule, unplug and replug the iPod. If you see a `ScsiError` with `kind === 'eacces'`, the full error message includes step-by-step recovery instructions.

## Public API

### Top-level orchestration

```typescript
import { inquireFirmware } from '@podkit/ipod-firmware';
import type { UsbFingerprint } from '@podkit/device-types';

const fp: UsbFingerprint = { vendorId: '05ac', productId: '1261', bus: 3, devnum: 4 };

const firmware = await inquireFirmware(fp);
if (firmware) {
  console.log(firmware.serialNumber);          // e.g. "7K74HBYZRP2"
  console.log(firmware.firewireGuid);          // e.g. "000A270024A23E9E"
  console.log(firmware.capabilities?.familyId); // e.g. 120 (nano 4G)
}
```

### Method-availability probe

```typescript
import { probeInquiryMethods } from '@podkit/ipod-firmware';

const avail = await probeInquiryMethods();
// { scsi: { available: true }, usb: { available: false, reason: '...' } }
```

### Plist parser and extractor

```typescript
import { parsePlist, extractFromPlist } from '@podkit/ipod-firmware';

const plist = parsePlist(xmlString);
const firmware = extractFromPlist(plist, xmlString);
```

### SCSI transport (advanced)

```typescript
import { scsiReadVpdPages, ScsiError } from '@podkit/ipod-firmware';

try {
  const bytes = await scsiReadVpdPages(fp);
  // bytes is the raw concatenated SysInfoExtended XML
} catch (err) {
  if (err instanceof ScsiError) {
    switch (err.kind) {
      case 'eacces': /* install udev rule */ break;
      case 'timeout': /* retry or report */ break;
      case 'kext-missing': /* macOS: iPodDriver.kext not loaded */ break;
    }
  }
}
```

## API reference

| Export | Kind | Description |
|--------|------|-------------|
| `inquireFirmware(fp, opts?)` | function | USB-first / SCSI-fallback orchestration. Returns `ParsedFirmware \| null`. Never throws. |
| `probeInquiryMethods(opts?)` | function | Detect which transports are available on the current host. Result is cached. |
| `parsePlist(xml)` | function | Parse Apple plist XML subset into a typed `PlistValue` tree. |
| `extractFromPlist(plist, rawXml)` | function | Map plist tree to `ParsedFirmware`. Returns `null` when required identity fields are absent. |
| `scsiReadVpdPages(fp, opts?)` | function | Direct SCSI VPD read. Platform-dispatches to Linux SG_IO or macOS IOKit. |
| `readUsbInquiry(fp, opts?)` | function | Direct USB read via libgpod-node. |
| `bigintToFireWireGuid(v)` | function | Format a 64-bit bigint GUID as a 16-char uppercase hex string. |
| `ScsiError` | class | Discriminated error from the SCSI transport. Inspect `.kind` for branching. |
| `chooseTransports(avail)` | function | Pure transport-selection planner: returns `'usb-only' \| 'scsi-only' \| 'usb-then-scsi' \| 'none'`. |
| `clearProbeCache()` | function | Reset the probe cache. Use in tests between cases. |

## Hardware validation

Tested against:

- iPod nano 2G — macOS, SCSI via IOKit
- iPod nano 4G — Linux, SCSI via SG_IO

## Dependencies

- `koffi` — FFI for SG_IO (Linux) and IOKit (macOS) SCSI access
- `@podkit/device-types` — shared type definitions
- `@podkit/libgpod-node` — USB inquiry shim (transitional; replaced in P2 with a native koffi/libusb implementation)
