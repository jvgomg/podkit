---
id: TASK-084
title: Improve UX for device compatibility and capability communication
status: To Do
assignee: []
created_date: '2026-03-10 10:08'
updated_date: '2026-03-10 10:19'
labels:
  - ux
  - cli
  - device-support
  - epic
dependencies:
  - TASK-085
references:
  - docs/SUPPORTED-DEVICES.md
  - docs/DEVICE-TESTING.md
  - packages/libgpod-node/src/types.ts
  - packages/podkit-cli/src/commands/device.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

The CLI currently has limited feedback about device compatibility and capabilities. Users may encounter confusing errors when using unsupported devices, or miss important information about what features are available for their specific iPod model.

This epic covers all UX improvements related to device support communication.

## Problem Statement

### Current Issues

1. **No unsupported device detection**: If someone connects an iPod Touch, iPhone, or buttonless Shuffle, they get cryptic libgpod errors instead of a helpful message explaining why it won't work.

2. **Silent "unknown" fallback**: When model detection fails, the CLI silently falls back to `generation: 'unknown'` without warning the user that their device may not be recognized properly.

3. **No capability warnings**: When a user tries to sync video to a Nano 2G (which doesn't support video), there's no warning. The code has capability detection APIs but doesn't use them proactively.

4. **No feature availability feedback**: Users don't know upfront what features their iPod supports. For example, they might not know their Shuffle doesn't support artwork.

5. **Device info doesn't highlight limitations**: `podkit device info` shows capabilities but doesn't highlight when important features are unavailable.

## Proposed Solutions

### 1. Unsupported Device Detection

Add detection for devices that cannot work with podkit:

- **iOS Devices (Touch/iPhone/iPad)**: Detect by model number or generation and show:
  ```
  Error: This appears to be an iPod Touch (1st Generation).

  podkit requires iPods that use USB Mass Storage mode. iOS devices (iPod Touch,
  iPhone, iPad) use Apple's proprietary sync protocol and require iTunes signing,
  which podkit cannot provide.

  Supported devices: iPod Classic, Video, Nano (1st-5th), Mini, Shuffle (1st-2nd)
  See: https://github.com/your-org/podkit/docs/SUPPORTED-DEVICES.md
  ```

- **Buttonless Shuffles (3rd/4th gen)**: Detect and show:
  ```
  Error: This appears to be an iPod Shuffle 3rd or 4th generation.

  These "buttonless" Shuffle models require an iTunes authentication hash that
  podkit cannot generate. Only 1st and 2nd generation Shuffles are supported.
  ```

### 2. Unknown Model Warnings

When model detection returns `unknown`:

```
Warning: Could not identify iPod model.

The device will be treated as a generic iPod, which may cause issues with
artwork format or database compatibility.

To fix this, ensure iPod_Control/Device/SysInfo exists with your model number:
  echo "ModelNumStr: MA147" > /Volumes/IPOD/iPod_Control/Device/SysInfo

See docs/SUPPORTED-DEVICES.md for model number reference.
```

### 3. Capability-Based Sync Warnings

Before sync, check capabilities and warn:

```
podkit sync --source ~/Music

Syncing to iPod Nano (2nd Generation)...

Note: This device does not support:
  - Video playback (3 video files will be skipped)

Continue? [Y/n]
```

Or for Shuffle:
```
Syncing to iPod Shuffle (2nd Generation)...

Note: This device does not support:
  - Album artwork (artwork will not be synced)
  - Smart playlists

Continue? [Y/n]
```

### 4. Enhanced Device Info Output

Improve `podkit device info` to highlight limitations:

```
Device: myipod (default)
  Volume UUID:   ABC123...
  Mount Point:   /Volumes/IPOD
  
Model: iPod Nano (2nd Generation)
  Model Number:  MA477
  Capacity:      2GB

Capabilities:
  ✓ Music
  ✓ Artwork  
  ✗ Video (not supported on this model)
  ✓ Playlists
  ✓ Smart Playlists
  ✗ Podcasts (not supported on this model)

Storage: 1.2 GB used / 1.8 GB total (67%)
Tracks:  245 music tracks
```

### 5. Device Capability Queries

Add capability query commands:

```bash
# Check if device supports a feature
podkit device supports video
# Output: No - iPod Nano (2nd Generation) does not support video playback.

podkit device supports artwork
# Output: Yes - iPod Nano (2nd Generation) supports album artwork.

# List all capabilities
podkit device capabilities
# Output: Table of all features and support status
```

## Implementation Notes

### Detection Logic Location

Add to `packages/podkit-core/src/ipod/device-validation.ts`:

```typescript
export interface DeviceValidationResult {
  supported: boolean;
  generation: IpodGeneration;
  issues: DeviceIssue[];
  warnings: DeviceWarning[];
}

export interface DeviceIssue {
  type: 'unsupported_device' | 'unknown_model' | 'missing_sysinfo';
  message: string;
  suggestion?: string;
}

export function validateDevice(path: string): Promise<DeviceValidationResult>;
```

### Unsupported Generations

```typescript
const UNSUPPORTED_GENERATIONS: IpodGeneration[] = [
  'touch_1', 'touch_2', 'touch_3', 'touch_4',
  'iphone_1', 'iphone_2', 'iphone_3', 'iphone_4',
  'ipad_1',
  'shuffle_3', 'shuffle_4',
  'nano_6',  // Different database format
];
```

### CLI Integration Points

- `podkit device add`: Validate before adding, warn/error for unsupported
- `podkit device info`: Show capability summary with clear indicators
- `podkit sync`: Pre-flight capability check, warn about skipped content
- `podkit device init`: Check for unsupported devices before initialization

## Related Documentation

- [docs/SUPPORTED-DEVICES.md](docs/SUPPORTED-DEVICES.md) - Device compatibility reference
- [docs/DEVICE-TESTING.md](docs/DEVICE-TESTING.md) - Testing strategy for new models
- [packages/libgpod-node/src/types.ts](packages/libgpod-node/src/types.ts) - Type definitions
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Unsupported devices (Touch, iPhone, iPad, Shuffle 3rd/4th, Nano 6th+) are detected and show helpful error messages
- [ ] #2 Unknown model detection triggers a warning with instructions to fix SysInfo
- [ ] #3 Sync operations warn when content types are unsupported by the target device
- [ ] #4 `podkit device info` shows clear capability indicators (supported/not supported)
- [ ] #5 All error messages include links to SUPPORTED-DEVICES.md documentation
- [ ] #6 JSON output includes structured capability and validation information
<!-- AC:END -->
