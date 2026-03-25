---
id: doc-023
title: PRD — Device Readiness Diagnostics
type: other
created_date: '2026-03-25 13:11'
updated_date: '2026-03-25 13:21'
---
## Problem Statement

When a user connects a new, factory-reset, or malfunctioning iPod, podkit provides no useful guidance. The OS may refuse to mount the device (e.g. macOS error 71), and podkit simply passes through the raw error message. Users are left with no idea whether the problem is a bad cable, an uninitialized device, a missing filesystem, or a corrupted database.

The existing device commands assume a happy path: the device is partitioned, formatted, mounted, and has a valid iPod database. When any of these preconditions fail, users hit cryptic errors and have to troubleshoot outside of podkit.

## Solution

Build a device readiness diagnostic system that checks every stage of device health — from USB connection through to database integrity — and gives users actionable guidance at each failure point. This is exposed through four existing commands:

- **`podkit device scan`** — Enhanced to discover iPods (even unpartitioned ones), run the full readiness pipeline, and show verbose per-check output with checks and crosses.
- **`podkit doctor`** — Enhanced to run readiness checks first, then database health checks. Works even when the device isn't fully ready.
- **`podkit device info`** — Enhanced to include a readiness summary alongside existing config and status info.
- **`podkit device init`** — Enhanced with readiness awareness. Code paths for formatting and partitioning are stubbed out with clear messages explaining that the functionality is not yet implemented.

The readiness pipeline is a linear progression of 6 stages:

```
USB Connected → Partitioned → Has Filesystem → Mounted (with iPod Structure) → Valid SysInfo → Has Database
```

When a stage fails, subsequent stages are skipped, and the user sees exactly what's wrong and what to do about it.

## User Stories

1. As a user with a brand new iPod, I want podkit to detect it over USB even before it's formatted, so that I know podkit can see my device.
2. As a user getting macOS error 71, I want podkit to explain what that error means in plain language, so that I don't have to search the internet for obscure error codes.
3. As a user with an unpartitioned device, I want podkit to tell me it needs partitioning and formatting, so that I know the next step.
4. As a user with a formatted but uninitialized iPod, I want podkit to tell me to run `device init`, so that I can set up the iPod database.
5. As a user with a healthy iPod, I want `device scan` to confirm everything is working and show me track counts and storage, so that I get a quick health overview.
6. As a user running `podkit doctor`, I want to see device-level checks before database checks, so that I can distinguish between hardware/OS issues and database corruption.
7. As a user running `podkit device info`, I want to see a readiness summary, so that I can quickly tell if my device is fully operational.
8. As a user with an unmounted but mountable device, I want scan to offer to mount it for me, so that I don't have to run a separate command.
9. As a user running scan in a non-interactive context (JSON output, piped), I want a `--mount` flag to opt into automatic mounting, so that scripts can handle the full flow.
10. As a user running `podkit device init` on an unformatted device, I want a clear message explaining that podkit can't format yet but will be able to in the future, so that I know to use Disk Utility or iTunes instead.
11. As a user with multiple iPods connected, I want scan to check readiness on each one independently, so that I can see the status of all my devices.
12. As a developer, I want the readiness pipeline to be a reusable core module with a clean interface, so that future commands and features can leverage it.
13. As a developer, I want individual readiness checks (like iPod structure, SysInfo validation, and database validation) to be callable independently, so that commands like `doctor` can reuse them.
14. As a user, I want error codes from mount failures to be interpreted into human-readable explanations, so that I understand what went wrong without having to look up errno values.
15. As a user running `podkit device scan` with no devices connected, I want the existing "No devices found" message, so that the behavior is consistent with today.
16. As a user with a corrupted filesystem, I want podkit to distinguish this from "no filesystem" and "no partition table", so that I get the right remediation advice.
17. As a user who has configured a device, I want scan to show me which detected devices match my config, so that I can see the relationship between physical devices and my podkit setup.
18. As a user troubleshooting a device issue, I want to export a diagnostic report that I can share in a GitHub issue or support request, so that others can help me debug.
19. As a user with an iPhone or AirPods connected alongside my iPod, I want scan to only show iPods and ignore other Apple devices, so that the output isn't cluttered with irrelevant devices.
20. As a user who accepts the mount prompt during scan, I want the readiness checks to continue automatically after mounting, so that I see the full picture in one go without running scan again.
21. As a user whose iPod has a missing or corrupt SysInfo file, I want podkit to detect this and tell me how to fix it, so that artwork and capability detection work correctly.
22. As a user whose SysInfo has an unrecognized model number, I want a warning (not a failure) so I can still use the device while being aware of potential issues.

## Implementation Decisions

### Readiness Pipeline Architecture

The readiness pipeline lives in `device/readiness.ts` in podkit-core but implements the diagnostic check interface from the diagnostics framework. This keeps the hardware/OS logic in the device module while allowing it to plug into the diagnostic runner.

The pipeline is modeled as a linear progression with 6 stages. Each stage produces a check result (pass/fail/skip with details). When a stage fails, subsequent stages are marked as skipped. Individual checks (iPod structure, SysInfo, database) are also callable independently for reuse by doctor and other commands.

### Readiness Levels

```
ready          — All stages pass. Device is fully usable.
needs-repair   — Mounted with iPod structure, but database is corrupt or SysInfo is missing/corrupt.
needs-init     — Mounted, has filesystem, but no iPod_Control or no database file.
needs-format   — Has partitions but unrecognized or corrupt filesystem.
needs-partition — Device visible on USB but no partition table.
hardware-error — USB communication failures, I/O errors.
unknown        — Can't determine state.
```

Note: SysInfo issues are `needs-repair` level (not `needs-init`) because the iPod structure exists — it's a specific file that's missing or corrupt, fixable via `device reset`.

### USB Discovery and Device Filtering

On macOS, USB discovery uses `system_profiler SPUSBDataType` to find Apple devices (vendor ID `0x05ac`). This is only run when needed — the fast path uses `diskutil` to detect devices, and USB subsystem queries are reserved for devices that can't be identified through `diskutil` alone. This avoids the 2-3 second latency of `system_profiler` when all devices are healthy.

On Linux, USB discovery reads `/sys/bus/usb/devices/` to find Apple vendor IDs.

**Device filtering:** Only devices with known iPod USB product IDs (from the existing lookup table) are included in readiness checks. Other Apple devices (iPhones, iPads, AirPods, etc.) share the same vendor ID but are silently ignored. No heuristics — we trust the product ID. This means a truly unrecognizable device won't appear, which is the right tradeoff since podkit only supports iPods.

This feature is scoped to iPods only. Mass-storage devices are not included in readiness checks.

### OS Error Code Interpretation

A mapping of known OS error codes to human-readable explanations:
- errno 71 (EPROTO) — "Device communication failed. The device may be uninitialized, have a corrupted filesystem, or have a bad USB connection."
- errno 13 (EACCES) — "Permission denied."
- errno 19 (ENODEV) — "Device not found. It may have been disconnected."
- errno 5 (EIO) — "I/O error. Possible hardware failure or bad cable."

The error interpreter parses both numeric codes and common OS error message patterns.

### SysInfo Validation

The SysInfo file (`iPod_Control/Device/SysInfo`) contains the iPod model number (e.g. `ModelNumStr: MA147`) which libgpod needs to determine device capabilities — artwork format, video support, storage layout. A missing or corrupt SysInfo causes podkit to treat the device as a "generic iPod", which can lead to broken artwork or incorrect capability detection.

The readiness pipeline includes a dedicated SysInfo validation stage between iPod Structure and Database:
- **Pass:** SysInfo exists and contains a valid `ModelNumStr` that maps to a known iPod model
- **Warn:** SysInfo exists but model is unrecognized — device works but with reduced capability confidence
- **Fail:** SysInfo file is missing or corrupt (unreadable/unparseable)

When SysInfo is missing or corrupt, the suggested action is `podkit device reset` (which recreates the database and SysInfo) or manual SysInfo creation with the correct model number. The existing `validateDevice()` function in `device-validation.ts` already handles the `unknown_model` case as a warning after database open — the readiness pipeline catches this earlier and more explicitly.

This check is also callable independently so that `podkit doctor` can verify SysInfo integrity on an otherwise healthy device.

### Database Check Depth

The "Has Database" stage does more than check file existence — it opens the database and reads basic info (track count, model name). If the file exists but fails to parse, the readiness level is `needs-repair` (distinct from `needs-init` where no database file exists at all). This catches corruption early rather than deferring to doctor.

For healthy devices, scan always opens the database to show track counts and storage in the summary line. If the database open fails unexpectedly on an otherwise healthy-looking device, scan still reports the device as found but notes "track count unavailable".

### Multi-Device Output Format

When multiple iPods are detected, each gets a header using the model name and disk identifier, followed by the config relationship, then the readiness checks:

```
iPod Classic 7G (disk5s2)
  Configured as: myipod

  ✓ USB Connection
    iPod Classic 7G (Apple 0x05ac)
  ...

iPod Nano 5G (disk6s1)
  Not configured

  ✓ USB Connection
    iPod Nano 5G (Apple 0x05ac)
  ...
```

### Command Behavior Changes

**`podkit device scan`:**
- Discovers iPods via known USB product IDs even if they have no partitions (via USB subsystem)
- Runs the full readiness pipeline on each discovered iPod
- Always shows verbose per-check output with checks/crosses
- For healthy devices, appends a summary line: "Ready — 1,234 tracks, 45 GB free"
- Shows config relationship: "Configured as: myipod" or "Not configured — run: podkit device add"
- When a device is unmounted but mountable, prompts interactively: "Device is unmounted. Mount now? [Y/n]"
  - If user accepts, mount is attempted and remaining readiness checks continue automatically
- In non-interactive contexts (JSON output, non-TTY), never prompts; add `--mount` flag to opt into automatic mounting
- Add `--report` flag to output a diagnostic report to stdout (users redirect to file or pipe as needed). Includes all readiness details plus system info (OS version, podkit version, platform). Designed to be pasted into GitHub issues
- "No devices found" message unchanged when nothing is connected

**`podkit doctor`:**
- Two-phase diagnostic run: readiness checks first, then database health checks
- If device isn't ready, shows readiness failures and skips database checks gracefully
- Readiness checks use the same verbose per-check output as scan
- Database checks (artwork, orphans) behave as today when device is ready

**`podkit device info`:**
- Adds a brief readiness summary to the existing output (e.g. "Readiness: Ready" or "Readiness: Needs initialization")
- Full readiness details available in JSON output

**`podkit device init`:**
- Runs readiness checks before attempting initialization
- If device is `ready`: reports that the device is already initialized
- If device `needs-init`: proceeds with iTunesDB creation (existing behavior)
- If device `needs-format`: stub code path with message:
  ```
  This device has a partition table but no recognized filesystem.

  Automatic formatting is not yet supported by podkit.
  To format manually:
    macOS: Open Disk Utility → Select the device → Erase → Format: MS-DOS (FAT32)
    Or: Use iTunes/Finder to restore the iPod

  After formatting, run: podkit device init -d <name>
  ```
- If device `needs-partition`: stub code path with message:
  ```
  This device has no partition table. It appears to be completely uninitialized.

  Automatic partitioning is not yet supported by podkit.
  To set up manually:
    macOS: Open Disk Utility → Select the device → Erase → Scheme: Master Boot Record, Format: MS-DOS (FAT32)
    Or: Use iTunes/Finder to restore the iPod

  After partitioning and formatting, run: podkit device init -d <name>
  ```
- If device `needs-repair`: reports that the database or SysInfo is corrupt, suggests `podkit device reset` to recreate
- If device has a `hardware-error`: reports the interpreted error and suggests checking cable/connection
- Code paths for format and partition are structured so they can be implemented later without restructuring

**End-state vision for `device init`:**
The eventual goal is that `podkit device init` handles the complete flow from a raw, uninitialized device to a ready-to-sync iPod: partitioning (MBR + single FAT32 partition), formatting, creating iPod_Control directory structure, initializing iTunesDB, and writing SysInfo. Potentially also firmware installation. This PRD lays the groundwork by establishing the readiness pipeline and stub code paths, but the actual partitioning and formatting implementation is future work.

### Platform Support

macOS and Linux both get readiness checks using their respective tools (diskutil vs lsblk, system_profiler vs /sys/). Windows remains unsupported with existing graceful degradation.

## Testing Decisions

Good tests verify external behavior through the module's public interface, not implementation details. Tests should not depend on specific diskutil output format strings or internal data structures — they should assert on the readiness results and check statuses.

### Modules to test

**Core readiness pipeline (unit tests):**
- Error code interpretation: known codes produce correct explanations, unknown codes produce generic messages
- Readiness level determination from various device state combinations
- Linear pipeline: failed stage causes subsequent stages to skip
- Individual check isolation: iPod structure, SysInfo, and database checks callable independently
- SysInfo validation: missing file, corrupt file, valid with known model, valid with unknown model
- Prior art: existing tests in `packages/podkit-core/src/device/` for assessment and iFlash detection

**CLI output (unit/snapshot tests):**
- Scan command produces correct checks/crosses format for various device states
- Doctor command shows readiness section before database section
- Device info includes readiness summary
- JSON output includes structured readiness data
- Prior art: existing CLI tests in `packages/podkit-cli/src/commands/device.test.ts`

**E2E tests:**
- Scan on a device without a database shows readiness failure and guidance
- Doctor on a mounted device without a database shows readiness checks + skipped database checks
- Device init on an uninitialized device shows correct readiness-based messages
- SysInfo missing/corrupt scenarios produce correct readiness output
- Prior art: existing E2E tests in `packages/e2e-tests/src/commands/device.e2e.test.ts`

## Out of Scope

- **Automated partitioning and formatting:** Code paths will be stubbed but not implemented. Users should use Disk Utility, iTunes, or Finder for now.
- **Firmware upgrades:** Future roadmap item, not part of this feature.
- **Mass-storage device readiness:** Only iPods are checked. Mass-storage devices have simpler requirements.
- **Windows platform:** Remains unsupported with existing graceful degradation.
- **Automated restore:** Replicating iTunes restore functionality is a separate, larger effort.
- **Non-Apple devices:** USB filtering is limited to known iPod product IDs.

## Further Notes

- The readiness pipeline is designed to be the foundation for future `device init --format` capability. The stubbed code paths should make it clear where formatting logic will slot in.
- The existing `assessDevice()` method already gathers some pre-mount information (iFlash detection, USB identity). The readiness pipeline should build on this rather than replacing it — assessment data feeds into readiness checks.
- The `findIpodDevices()` method currently only returns partitioned devices. The USB discovery enhancement needs to work alongside this, not replace it — unpartitioned devices are a special case that supplements normal discovery.
- iPod structure validation, SysInfo validation, and database checks should be extracted as reusable routines so that `doctor` can call them directly on mounted devices without running the full readiness pipeline.
- **Device disconnection during scan:** If a device is disconnected mid-pipeline, the current check should fail gracefully with a "device not found" error rather than crashing. Each stage should handle the device disappearing.
- **Multiple partitions:** Some iPods have multiple partitions (e.g. a small firmware partition + the data partition). The readiness pipeline should check the data partition specifically, which is typically the largest FAT32 partition.
- **iFlash interaction:** The existing iFlash detection in `assessDevice()` should be surfaced in the readiness output when relevant. iFlash devices often need special mount handling (sudo mount -t msdos), and this context helps users understand why mounting might fail.
- **Report format:** The `--report` diagnostic report is plain text output to stdout, designed to be pasted into a GitHub issue. It should include: podkit version, OS version, platform, all readiness check results with details, and any error messages encountered. Sensitive information (file paths containing usernames) should be redacted or noted.
