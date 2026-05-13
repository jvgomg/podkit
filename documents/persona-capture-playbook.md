# Persona Capture Playbook

Step-by-step directive for an agent + human pair to capture `DevicePersona` fixtures for `@podkit/device-testing`. Read this file in full before starting a capture session. Each persona produces a self-contained directory of probe data + a typed TypeScript file that downstream tests import.

**Audience:** an agent collaborating with the user on a hardware-capture session. The user supplies the hardware and runs the destructive (plug/unplug) steps. The agent runs the read-only capture commands, writes files, and updates the registry.

## Reference materials

| File | Why |
|------|-----|
| `adr/adr-017-device-persona-fixtures.md` § "DevicePersona schema" + § "Capture methodology" | Authoritative schema + capture rationale |
| `packages/device-testing/src/personas/types.ts` | The canonical TypeScript type — every persona file must satisfy this |
| `packages/device-testing/src/system-states/healthy.ts` | Example of a sibling fixture file's shape — match the comment/structure style |
| `documents/test-devices.md` | Inventory of the user's hardware with model numbers, serial-suffix mappings, and notes per device |
| `documents/sysinfo-captures/` | Pre-existing SysInfoExtended XML payloads for 7 of the 9 iPods — reuse these; do NOT re-capture |
| `documents/device-identification.md` | USB-inquiry vs SCSI-fallback boundary + transport semantics |

Open the type file once. Refer to it whenever you write a persona — every field must be populated (`null` is valid for the documented optional fields).

## Hardware inventory + capture targets

User has 9 physical devices and we want **2 additional synthesised personas** (rejection cases). Capture all 11 in one pass so we never have to redo this.

| # | Persona ID | Device | Inquiry path | SIE XML to reuse |
|---|-----------|--------|--------------|-------------------|
| 1 | `ipod-video-5g-iflash-1tb` | iPod 5G Video (iFlash 1TB mod) | SCSI-fallback | `documents/sysinfo-captures/ipod-5g-video-iflash-1tb.xml` |
| 2 | `ipod-mini-2g-pink` | iPod mini 2G (4GB Pink) | SCSI-fallback | `documents/sysinfo-captures/mini-2g.xml` |
| 3 | `ipod-nano-2g-green` | iPod nano 2G (4GB Green) | SCSI-fallback | `documents/sysinfo-captures/nano-2g-4gb-green.xml` |
| 4 | `ipod-nano-3g-black` | iPod nano 3G (8GB Black) | USB-inquiry (boundary) | `documents/sysinfo-captures/nano-3g-8gb-black.xml` |
| 5 | `ipod-nano-4g-black` | iPod nano 4G (8GB Black) | USB-inquiry | `documents/sysinfo-captures/nano-4g-8gb-black.xml` |
| 6 | `ipod-nano-7g-space-gray` | iPod nano 7G (16GB Space Gray) | USB-inquiry | `documents/sysinfo-captures/nano-7g-16gb-usb.xml` (preferred — also has `-scsi.xml`) |
| 7 | `ipod-nano-7g-blue` | iPod nano 7G #2 (16GB Blue) | USB-inquiry | `documents/sysinfo-captures/nano-7g-16gb-blue-usb.xml` |
| 8 | `echo-mini` | FiiO Snowsky Echo Mini DAP | mass-storage preset | — (no SIE; mass-storage device) |
| 9 | `ipod-touch-5g-unsupported` | iPod touch 5G (iOS) | rejection case | — (no SIE; iOS) |
| 10 | `ipod-shuffle-not-supported` | shuffle (synthesised) | rejection case | synthesised |
| 11 | `non-ipod-usb-disk` | generic USB drive (synthesised) | rejection case | synthesised |

> **Scope note:** TASK-321.02 originally targeted 3 starter personas (`ipod-video-5g-fresh`, `ipod-nano-7g-populated`, `echo-mini-empty`). The user has chosen to capture the full inventory in one sitting; extra personas beyond the original 3 are bonus and not required by the task ACs. Track them as committed fixtures — no new tasks needed.

## Output layout (per persona)

For **each** persona, produce this directory:

```
packages/device-testing/src/personas/<persona-id>/
├── persona.ts                    # exports the typed DevicePersona value
├── provenance.md                 # capture-session metadata (template below)
├── raw/
│   ├── system-profiler.json      # raw `system_profiler SPUSBDataType -json` excerpt
│   ├── diskutil.plist            # raw `diskutil list -plist <disk>` output
│   ├── lsblk.json                # raw `lsblk -J -O <dev>` output
│   └── sysinfo-extended.xml      # symlink or copy from documents/sysinfo-captures/ (iPod only)
└── (for echo-mini only)
    └── mass-storage-backing.img  # FAT32 backing image dump (or recipe — see §"Mass-storage backing file")
```

Commit raw probe files alongside the persona — they are the evidence trail for the embedded TypeScript values and let us re-derive everything if the schema evolves.

### Registry registration

After writing `<persona-id>/persona.ts`, add an import + map entry to:

`packages/device-testing/src/personas/index.ts`

```ts
import { ipodVideo5gIflash1tb } from './ipod-video-5g-iflash-1tb/persona.js';
// …one import per persona

export const personas = new Map<string, DevicePersona>([
  [ipodVideo5gIflash1tb.id, ipodVideo5gIflash1tb],
  // …one entry per persona
]);
```

Match the existing `system-states/index.ts` pattern (each state has its own file, all wired into the registry map at module load).

## Capture session A — macOS

This session captures `system_profiler`, `diskutil`, and partition layout for every device. Run from the user's Mac.

### Pre-flight

1. Confirm no iPod is currently plugged in (`system_profiler SPUSBDataType -json | jq '.SPUSBDataType[].['_items']'` should not show Apple iPod entries).
2. Have `documents/test-devices.md` open — the agent will cross-reference model number / serial suffix against it for each device.
3. Confirm `jq`, `plutil`, and `diskutil` are present (`which jq plutil diskutil`).

### Per-device protocol (repeat for each iPod + Echo Mini)

For each device, the agent runs these commands in sequence after the user confirms the device is plugged in and mounted:

**1. Identify the device (user confirms which is plugged in, agent verifies):**

```bash
system_profiler SPUSBDataType -json | jq '[.SPUSBDataType[] | recurse(.["_items"]?[]?) | select(.manufacturer=="Apple Inc." or (.vendor_id|test("0x05ac")) or .product_id|test("Echo|FiiO"))]'
```

Agent extracts: `vendor_id`, `product_id`, `serial_num`, `bcd_device`. User confirms it matches the expected device from the inventory.

**2. Find the disk identifier:**

```bash
diskutil list external
```

User reads off the device's `/dev/diskN` path. Agent records it.

**3. Capture USB descriptor JSON (full subtree for this device):**

```bash
system_profiler SPUSBDataType -json > /tmp/sp-full.json
# Agent then walks the JSON to find the specific device's subtree and writes
# packages/device-testing/src/personas/<id>/raw/system-profiler.json with just that subtree.
```

> Save only the device's own subtree (the object containing `_name`, `vendor_id`, `product_id`, `serial_num`, etc.), not the whole `SPUSBDataType` array. This keeps fixtures small + diffable.

**4. Capture `diskutil list -plist` for this device only:**

```bash
diskutil list -plist /dev/diskN > packages/device-testing/src/personas/<id>/raw/diskutil.plist
```

**5. Compose `usbDescriptor` from the JSON:**

```ts
usbDescriptor: {
  vendorId: 0x05ac,           // from `vendor_id` (parse "0x05ac (Apple Inc.)")
  productId: 0x1209,          // from `product_id`
  deviceSerial: '000A270014…', // from `serial_num`
  deviceClass: 0,             // top-level USB class — usually 0 for composite devices
  deviceSubclass: 0,
  deviceProtocol: 0,
}
```

For `deviceClass/Subclass/Protocol`: macOS `system_profiler` doesn't always surface these cleanly. If absent, set all three to `0` and note in `provenance.md` that the Linux capture (sysfs) will provide the authoritative values. The Linux session will reconcile.

**6. Compose `partitionLayout` from the plist:**

The plist contains an `AllDisksAndPartitions` array with `Partitions[]` entries. Each partition has `Content` (type, e.g. `Apple_HFS`, `DOS_FAT_32`), `Size` (bytes), `MountPoint`. Map to:

```ts
partitionLayout: {
  partitions: [
    { index: 1, type: 'firmware',     sizeMiB: 80,    /* no mountpoint */ },
    { index: 2, type: 'HFS+',         sizeMiB: 952832, mountpoint: '/Volumes/iPod' },
  ],
}
```

Partition types: prefer human labels (`'firmware'`, `'HFS+'`, `'FAT32'`, `'empty'`) over the plist's raw `Apple_HFS` / `DOS_FAT_32` strings. Document the mapping in `provenance.md` if you do anything non-obvious.

**7. SysInfoExtended XML (iPod-only):**

For iPods 1–7 in the inventory, do **not** re-capture — the XML already exists in `documents/sysinfo-captures/`. Symlink or copy it into `raw/`:

```bash
cp documents/sysinfo-captures/<existing-file>.xml \
   packages/device-testing/src/personas/<id>/raw/sysinfo-extended.xml
```

Then in `persona.ts`, load it via `readFileSync` at module load:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sysInfoExtendedXml = readFileSync(join(here, 'raw/sysinfo-extended.xml'), 'utf8');
```

For Echo Mini + touch 5G: `sysInfoExtendedXml: null`.

**8. Mass-storage backing file (Echo Mini only):**

The Echo Mini exposes two volumes: `ECHO MINI` (firmware, small) + `Echo SD` (FAT32 user partition on SD card). For Tier 3 USB synthesis we only need the firmware volume's backing image — small, content-stable. Capture it:

```bash
# User identifies the firmware partition disk (the small one).
sudo dd if=/dev/diskNs1 of=packages/device-testing/src/personas/echo-mini/raw/mass-storage-backing.img bs=4M status=progress
```

> Confirm the partition is < 16 MiB before dumping. If it's the SD-card partition (126 GB), STOP — that's the wrong partition. Document the firmware partition's size in `provenance.md`.

Reference in `persona.ts`:

```ts
massStorageBackingFile: {
  imagePath: './raw/mass-storage-backing.img',
  resetStrategy: 'copy',
},
```

For all other personas: `massStorageBackingFile: null`.

### After the Mac session

The agent commits the per-persona directories with `system-profiler.json`, `diskutil.plist`, and (for iPods) the linked SIE XML. `lsblk.json` is missing — that's expected; the Linux session fills it.

Persona files at this point are **provisional** (`lsblkJson: null`, expected-* fields synthesised from generation/preset defaults). Note in each `provenance.md` that the Mac capture is complete and the Linux capture is the next step.

## Capture session B — Linux (linka)

Same physical devices, plugged into the user's Linux box (`linka`). Captures `lsblk` output and reconciles USB descriptor class/subclass/protocol from sysfs.

### Pre-flight

1. SSH to linka (user runs from their Mac: `ssh james@linka`) or runs commands locally on linka.
2. Confirm `lsblk`, `jq`, and root access via `sudo`.
3. Verify the persona directories from the Mac session are checked into the branch the agent is working on.

### Per-device protocol

**1. User plugs device in. Agent confirms it appears:**

```bash
lsblk -d -o NAME,SIZE,MODEL,VENDOR,TRAN | grep -iE "apple|ipod|echo|fiio"
```

User confirms which `/dev/sdX` matches.

**2. Capture `lsblk -J` for this device with full output columns:**

```bash
sudo lsblk -J -O /dev/sdX > packages/device-testing/src/personas/<id>/raw/lsblk.json
```

The `-O` flag emits every available column (PTUUID, PARTUUID, MODEL, SERIAL, FSTYPE, etc.). Massive but structured. Tier 1 tests only consume specific fields — keeping the full dump means future tests don't need re-capture.

**3. Reconcile USB descriptor class/subclass/protocol from sysfs:**

```bash
udevadm info --query=all --name=/dev/sdX | grep -E "ID_USB|ID_VENDOR|ID_MODEL|ID_SERIAL"
```

```bash
# Find the USB device node from the block device
DEVPATH=$(udevadm info -q path -n /dev/sdX)
# Walk up to find the USB device directory
USB_PATH=/sys${DEVPATH%/host*}/..
cat $USB_PATH/idVendor $USB_PATH/idProduct $USB_PATH/serial \
    $USB_PATH/bDeviceClass $USB_PATH/bDeviceSubClass $USB_PATH/bDeviceProtocol
```

Agent updates the `usbDescriptor` in `persona.ts` with the authoritative class/subclass/protocol values from sysfs. If the Mac session set them to `0`, replace; if they already matched, note "Linux-confirmed" in `provenance.md`.

**4. Update `partitionLayout` if Linux probes reveal anything Mac missed.** Usually they agree; HFS+ partitions on Linux read as `hfsplus` or `unknown` (no HFS driver). FAT32 reads as `vfat`. The Mac plist is authoritative for partition types on Apple-formatted devices.

### After the Linux session

Every persona directory now has all four raw files (or three + null for non-iPod). Time to compute the expected-* fields.

## Computing the expected fields

`expectedCapabilities`, `expectedReadiness`, `expectedDoctorOutput` are typed snapshots of what the production functions return for this persona. There are two strategies; pick the one that fits each persona.

### Strategy 1 — run the real functions (preferred for supported devices)

For personas 1–7 (supported iPods) and 8 (Echo Mini), the agent writes a small one-off script that loads the persona's raw probes and invokes the production resolver. Pseudo:

```ts
// scripts/compute-expected.ts (one-off, do NOT commit)
import { readFileSync } from 'node:fs';
import { resolveCapabilities } from '@podkit/core';
import { checkReadiness } from '@podkit/core';

const sie = readFileSync(`packages/device-testing/src/personas/${id}/raw/sysinfo-extended.xml`, 'utf8');
const usb = { vendorId: 0x05ac, productId: 0x1209, /* … */ };
const caps = resolveCapabilities({ identity: /* derived from usb+sie */ });
console.log(JSON.stringify(caps, null, 2));
```

Run, capture the JSON output, paste into `persona.ts` as `expectedCapabilities`. Repeat for readiness + doctor.

> Production resolver signatures may have changed since this playbook was written. The agent should `git grep -n "export function resolveCapabilities"` and `export function checkReadiness` to find current entry points, then read the function comments to learn how to invoke them.

### Strategy 2 — synthesise (rejection cases)

For personas 9–11 (touch 5G, shuffle, non-iPod), the production functions will refuse to identify the device. Set:

```ts
expectedCapabilities: null,
expectedReadiness: {
  level: 'unsupported',
  stages: [{
    stage: 'usb',
    status: 'failed',
    summary: 'Device not supported',
    details: { unsupportedReason: '<reason text from real podkit output>' },
  }],
},
expectedDoctorOutput: {}, // doctor refuses to run; empty object is acceptable for rejection personas
```

The exact `unsupportedReason` text comes from `packages/devices-ipod/src/unsupported.ts` for the iPod touch + shuffle cases; for `non-ipod-usb-disk`, doctor doesn't even reach the unsupported-PID gate (per the notes in `documents/test-devices.md`) — assert the rejection at the `device add` layer instead.

## provenance.md template

Drop this into each persona directory and fill the placeholders:

```markdown
# Provenance: <persona-id>

**Source:** physical-capture (or synthesised)
**Captured:** YYYY-MM-DD
**Capture operator:** James Greenaway
**Capture host (Mac):** macOS <version>, <Mac model + chip>
**Capture host (Linux):** linka, Debian <version>, kernel <version>
**Hardware serial:** <serialNumber from USB descriptor>
**Apple model number:** <e.g. A1320>  *(iPods only)*

## Mac capture session
- Date / time: YYYY-MM-DD HH:MM
- Commands run: (list briefly — `system_profiler`, `diskutil list -plist`, etc.)
- Notes: (anything unusual — partition surprises, USB descriptor gaps, multiple mount points)

## Linux capture session
- Date / time: YYYY-MM-DD HH:MM
- Commands run: `lsblk -J -O`, `udevadm info`, `cat /sys/.../bDeviceClass`, …
- Notes: (USB class/subclass reconciliation outcomes, Linux-only partition observations)

## SysInfoExtended source
- Origin: `documents/sysinfo-captures/<filename>.xml`
- Captured (originally): <date from test-devices.md if available>
- Inquiry transport used: USB | SCSI | both

## Cross-references
- Inventory entry: `documents/test-devices.md` § "<device section heading>"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Capture playbook: `documents/persona-capture-playbook.md` (this file)
```

## Synthesised personas (no hardware)

These three personas have no raw probe files — they exist to test the rejection paths in `identify()` and `device add`.

### `ipod-shuffle-not-supported`

User does not own an iPod shuffle. Synthesise:

- `usbDescriptor`: pick a real shuffle 4G product ID from `packages/devices-ipod/src/identity.ts` or `unsupported.ts` (search for "shuffle"). Vendor `0x05ac`, product `0x1300` (shuffle 4G) is a reasonable choice; cross-check against the table.
- `sysInfoExtendedXml: null` (shuffles don't expose SIE)
- All Mac/Linux probe fields: `null`
- `partitionLayout`: empty partitions array (shuffle's FAT16 layout isn't material for the rejection test).
- `expectedCapabilities: null`
- `expectedReadiness`: rejection level with unsupportedReason from `unsupported.ts`
- `provenance.source: 'synthesised'`
- No `raw/` directory; no `provenance.md` Mac/Linux sections needed — replace with a "Synthesised because: <reason>" paragraph.

### `non-ipod-usb-disk`

Generic non-Apple USB drive — should fall through every iPod identification path silently.

- `usbDescriptor`: a generic vendor (e.g. SanDisk `0x0781`, product `0x5567` Cruzer Blade). Confirm by web search if needed; the values are illustrative, not validated.
- All other fields `null` or empty.
- `expectedReadiness`: not an iPod / not a known mass-storage preset; `level: 'unknown'` with empty stages (or whatever the readiness pipeline returns when `identify()` returns undefined — verify by reading `packages/podkit-core/src/device/readiness/`).

### `ipod-touch-5g-unsupported`

The user **does** own a touch 5G. Decide together: capture real (treat as a 10th physical-capture persona) OR mark synthesised. The advantage of real capture is the `usbDescriptor` is authoritative. Recommend: capture USB descriptor + system_profiler (fast, no disk operations), skip partition layout + lsblk (touch in iOS mode doesn't expose disk volumes). Mark `provenance.source: 'physical-capture'` with notes that probes were partial.

## Validation pass

After every persona is registered in `packages/device-testing/src/personas/index.ts`:

1. `bun run build --filter @podkit/device-testing` — every persona must compile under the `DevicePersona` type. TypeScript errors here are the most common capture-mistake signal.
2. `bun run test:unit --filter @podkit/device-testing` — the existing scaffold smoke test (`runtime.test.ts`) asserts the personas Map has the expected size. Update that test to expect 11 entries instead of 0.
3. Add a per-persona smoke test (loads each, asserts `expectedCapabilities` deep-equals running `resolveCapabilities` against the persona's inputs, asserts `expectedReadiness` deep-equals `checkReadiness`). This is task AC #6 of TASK-321.02 — the test enforces that fixtures don't silently drift from production behaviour.
4. `bun run lint` — clean.
5. Update `documents/test-devices.md` — append a "Persona captured: `<persona-id>` (YYYY-MM-DD)" line under each device's section.
6. Commit per persona (one commit per persona, or one combined commit for the whole session — agent's call based on PR review preference).

## Failure modes + recovery

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `diskutil` shows no device when plugged in | Device hasn't finished initialising (iPod sync), or it's in iOS update mode | Wait 30s; re-plug; check Finder mounts it |
| `system_profiler` shows the device but no serial | Some iPods don't expose serial on the USB level until disk mode | Verify device is in disk mode (touch wheel → Settings → Reset for older iPods) |
| `lsblk` on linka shows device but no model | New udev rule missing — check `sudo udevadm trigger` cleared the cache | Or set the model field to `null` and note in provenance.md |
| `resolveCapabilities` returns different output across runs | Non-determinism in the resolver — should not happen | File a bug; fixture cannot be deterministic if the function isn't |
| TypeScript error in persona.ts after capture | Schema field renamed since the playbook was written | Re-read `types.ts`, update the persona to match |
| SIE XML doesn't parse / doctor refuses the persona | The pre-existing XML in `documents/sysinfo-captures/` may have been captured against an older parser | Re-capture via `podkit device repair sysinfo-extended --device <name>` and update both locations |

## Done criteria

- 11 persona directories under `packages/device-testing/src/personas/`
- Registry index populated; package builds + tests pass
- `documents/test-devices.md` updated with capture timestamps
- Each persona has a `provenance.md` filled out
- One PR (or stacked PRs) opened with the captures + the test that asserts behavioural parity against production resolvers
