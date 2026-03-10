---
title: Device Testing
description: How to test iPod device compatibility and contribute device verification results.
sidebar:
  order: 4
---

# Device Testing Strategy

This document describes how podkit verifies iPod device compatibility through automated testing and real hardware confirmation.

## Overview

Device compatibility verification happens at two levels:

1. **Automated E2E Tests**: Verify operations work using dummy iPod databases
2. **Real Hardware Confirmation**: Verify a real iPod works end-to-end

Both levels are tracked in [Supported Devices](/devices/supported-devices).

## Testing Levels

### Level 1: Dummy iPod Tests (E2E)

Dummy iPod tests use `@podkit/gpod-testing` to create temporary iPod database structures without real hardware. These tests verify:

- Database creation and initialization
- Track adding, updating, and removal
- Playlist management
- Artwork handling
- Database integrity after operations

**What dummy tests prove**: The code correctly handles the iTunesDB format for a given model.

**What dummy tests don't prove**: The actual hardware accepts and plays the content.

### Level 2: Real Hardware Tests

Real hardware tests require a physical iPod connected to the test machine. These verify:

- Device detection and mounting
- Actual file transfer to device
- Database written correctly for device firmware
- Content actually playable on device

**How to run:**

```bash
export IPOD_MOUNT=/Volumes/iPod
bun run test:e2e:real
```

### Level 3: User Confirmation

Nothing beats a user report confirming "I synced my music library and it plays fine."

## Writing E2E Tests for a Model

### Step 1: Create Model-Specific Test

Create a test file in `packages/e2e-tests/src/models/`:

```typescript
// packages/e2e-tests/src/models/ipod-classic-160gb.e2e.test.ts
import { describe, it, expect } from 'bun:test';
import { withTestIpod } from '@podkit/gpod-testing';

describe('iPod Classic 160GB (MC293)', () => {
  it('initializes with correct model', async () => {
    await withTestIpod({ model: 'MC293' }, async (ipod) => {
      const info = await ipod.info();
      expect(info.device.generation).toBe('classic_3');
      expect(info.device.modelName).toContain('Classic');
    });
  });

  it('syncs music tracks', async () => {
    await withTestIpod({ model: 'MC293' }, async (ipod) => {
      await ipod.addTrack({
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
      });

      const info = await ipod.info();
      expect(info.trackCount).toBe(1);
    });
  });

  it('supports artwork', async () => {
    await withTestIpod({ model: 'MC293' }, async (ipod) => {
      const caps = await ipod.getDeviceCapabilities();
      expect(caps.supportsArtwork).toBe(true);
    });
  });
});
```

### Step 2: Test Key Capabilities

```typescript
describe('Model Capabilities', () => {
  it('reports correct capabilities', async () => {
    await withTestIpod({ model: 'MODEL_NUMBER' }, async (ipod) => {
      const caps = await ipod.getDeviceCapabilities();

      // Adjust expectations per model
      expect(caps.supportsArtwork).toBe(true);  // false for Shuffle
      expect(caps.supportsVideo).toBe(true);    // false for non-video
    });
  });
});
```

### Step 3: Update Supported Devices

After adding tests, update the documentation table:

```markdown
| iPod Classic 160GB | 7th | Full | :test_tube: | :grey_question: | Model: MC293 |
```

## Real Hardware Testing

### Prerequisites

1. Physical iPod device
2. iPod mounted and accessible
3. E2E test suite installed

### Running Tests

```bash
export IPOD_MOUNT=/Volumes/IPOD
cd packages/e2e-tests
bun run test:e2e:real
```

### What to Verify

1. **Detection**: `podkit device add` finds the iPod
2. **Info**: `podkit device info` shows correct model/generation
3. **Sync**: `podkit sync` transfers files successfully
4. **Playback**: Manual verification that content plays
5. **Artwork**: Album art displays correctly
6. **Playlists**: Created playlists appear on device

### Documenting Results

After successful testing, update [Supported Devices](/devices/supported-devices):

```markdown
| iPod Video 60GB | 5th | Full | :test_tube: | :white_check_mark: | MA003, MA147 |
```

## Contributing Device Confirmations

If you have an iPod and want to help verify support:

1. **Run the tests**: `bun run test:e2e` with your device
2. **Test manually**: Sync some music, verify playback
3. **Report results**: Open a PR updating supported devices with:
   - Model number
   - Firmware version (if known)
   - What worked/didn't work
   - Any quirks observed

### Example PR Description

```markdown
## Device Confirmation: iPod Nano 4th Gen (MB598)

### Hardware
- Model: MB598 (8GB, blue)
- Firmware: 1.0.4

### Test Results
- [x] Music sync
- [x] Artwork display
- [x] Video playback
- [x] Playlist creation
- [x] Smart playlists

### Observations
- First sync after reset took ~30s for 100 tracks
- Artwork displays correctly at all sizes
```

## See Also

- [Supported Devices](/devices/supported-devices) - Complete compatibility list
- [Testing](/developers/testing) - General testing strategy
- `packages/gpod-testing/README.md` - Test utility documentation
- `packages/e2e-tests/README.md` - E2E test documentation
