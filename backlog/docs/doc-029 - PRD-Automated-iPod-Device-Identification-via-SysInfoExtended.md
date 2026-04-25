---
id: doc-029
title: 'PRD: Automated iPod Device Identification via SysInfoExtended'
type: other
created_date: '2026-04-19 17:06'
---
## Problem Statement

When a modern iPod (post-2006) is restored via iTunes or connected fresh, the `iPod_Control/Device/SysInfo` file is either empty (0 bytes) or absent. This file is a hard requirement for libgpod — without it, the device is treated as "generic" and critical functionality breaks:

- **No artwork:** libgpod returns an empty format list for unknown devices, so album art is never written
- **No ALAC support:** codec capabilities are unknown, so lossless files may be transcoded unnecessarily or rejected
- **Checksum failure:** iPod Classic and Nano 3G+ require an HMAC-signed database using the device's FirewireGuid. Without it, `itdb_write()` fails or produces a database the iPod rejects (shows no music)
- **Wrong model identification:** `podkit device add` reports the iPod as "Unknown", `podkit doctor` flags a fault, and `podkit sync` uses conservative generic defaults

This affects all iPod Classic (6th/7th gen), Nano (3rd gen+), and any device that has been freshly restored — which is the most common first-time podkit user scenario.

The root cause is historical: libgpod was designed around a manual workflow where users ran a separate tool (`ipod-read-sysinfo-extended`) before using the library. This tool reads device identity data directly from iPod firmware via USB vendor control transfers. The data has always been available from the device — it was just never integrated into an automated flow.

## Solution

podkit will automatically read SysInfoExtended from iPod firmware via USB and write it to the device filesystem as part of device setup. This eliminates all manual device identification steps and provides libgpod with the richest possible device data.

The SysInfoExtended XML (read from firmware via USB vendor control transfers using libusb) contains everything needed: FirewireGuid, serial number (which maps to exact model including color and capacity via libgpod's serial→model lookup table), codec support, artwork format specifications, video capabilities, and checksum type.

When SysInfoExtended is present on disk, libgpod prefers it over SysInfo for all device identification — making the traditional `ModelNumStr` in SysInfo redundant.

**User experience after this change:**

- `podkit device add` reads SysInfoExtended automatically during setup. User sees their exact device identified (e.g., "iPod nano 8GB Black (3rd Generation)") with no manual input
- `podkit doctor` detects missing SysInfoExtended and tells the user to run a repair command
- `podkit doctor --repair sysinfo-extended` reads and writes SysInfoExtended from the connected device
- `podkit sync` works correctly on first run with full capability detection

## User Stories

1. As a user adding a freshly restored iPod, I want podkit to automatically identify my exact device model, so that I don't have to manually look up model numbers or configure device capabilities
2. As a user adding a freshly restored iPod, I want podkit to automatically obtain the FirewireGuid from my device, so that database checksums are correct and my iPod accepts the synced music
3. As a user running `podkit doctor`, I want to see a clear explanation when SysInfoExtended is missing, so that I understand why my device might not work correctly
4. As a user running `podkit doctor --repair sysinfo-extended`, I want podkit to read the device identity from firmware and write it to disk, so that my device is fully configured without needing iTunes
5. As a user with an iPod Classic 6th/7th gen, I want podkit to automatically handle hash58 checksum requirements, so that my iPod doesn't reject the database after sync
6. As a user with an iPod Nano 3rd/4th gen, I want artwork to work on first sync, so that I see album art on my device without extra configuration
7. As a user on macOS, I want device identification to work via the libusb transport, so that no additional system tools are needed
8. As a user on Linux, I want device identification to work via the same libusb transport, so that the experience is consistent across platforms
9. As a user who provides an explicit `--path` to `device add`, I want podkit to still identify the device via USB by correlating the mount path to USB bus info, so that the `--path` workflow isn't degraded
10. As a user adding a device, I want to see my iPod's exact color and capacity in the device summary (e.g., "iPod Classic 160GB Black (7th Generation)"), so that I have confidence podkit understands my hardware
11. As a user with an iPod Nano 5th gen (hash72), I want podkit to clearly tell me that initial iTunes sync is required for HashInfo bootstrapping, so that I understand the limitation rather than getting a cryptic error
12. As a user with an iPod Nano 6th gen (hashAB), I want podkit to clearly tell me that this device requires proprietary components not available in podkit, so that I understand the limitation upfront
13. As a developer working on podkit, I want the USB product ID table to be accurate and cover both `0x120x` and `0x126x` ID ranges, so that device scanning correctly identifies connected iPods
14. As a developer working on podkit, I want the model lookup tables to have a single source of truth, so that model data isn't duplicated across packages
15. As a developer, I want the libgpod-node binding for SysInfoExtended reading to be a standalone function (not requiring an open database), so that it can be called during device setup before any database exists
16. As a developer, I want USB discovery to capture bus number, device address, and serial number, so that these are available for SysInfoExtended reading and diagnostics

## Implementation Decisions

### libgpod Library Modification

The `read_sysinfo_extended_from_usb()` function currently lives in `tools/ipod-usb.c` and is compiled only into the standalone `ipod-read-sysinfo-extended` binary. It will be moved into the libgpod library source (`src/`) so that it becomes part of `libgpod.a` / `libgpod.dylib`. The build configuration (Makefile.am / configure.ac) will be updated to conditionally link libusb into the library when `HAVE_LIBUSB` is defined. The function will be declared in the public header so that downstream consumers (including libgpod-node) can call it directly.

The GLib dependency in `ipod-usb.c` is acceptable since libgpod already depends on GLib throughout.

### libgpod-node Native Binding

A new standalone function (not a method on DatabaseWrapper) will be added to the native binding, following the existing pattern used by `Parse()`, `InitIpod()`, and other module-level exports. The function accepts USB bus number and device address, calls the libgpod library function, and returns the XML string or null. The binding.gyp build configuration will add `libusb-1.0` to the pkg-config dependencies.

TypeScript wrapper exposes this as an async function in the binding module.

### USB Discovery Enhancement

The USB discovery module will be enhanced on both platforms:

**macOS (`system_profiler` parsing):**
- Capture `serial_num` field (= FirewireGuid, 16 hex chars)
- Capture `location_id` and derive USB bus number (top byte) and device address
- Add these to the `UsbDiscoveredDevice` / `UsbDeviceInfo` interfaces

**Linux (sysfs parsing):**
- Read `busnum` and `devnum` files from sysfs device path (already walking the tree, just not extracting these)
- Read `serial` file from sysfs (= FirewireGuid)
- Add to same interfaces

**Path-to-USB correlation:**
- For the `device add --path` case, USB lookup will be performed by correlating the mount path back to a USB device via platform-specific mechanisms (macOS: match `bsd_name` in system_profiler Media tree; Linux: follow `/sys/block/{dev}/device` symlink up to USB device)

### USB Product ID Table Fix

The current product ID lookup table is incomplete. Known gap: the `0x126x` range (confirmed by a real Nano 3G reporting `0x1262` while the table only has `0x1208`). The table will be audited against the Linux USB ID database (`usb.ids`) and direct device testing. Both ID ranges will be included with comments explaining the difference (likely related to USB configuration or firmware generation).

### SysInfoExtended Orchestrator

A new module in podkit-core provides the high-level orchestration:

1. Accept mount point and USB device info (bus, address)
2. Check if `SysInfoExtended` already exists on device filesystem
3. If missing: call libgpod-node binding to read XML from firmware via USB
4. Validate the returned XML (well-formed, contains expected keys like FireWireGUID and SerialNumber)
5. Write XML to `iPod_Control/Device/SysInfoExtended`
6. Return result indicating success, what was found, or why it failed

This is the deep module — simple interface, encapsulates USB transfer details, XML validation, filesystem operations, and error handling.

### Readiness Pipeline Update

The SysInfo readiness stage will be updated to account for SysInfoExtended:

- **Pass:** SysInfoExtended present with valid content, OR SysInfo present with valid ModelNumStr
- **Warn:** SysInfo present but SysInfoExtended missing (device works but may lack full capability data)
- **Fail:** Both missing → suggest `podkit doctor --repair sysinfo-extended`

A new repairable check ID (`sysinfo-extended`) will be added to the diagnostics framework, following the existing pattern for artwork-rebuild and orphan-files checks.

### Initialization Capability Mapping

A clear data structure will map iPod generations to their initialization requirements:

- **No checksum:** 1st–4th gen, Photo, Mini, Shuffle, Nano 1–2, Video 5/5.5 → SysInfoExtended optional (nice to have for capabilities)
- **Hash58:** Classic 6th/7th, Nano 3rd/4th → SysInfoExtended required (provides FirewireGuid for checksum)
- **Hash72:** Nano 5th → SysInfoExtended required + HashInfo bootstrap from iTunes-written DB (graceful failure with clear message)
- **HashAB:** Nano 6th, Touch 4th → requires proprietary `libhashab.so` (graceful failure with clear message)

This mapping informs both the readiness pipeline (how severe is a missing SysInfoExtended?) and the CLI messaging (what does the user need to do?).

### CLI Integration

**`device add`:**
- After mounting and before database init/open, check for SysInfoExtended
- If missing: automatically attempt USB read and write
- Show result in device summary (exact model name from serial→model lookup)
- If USB read fails: warn but continue (device may still work for older models that don't need checksums)

**`doctor`:**
- SysInfoExtended check integrated into readiness display
- Missing SysInfoExtended on a device that requires it (hash58+) → fail with repair suggestion
- `doctor --repair sysinfo-extended` triggers the orchestrator

### Refactoring Opportunities

**Model table consolidation:**
The codebase currently has three overlapping model data sources: `ipod-models.ts` in podkit-core (USB product ID → name, plus ModelNumStr → name), `models.ts` in ipod-db (195-entry table with generation, capacity, color, musicDirs), and libgpod's internal `ipod_info_table`. Since ipod-db is not yet integrated as a dependency, the relevant model data (USB product ID mapping, serial suffix → model mapping) will be copied into podkit-core with clear comments noting the duplication and referencing ipod-db as the future single source of truth. The existing separate lookup tables in `ipod-models.ts` should be unified into a single model registry with multiple access patterns (by USB ID, by ModelNumStr, by serial suffix).

**USB discovery refactoring:**
The macOS USB tree traversal code has duplicated recursive walks. These should be consolidated into a generic tree search with predicate/collector callbacks. The `UsbDiscoveredDevice` interface should be extended to carry bus/address/serial as first-class fields rather than bolting them on later.

**Readiness pipeline cleanup:**
The `determineLevel()` function is a growing switch/case that will become harder to maintain. While a full stage registry pattern may be over-engineering for the current stage count, the function should be restructured for clarity — potentially using an ordered rules list rather than nested conditionals.

**Platform device manager alignment:**
Linux and macOS device managers have diverged in capability (Linux lacks `getSiblingVolumes()`, macOS has complex dual-LUN handling). Shared interfaces should be tightened so that both platforms provide the same USB info structure, making the SysInfoExtended orchestrator platform-agnostic.

## Testing Decisions

Tests should verify external behavior through the module's public interface. No mocking of internal functions — test the contract, not the wiring.

### What makes a good test in this context

- Tests that feed realistic input (real system_profiler JSON, real sysfs file structures, real SysInfoExtended XML) and verify correct output
- Tests that verify error paths (USB read failure, malformed XML, missing files, permission errors)
- Tests that use the existing gpod-testing utilities for iPod filesystem fixtures
- Integration tests that verify the full chain where possible (USB info → orchestrator → file written → libgpod reads it correctly)

### Modules to test

**USB discovery parsing (unit tests):**
- macOS: parse system_profiler JSON fixtures with `serial_num`, `location_id`, various product IDs
- Linux: parse sysfs directory fixtures with `busnum`, `devnum`, `serial`, `idVendor`, `idProduct`
- Product ID table: verify all known IDs resolve, verify both `0x120x` and `0x126x` ranges
- Path-to-USB correlation: given a mount path and USB tree, verify correct device is matched
- Prior art: existing usb-discovery tests if any, otherwise readiness.test.ts pattern

**SysInfoExtended orchestrator (unit tests):**
- Given valid XML string and mount point → writes file to correct location
- Given mount point where SysInfoExtended already exists → skips (no overwrite)
- Given null/empty XML → returns appropriate error
- Given malformed XML (missing FireWireGUID) → returns validation error
- XML parsing: extract FirewireGuid, SerialNumber, FamilyID, DBVersion from real XML fixtures
- Prior art: readiness.test.ts (similar filesystem-based checks with temp directories)

**Model registry (unit tests):**
- Serial suffix lookup: verify known suffixes map to correct models (e.g., "YXX" → nano 3G black 8GB)
- USB product ID lookup: verify both ID ranges return correct generation
- Unknown/missing values: verify graceful fallback behavior
- Prior art: existing lookupIpodModel / lookupIpodModelByNumber tests if any

**Readiness pipeline SysInfo stage (unit tests):**
- SysInfoExtended present → pass
- SysInfo present but SysInfoExtended missing → warn
- Both missing → fail with correct repair suggestion
- Prior art: readiness.test.ts (comprehensive existing test suite for all stages)

**libgpod-node binding (integration tests):**
- `readSysInfoExtendedFromUsb()` with invalid bus/address → returns null (no crash)
- Cannot test real USB transfer without hardware — rely on the orchestrator and CLI-level E2E tests
- Prior art: database.integration.test.ts

**CLI E2E (integration tests with dummy iPod):**
- `device add` on an iPod fixture without SysInfoExtended → verify it attempts USB read
- `doctor` on an iPod fixture without SysInfoExtended → verify correct diagnostic output and repair suggestion
- Prior art: e2e-tests package (dummy iPod test infrastructure)

## Out of Scope

- **ipod-db as a runtime dependency of podkit-core:** Model data will be copied, not imported. Full ipod-db integration is tracked separately (m-8)
- **User-interactive model picker UX:** SysInfoExtended provides exact model via serial number lookup. No fallback picker if USB read fails — fail gracefully instead
- **SysInfo file writing:** SysInfoExtended supersedes SysInfo for libgpod. If both are needed for edge cases, libgpod handles that internally when it reads SysInfoExtended
- **SCSI/sgutils transport:** Linux sgutils path is a bonus if the build has sgutils, but libusb is the primary and cross-platform path. No work to add sgutils support
- **Hash72/HashAB support:** Nano 5G (hash72) and Nano 6G/Touch 4G (hashAB) have additional requirements beyond SysInfoExtended. This PRD covers detecting and messaging these limitations, not solving them
- **Automatic `ipod-read-sysinfo-extended` invocation via shell:** The solution integrates at the library level, not by shelling out to the existing binary
- **SysInfoExtended parsing in podkit-core:** libgpod handles parsing internally. podkit-core only needs to write the raw XML to disk and optionally extract a few fields for display purposes

## Further Notes

### Key technical reference

- **USB vendor control transfer:** Request type `LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE`, request `0x40`, value `0x02`, iterating index from 0 until short read. This is Apple's proprietary protocol for reading device identity XML
- **Serial → model lookup:** Last 3 characters of the serial number from SysInfoExtended map to a specific model via libgpod's `serial_to_model_mapping` table (e.g., "YXX" → model "B261" → "iPod nano 8GB Black (3rd Generation)")
- **libgpod preference order:** `itdb_device_get_ipod_info()` tries SysInfoExtended first (via serial), falls back to SysInfo ModelNumStr
- **FirewireGuid equivalence:** The `serial_num` from USB descriptors (`system_profiler`, sysfs) is the same value as `FireWireGUID` in SysInfoExtended and `FirewireGuid` in SysInfo — all represent the device's 64-bit hardware identifier
- **DBVersion field in SysInfoExtended** determines checksum type: 3 = hash58, 4 = hash72, 5 = hashAB. This is more reliable than generation-based lookup

### Verified on real hardware

The libusb USB vendor transfer approach was tested on a real iPod Nano 3rd gen (product ID `0x1262`, serial `5U8280FNYXX`) running firmware 1.1.3. The existing `ipod-read-sysinfo-extended` tool (compiled as part of the libgpod macOS build with `HAVE_LIBUSB=1`) successfully read 12KB of SysInfoExtended XML containing full device identity, codec support, artwork formats, and video capabilities. The XML was written to `iPod_Control/Device/SysInfoExtended` on the device filesystem.

### ADR consideration

This work involves a significant architectural decision (how podkit identifies iPod devices) that should be captured in an ADR. The ADR should document: the discovery that SysInfo is not firmware-created on modern iPods, the decision to use SysInfoExtended via libusb as the primary identification method, and the decision to modify the libgpod library build to expose the USB transfer function.
