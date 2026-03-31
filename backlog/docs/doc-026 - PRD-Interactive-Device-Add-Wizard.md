---
id: doc-026
title: 'PRD: Interactive Device Add Wizard'
type: other
created_date: '2026-03-31 15:19'
---
## Problem Statement

Adding a new device to podkit requires users to know the exact flags and values upfront: `podkit device add -d <name> --type <type> --path <mount-point>`. For mass-storage devices like the Echo Mini, users must know the device type identifier, which is not discoverable from the CLI. There is no guided setup experience, and users who plug in a new device and run `podkit device add` are met with an error rather than help.

Additionally, the CLI's interactive prompts are inconsistent — built on raw `readline` with no unified styling or input primitives beyond yes/no confirms.

## Solution

Transform `podkit device add` into an interactive wizard (in TTY mode) that scans for connected devices, presents them as selectable candidates grouped by physical USB device, and walks the user through configuration with sensible defaults. Adopt `@clack/prompts` as the standard prompt library across the entire CLI.

When a user runs `podkit device add` with no flags:

1. Scan for all candidate devices (iPods, known mass-storage devices via USB ID matching, unknown removable volumes)
2. Display candidates grouped by physical USB device, showing USB identity, volume names, sizes, mount points, and the matched device preset
3. Already-configured devices appear for context but are not selectable
4. User selects a volume from the interactive list
5. For known devices (Echo Mini, Rockbox): display a capability summary (codecs, artwork, video, normalization) passively, then prompt for device name, quality preset, and transfer mode
6. For generic/unknown devices: prompt for all of the above plus audio codecs, music directory, video support, artwork settings, and normalization
7. Write the device config and confirm

All existing flag-based paths remain intact for scripting and non-TTY use. When flags are provided, the wizard is skipped entirely.

## User Stories

1. As a new user, I want to plug in my Echo Mini and run `podkit device add` with no arguments, so that I can set up my device without reading documentation
2. As a user with multiple devices connected, I want to see all candidate devices grouped by physical USB device, so that I understand which volumes belong to the same hardware
3. As an Echo Mini user, I want both volumes (internal + SD card) to appear as separate selectable options under a single device group, so that I can choose which volume to sync to
4. As a user adding a known device, I want to see the device's capabilities (codec support, artwork settings, video support) displayed automatically after selection, so that I understand what the preset provides without being asked redundant questions
5. As a user adding a known device, I want to be prompted for only the choices that matter to me (name, quality, transfer mode), so that setup is fast
6. As a user adding a generic/unknown device, I want to be walked through all capability settings with sensible defaults, so that I can configure my device correctly
7. As a user, I want the wizard to suggest a good device name (slugified, no spaces, no collisions with existing devices), so that I can just press enter
8. As a user, I want to see already-configured devices in the candidate list for context, so that I know what's already set up, but I should not be able to select them
9. As a user running scripts or CI, I want `podkit device add` with explicit flags to work exactly as it does today without any interactive prompts, so that my automation is not broken
10. As a user in a non-TTY environment with missing required flags, I want a clear error message telling me which flags to provide, so that I know how to fix the command
11. As a user in a non-TTY environment where the device is identifiable (e.g., `--path` provided, USB match found), I want defaults to be auto-accepted, so that scripted setup works without interaction
12. As a Linux user, I want the same device scanning and grouping experience as macOS users, so that the wizard works cross-platform
13. As a user running `podkit device scan`, I want scan to remain read-only with no interactive prompts, so that it stays a safe inspection command
14. As a user, I want all confirmation prompts across the CLI (device remove, device clear, device reset, collection remove, etc.) to use the same visual style as the new wizard, so that the experience is consistent
15. As a user adding a known device, I want only my explicit choices (name, quality, transfer mode) saved to config, not preset-derived capabilities, so that my config stays lean and I benefit from preset improvements automatically
16. As a user adding a generic device, I want all my answers saved explicitly to config, so that my device's full configuration is visible and self-contained
17. As a user, I want quality and transfer mode values written to config even if I accepted the default, so that the config is explicit and predictable regardless of future default changes
18. As a user whose device is detected by USB vendor/product ID, I want the correct preset applied automatically without needing to specify `--type`, so that I don't need to know internal device type identifiers

## Implementation Decisions

### Module 1: Device Candidate Scanner (podkit-core)

A new `scanCandidates()` function that combines device listing, iPod detection, USB identity lookup, removable/external filtering, and preset matching into a single call. Returns candidates grouped by physical USB device, each group containing:
- USB device identity (vendor/product ID, display name, manufacturer)
- Matched device preset (if USB IDs match a known profile), or null for unknown devices
- List of volumes with name, mount point, size, UUID

Filtering rules:
- Must be removable/external (not internal disks)
- Must be mounted
- Skip known system volumes (macOS Data, Recovery, EFI, Preboot)
- Candidate ordering: iPods first, then known mass-storage matches, then unknown removable volumes

### Module 2: USB Device Info Enrichment (podkit-core)

Extend `UsbDeviceInfo` with a `displayName` field. On macOS, sourced from the `_name` field in `system_profiler SPUSBDataType` JSON. On Linux, sourced from `/sys/.../product` or `/sys/.../manufacturer`.

Add optional `usbMatch` criteria (vendor/product ID pairs) to `DEVICE_PRESETS`, making each preset the single source of truth for both capabilities and identification. The scanner uses these to match detected USB devices to presets.

### Module 3: Linux getSiblingVolumes (podkit-core)

Implement the existing TODO using `lsblk`'s parent-child hierarchy. Walk `/sys/block` to find all partitions belonging to the same physical USB device, similar to how macOS uses `system_profiler` BSD name trees.

### Module 4: Prompt Primitives (podkit-cli)

Adopt `@clack/prompts` as the standard prompt library. Create a thin abstraction layer providing: `confirm`, `text`, `select`, `multiSelect`, and `note` (for passive display). This replaces `utils/confirm.ts`.

Provide a non-interactive fallback interface that returns defaults or errors, used for testing and non-TTY detection.

Replace all existing `readline`-based prompts across the CLI:
- `utils/confirm.ts` (confirm, confirmNo)
- `commands/device.ts` (multiple confirm calls for add, remove, clear, reset, reset-artwork, scan mount prompt)
- `commands/collection.ts` (remove confirmation)
- `commands/migrate.ts` (local confirm, select, text implementations)
- `config/migrations/` (MigrationPrompt interface)

### Module 5: Device Add Wizard (podkit-cli)

Orchestrates the interactive flow:

1. Call candidate scanner
2. Display grouped candidates with clack `select` — already-configured devices visible but not selectable
3. On selection of a known device: display capability summary via `note`, then prompt for name (with slugified suggestion), quality preset, transfer mode
4. On selection of a generic device: prompt for name, quality, transfer mode, plus audio codecs (multi-select), music directory (text), video support (confirm), artwork on/off + max resolution, normalization mode
5. Final confirmation, then write to config

Name suggestion logic: slugify the model name (iPod), preset name (echo-mini), or volume name (generic), then append `-2`, `-3` etc. if it collides with existing configured devices. Lowercase kebab-case.

Config write strategy:
- Known devices: write `type`, `path`, `volumeUuid`, `volumeName`, `quality`, `transferMode`. Never write preset-derived capabilities.
- Generic devices: write everything the user was asked about, regardless of whether it matches generic preset defaults.
- Quality and transfer mode are always written explicitly, even if the user accepted the default.

Non-TTY behaviour: if required flags are provided and the device is identifiable, auto-accept all defaults. If the device cannot be identified, error with usage hint.

### Existing flag paths preserved

When `--type`, `--path`, `--device` flags are provided, the current direct code paths are used unchanged. The wizard only activates when flags are missing in TTY mode.

## Testing Decisions

Good tests for this feature verify external behaviour through the module's public interface, using mock data to simulate platform responses. They should not depend on internal implementation details like specific function call orders or private method behaviour.

### Module 1: Device Candidate Scanner
- Test with mock `PlatformDeviceInfo` arrays and mock USB identity data
- Verify filtering (excludes internal disks, system volumes, unmounted devices)
- Verify grouping (volumes from same USB device grouped together)
- Verify ordering (iPods → known mass-storage → unknown)
- Verify preset matching (USB IDs → correct device type)
- Verify already-configured device marking
- Prior art: existing `device.test.ts` resolver tests use similar mock device data patterns

### Module 2: USB Preset Matching
- Test the pure matching function: given USB vendor/product IDs, returns correct preset or null
- Test edge cases: unknown IDs, Apple vendor ID with unknown product, multiple presets with different IDs
- Prior art: `ipod-models.ts` has a similar lookup pattern

### Module 3: Linux getSiblingVolumes
- Test with mock `lsblk` JSON output containing multi-partition USB devices
- Verify correct sibling discovery for dual-LUN devices
- Prior art: existing `parseLsblkJson` and `stripPartitionSuffix` tests in the Linux platform tests

### Module 5: Device Add Wizard
- Integration-testable with a mock prompt interface (returns canned answers) and mock candidate scanner
- Verify known device flow writes correct config (type + user choices only)
- Verify generic device flow writes full config
- Verify name collision avoidance
- Verify non-TTY fallback behaviour
- Prior art: existing `device.integration.test.ts`

### Not tested
- Module 4 (prompt primitives): thin wrappers around @clack/prompts with minimal logic
- Module 6 (existing prompt migration): existing tests should keep passing; no new tests needed

## Out of Scope

- Collection assignment during device add (per-device collection defaults are a separate feature)
- Changes to `podkit device scan` behaviour (remains read-only)
- USB auto-detection on Windows or other unsupported platforms
- Interactive prompts for `podkit device set` (remains flag-based)
- Device profile creation workflow (creating new preset types for unrecognized devices)

## Further Notes

- The `@clack/prompts` dependency is added to `podkit-cli` only, not to `podkit-core`
- This work subsumes TASK-256 (auto-detect device type from USB identifiers) — the USB matching is one part of the broader wizard feature
- The prompt abstraction layer is designed so that `@clack/prompts` could be swapped for another library in the future without changing wizard logic
- Linux and macOS must provide equivalent information for the candidate display; we only show data available on both platforms
- The `system_profiler` call on macOS and `/sys` reads on Linux are already used in the codebase for USB identity and sibling detection; this work extends but does not replace those code paths
