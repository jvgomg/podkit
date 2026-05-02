# Device Testing Playbook

Step-by-step workflows for validating podkit's device identification against real iPod hardware. Organized into phases that build on each other.

Last updated: 2026-05-02

Reference documents:
- [Device Identification Strategies](device-identification.md) — problem space, strategies, platform details
- [Test Device Inventory](test-devices.md) — hardware collection, known results, coverage analysis

## Phase 1: Research

**Goal:** Answer open questions about device capabilities and inquiry support boundaries through codebase analysis and web research. Update the living documents with findings before touching real hardware.

### 1.1 Inquiry boundary research

Research which iPod generations support SCSI inquiry and USB inquiry. Sources to check:

- libgpod source (`tools/libgpod-macos/build/libgpod-0.8.3/`) — look for generation-specific conditionals or comments in `itdb_usb.c`, `ipod-scsi.c`, and `generic-callout.c`
- libgpod commit history and changelogs — when was USB inquiry support added and what was the motivation?
- linux-usb.org device database — USB product ID to device mapping
- Rockbox wiki and source — Rockbox developers have documented iPod hardware extensively
- iPodLinux wiki archives — early iPod hardware documentation
- Apple tech specs pages — generation timelines and hardware capabilities

**Update:** `documents/device-identification.md` open questions section with findings.

### 1.2 SysInfo write behaviour research

Research which iPod generations write a populated SysInfo file when formatted. Sources:

- libgpod source — `itdb_init.c` or similar, check what gets written during `itdb_init_ipod()`
- Format/restore behaviour documentation from Rockbox or iPodLinux communities
- Test with available devices (Phase 2 will capture current SysInfo state for each device)

**Update:** `documents/device-identification.md` with findings.

### 1.3 Generation table accuracy audit

Compare podkit's hardcoded generation tables (`ipod-models.ts`) against:

- libgpod's `itdb_device.c` tables — model numbers, serial mappings
- SysInfoExtended XML captured from real devices — artwork dimensions, codec support
- Apple's published specs — capacities, display resolutions

Focus on devices in the test collection first, then expand.

**Update:** Note discrepancies for correction. Feed into validation phase.

### 1.4 nano 7G investigation

Research the nano 7G's database format and compatibility:

- Does it use standard iTunesDB?
- What checksum type does it actually use? (currently listed as `none` — verify)
- What is the expected inquiry behaviour?
- Are there known libgpod compatibility issues?

**Update:** `documents/device-identification.md` and `documents/test-devices.md`.

## Phase 2: Device Inventory

**Goal:** Plug in each iPod, capture complete identification data, test all inquiry methods, and populate the test device inventory. Each device gets the same procedure.

### Per-device procedure

Run this for each iPod in the collection. Record all results in `documents/test-devices.md`.

#### Step 1: USB enumeration

```bash
system_profiler SPUSBDataType 2>/dev/null | grep -A 15 "iPod"
```

Record: product ID, vendor ID, serial (FireWire GUID), bus number, device address, location ID.

#### Step 2: Mount point and filesystem state

```bash
diskutil list | grep -B 2 "<VOLUME_NAME>"
ls -la "/Volumes/<VOLUME_NAME>/iPod_Control/Device/"
cat "/Volumes/<VOLUME_NAME>/iPod_Control/Device/SysInfo"
cat "/Volumes/<VOLUME_NAME>/iPod_Control/Device/SysInfoExtended"
```

Record: volume name, filesystem type (FAT32/HFS+), SysInfo contents (or empty/missing), SysInfoExtended contents (or absent).

#### Step 3: Device identification via podkit

```bash
bun -e "
import { deviceFromMountPoint } from './packages/libgpod-node/src/index.ts';
const dev = deviceFromMountPoint('/Volumes/<VOLUME_NAME>');
console.log('Capabilities:', JSON.stringify(dev.getCapabilities(), null, 2));
console.log('Info:', JSON.stringify(dev.getInfo(), null, 2));
console.log('ModelNumStr:', dev.getSysInfo('ModelNumStr'));
dev.close();
"
```

Record: what libgpod identifies the device as. Note if it reports "Invalid" (empty SysInfo) or correctly identifies the model.

#### Step 4: SCSI inquiry

Run the IOKit SCSI test program (macOS):

```bash
/tmp/test_scsi_read_xml
```

Record: success/failure, number of VPD subpages, XML byte count. Save the full XML output to `documents/sysinfo-captures/<device-name>.xml` for reference.

#### Step 5: USB inquiry

```bash
bun -e "
import { readSysInfoExtendedFromUsb } from './packages/libgpod-node/src/index.ts';
try {
    const xml = readSysInfoExtendedFromUsb(<BUS>, <DEVICE>);
    console.log('Length:', xml?.length);
    console.log(xml);
} catch (err) {
    console.log('Error:', err.message);
}
"
```

Record: success/failure, XML byte count, error message if failed.

#### Step 6: Model lookup verification

```bash
bun -e "
import { resolveIpodModel } from './packages/podkit-core/src/device/ipod-models.ts';

// From USB product ID
const usb = resolveIpodModel({ from: 'usb', productId: '<PRODUCT_ID>' });
console.log('USB:', JSON.stringify(usb, null, 2));

// From serial (if available from inquiry)
const serial = resolveIpodModel({ from: 'serial', serialNumber: '<SERIAL>' });
console.log('Serial:', JSON.stringify(serial, null, 2));
"
```

Record: whether USB lookup matches serial lookup. Note any discrepancies between generation table data and firmware-reported data (especially artwork dimensions).

#### Step 7: Compare generation table vs firmware data

If SCSI or USB inquiry succeeded, compare the firmware-reported capabilities against what podkit's generation tables say:

- Artwork format dimensions — do the firmware-reported sizes match what podkit would use?
- Audio codec support — any codecs in firmware data that the generation table doesn't expect?
- Video codec constraints (if video-capable) — resolution limits, profiles, levels

Record discrepancies for correction in the generation table accuracy audit.

### macOS plist cache check

Run once (not per-device) to capture what macOS has cached:

```bash
plutil -p ~/Library/Preferences/com.apple.iPod.plist
```

Cross-reference each entry's FireWire GUID against the device inventory. Note any devices present in the cache that aren't in the physical collection (previously owned devices).

## Phase 3: Validation

**Goal:** After implementation of SCSI inquiry support and device capability architecture changes, systematically test each device to verify the new code works correctly.

### Pre-validation setup

1. Build podkit with the new device identification code
2. Ensure the SCSI inquiry test program compiles and runs
3. Have the test device inventory document open for recording results

### Per-device validation procedure

#### Step 1: Clear existing identification data

Remove cached identification from the device to test fresh discovery:

```bash
# Back up existing files first
cp "/Volumes/<NAME>/iPod_Control/Device/SysInfo" "/tmp/sysinfo-backup-<device>" 2>/dev/null
cp "/Volumes/<NAME>/iPod_Control/Device/SysInfoExtended" "/tmp/sysinfo-ext-backup-<device>" 2>/dev/null

# Clear the files
> "/Volumes/<NAME>/iPod_Control/Device/SysInfo"
rm "/Volumes/<NAME>/iPod_Control/Device/SysInfoExtended" 2>/dev/null
```

#### Step 2: Test device scan

```bash
podkit device scan
```

Verify: device is discovered, generation is correctly identified from USB enumeration, display output is sensible.

#### Step 3: Test device info

```bash
podkit device info -d "/Volumes/<NAME>"
```

Verify: device capabilities are reported, inquiry method is used, firmware data is surfaced.

#### Step 4: Test doctor checks

```bash
podkit doctor -d "/Volumes/<NAME>"
podkit doctor --repair sysinfo-extended -d "/Volumes/<NAME>"
```

Verify: doctor correctly identifies missing SysInfoExtended, repair uses the appropriate inquiry method (SCSI preferred), SysInfoExtended is written to disk, device is now fully identified.

#### Step 5: Verify written data

```bash
cat "/Volumes/<NAME>/iPod_Control/Device/SysInfoExtended"
```

Compare against the XML captured in Phase 2. Should be identical (minus dynamic fields like the cryptographic blob).

#### Step 6: Test sync capability

```bash
podkit sync --dry-run -d "/Volumes/<NAME>"
```

Verify: sync planning completes without errors, device capabilities are correctly applied (artwork dimensions, codec selection).

#### Step 7: Restore original state

```bash
# Restore backed-up files
cp "/tmp/sysinfo-backup-<device>" "/Volumes/<NAME>/iPod_Control/Device/SysInfo" 2>/dev/null
cp "/tmp/sysinfo-ext-backup-<device>" "/Volumes/<NAME>/iPod_Control/Device/SysInfoExtended" 2>/dev/null
```

### Cross-device checks

After all devices are validated individually:

1. **Inquiry method matrix** — confirm which methods work on which devices. Update test-devices.md.
2. **Checksum verification** — for hash58 devices (nano 4G, iPod 5G), verify that the firmware-reported FireWire GUID produces valid checksums.
3. **Capability comparison** — compare firmware-reported artwork dimensions across devices. Do they match what podkit would have used from generation tables?
4. **Supported devices documentation** — update the public docs site with verified device compatibility data: which models are tested, which inquiry methods work, any known limitations.

## Capturing SysInfoExtended XML

When capturing SysInfoExtended XML from devices, save them as reference fixtures:

```
documents/
  sysinfo-captures/
    nano-2g-green-4gb.xml
    nano-4g-8gb.xml
    nano-7g-<details>.xml
    mini-2g-<details>.xml
    ipod-5g-video-<details>.xml
```

These serve as:
- Reference data for generation table verification
- Potential test fixtures for unit testing the XML parser
- Documentation of real device capabilities for future developers
