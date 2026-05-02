---
id: TASK-079
title: Support named devices in --device argument
status: Done
assignee: []
created_date: '2026-03-09 21:54'
updated_date: '2026-03-10 09:17'
labels:
  - cli
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `--device` / `-d` argument currently only accepts paths (e.g., `/Volumes/TERAPOD`). Users should also be able to specify a named device from config (e.g., `--device terapod`).

## Current Behavior
- `--device /Volumes/TERAPOD` works (path)
- `--device terapod` fails (tries to use "terapod" as literal path)
- Named devices exist in config with `volumeUuid` for auto-detection, but can't be referenced directly via `--device`

## Desired Behavior
- `--device terapod` resolves the named device from config
- `--device /Volumes/TERAPOD` continues to work as a path
- Applies to ALL commands that use `--device` (sync, device info, device music, device video, etc.)

## Resolution Logic
1. If value contains `/` or starts with `.` → treat as path
2. Otherwise → try named device lookup first
3. If no named device found → fall back to treating as path (for error messaging)

## Files to Modify
- `packages/podkit-cli/src/device-resolver.ts` - Main resolution logic
- Any commands that bypass the resolver and use `--device` directly
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 --device accepts named device from config (e.g., --device terapod)
- [x] #2 --device continues to accept paths (e.g., --device /Volumes/TERAPOD)
- [x] #3 Path-like values (containing / or starting with .) are treated as paths
- [x] #4 Non-path values are looked up as named devices first
- [x] #5 Clear error message when named device not found and path doesn't exist
- [x] #6 Works for all commands: sync, device info, device music, device video
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created a unified resolution architecture in `packages/podkit-cli/src/resolvers/` that provides clean, consistent patterns for resolving named entities from configuration.

### New Module Structure

```
resolvers/
├── index.ts          # Re-exports all resolvers
├── types.ts          # Shared types (ResolvedDevice, CollectionType, etc.)
├── core.ts           # Generic resolution utilities
├── core.test.ts      # Tests for core utilities
├── device.ts         # Device-specific resolution
├── device.test.ts    # Tests for device resolution
└── collection.ts     # Collection-specific resolution
```

### Key Functions

**Device Resolution:**
- `parseCliDeviceArg(cliDevice, config)` - Parses `--device` argument (path or name)
- `resolveEffectiveDevice(cliArg, positionalName, config)` - Combines CLI and positional args
- `resolveDevice(config, name?)` - Resolves named device or default
- `resolveDevicePath(options)` - Resolves to physical mount path

**Collection Resolution:**
- `resolveMusicCollection(config, name?)` - Resolves music collection
- `resolveVideoCollection(config, name?)` - Resolves video collection
- `getAllCollections(config, filterType?)` - Lists all collections
- `findCollectionByName(config, name)` - Finds in both namespaces

### Resolution Logic for --device

1. If value contains `/` or starts with `.` → treat as path
2. Otherwise → try named device lookup
3. If found → return resolved device
4. If not found → fall back to path (for error messaging)

### Files Modified

- `src/resolvers/*` - New unified resolution module
- `src/device-resolver.ts` - Now re-exports from resolvers with backward-compatible wrappers
- `src/commands/device.ts` - Uses new `resolveDeviceArg()` with `cliPath` support
- `src/commands/sync.ts` - Updated to use `parseCliDeviceArg` and `resolveEffectiveDevice`
- `src/commands/eject.ts` - Updated to use new resolvers
- `src/commands/mount.ts` - Updated to use new resolvers
- `src/commands/collection.ts` - Now delegates to resolver functions
- `src/main.ts` - Updated `--device` help text to `<name|path>`

### Test Coverage

Added unit tests for:
- `isPathLike()` - Path detection
- `resolveNamedEntity()` - Generic resolution logic
- `parseCliDeviceArg()` - CLI argument parsing
- `resolveEffectiveDevice()` - Combined resolution
- `resolveDevice()` - Device resolution
- `getDeviceIdentity()` - Identity extraction
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented support for named devices in the `--device` argument. Users can now use either:
- `--device /Volumes/IPOD` (path)
- `--device terapod` (named device from config)

Additionally refactored the codebase to use a unified resolution architecture:

1. **Created `src/resolvers/` module** with clean, reusable resolution patterns for devices and collections
2. **Updated all commands** (sync, device, eject, mount) to use the new resolvers
3. **Removed code duplication** - consolidated 3+ copies of device resolution logic into one
4. **Added comprehensive tests** for all resolution functions
5. **Updated help text** - `--device <name|path>` now clearly indicates it accepts both

The new architecture follows a consistent pattern:
- `parseCliXxxArg()` - Parse CLI input (detect path vs name)
- `resolveEffectiveXxx()` - Combine multiple resolution sources
- `resolveXxx()` - Core resolution from config

This sets the foundation for similar improvements to collection handling in the future.
<!-- SECTION:FINAL_SUMMARY:END -->
