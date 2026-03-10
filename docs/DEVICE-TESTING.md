# Device Testing Strategy

This document describes how podkit verifies iPod device compatibility through automated testing and real hardware confirmation.

## Overview

Device compatibility verification happens at two levels:

1. **Automated E2E Tests**: Verify that operations work in principle using dummy iPod databases
2. **Real Hardware Confirmation**: Verify that a real iPod works end-to-end with podkit

Both levels are tracked in [SUPPORTED-DEVICES.md](SUPPORTED-DEVICES.md).

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

Real hardware tests require a physical iPod connected to the test machine. These tests verify:

- Device detection and mounting
- Actual file transfer to device
- Database written correctly for device firmware
- Content actually playable on device

**How to run**: Set `IPOD_MOUNT=/path/to/ipod` and run `bun run test:e2e:real`

### Level 3: User Confirmation

Even with automated tests, nothing beats a user report confirming "I synced my music library and it plays fine." User confirmations are tracked in SUPPORTED-DEVICES.md.

## Writing E2E Tests for a Model

### Step 1: Identify Model Constants

Find the model number in `packages/libgpod-node/src/database.ts`:

```typescript
Database.IpodModels = {
  VIDEO_30GB: 'MA002',
  VIDEO_60GB: 'MA147',
  CLASSIC_80GB: 'MB029',
  // ...
}
```

If your model isn't listed, add it to the constants.

### Step 2: Create Model-Specific Test

Create a test file in `packages/e2e-tests/src/models/`:

```typescript
// packages/e2e-tests/src/models/ipod-classic-160gb.e2e.test.ts
import { describe, it, expect } from 'bun:test';
import { withTestIpod } from '@podkit/gpod-testing';
import { runCli } from '../helpers/cli-runner';

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
      // Add a track
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

  it('supports video', async () => {
    await withTestIpod({ model: 'MC293' }, async (ipod) => {
      const caps = await ipod.getDeviceCapabilities();
      expect(caps.supportsVideo).toBe(true);
    });
  });
});
```

### Step 3: Test Key Capabilities

For each model, test the expected capabilities:

```typescript
describe('Model Capabilities', () => {
  // Test what the model SHOULD support
  it('reports correct capabilities', async () => {
    await withTestIpod({ model: 'MODEL_NUMBER' }, async (ipod) => {
      const caps = await ipod.getDeviceCapabilities();

      // Adjust expectations per model
      expect(caps.supportsArtwork).toBe(true);  // false for Shuffle
      expect(caps.supportsVideo).toBe(true);    // false for non-video models
      expect(caps.supportsPhoto).toBe(true);    // varies by model
    });
  });
});
```

### Step 4: Update SUPPORTED-DEVICES.md

After adding tests, update the table:

```markdown
| iPod Classic 160GB | 7th | Full | :test_tube: | :grey_question: | Model number: MC293 |
```

Change `:grey_question:` to `:test_tube:` for the E2E Test column.

## Real Hardware Testing

### Prerequisites

1. Physical iPod device
2. iPod mounted and accessible
3. E2E test suite installed

### Running Real Hardware Tests

```bash
# Set the mount point
export IPOD_MOUNT=/Volumes/IPOD

# Run real device tests
cd packages/e2e-tests
bun run test:e2e:real
```

### What Real Hardware Tests Verify

1. **Detection**: `podkit device add` finds the iPod
2. **Info**: `podkit device info` shows correct model/generation
3. **Sync**: `podkit sync` transfers files successfully
4. **Playback**: Manual verification that content plays on device
5. **Artwork**: Album art displays correctly
6. **Playlists**: Created playlists appear on device

### Documenting Real Hardware Results

After successful real hardware testing:

1. Update SUPPORTED-DEVICES.md:
   ```markdown
   | iPod Video 60GB | 5th | Full | :test_tube: | :white_check_mark: | Model numbers: MA003, MA147 |
   ```

2. Note the firmware version tested (if known)

3. Document any quirks or observations

## Adding Model Number Constants

If you're testing a model not in the constants:

### Step 1: Find Model Number

The model number is on the iPod:
- Settings > About (on device)
- Engraved on back of device
- `iPod_Control/Device/SysInfo` file

### Step 2: Add to Constants

Edit `packages/libgpod-node/src/database.ts`:

```typescript
static readonly IpodModels = {
  // Existing models...

  // Add your model
  CLASSIC_160GB_7G: 'MC293',
};
```

### Step 3: Verify Generation Detection

libgpod maps model numbers to generations internally. Test that your model is recognized:

```typescript
it('recognizes model number', async () => {
  await withTestIpod({ model: 'MC293' }, async (ipod) => {
    const info = await ipod.info();
    // Should not be 'unknown'
    expect(info.device.generation).not.toBe('unknown');
  });
});
```

## Testing Unsupported Devices

For devices known to be unsupported (Touch, Shuffle 3rd+), we should have tests that verify graceful failure:

```typescript
describe('Unsupported Device Handling', () => {
  it('detects iOS device and provides helpful message', () => {
    // This would test the detection logic once implemented
    // See backlog task for UX improvements
  });
});
```

## Test Organization

```
packages/e2e-tests/src/
├── commands/           # CLI command tests
├── models/             # Model-specific capability tests
│   ├── ipod-video-5g.e2e.test.ts
│   ├── ipod-classic-6g.e2e.test.ts
│   └── ipod-nano-3g.e2e.test.ts
├── real-device/        # Tests requiring real hardware
│   └── sync.real.e2e.test.ts
└── helpers/
    └── cli-runner.ts
```

## Continuous Integration

- **Dummy tests**: Run on every PR via GitHub Actions
- **Real device tests**: Run manually when hardware is available; results documented in SUPPORTED-DEVICES.md

## Contributing Device Confirmations

If you have an iPod and want to help verify support:

1. **Run the tests**: `bun run test:e2e` with your device
2. **Test manually**: Sync some music, verify playback
3. **Report results**: Open a PR updating SUPPORTED-DEVICES.md with:
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
- First sync after reset took longer than expected (~30s for 100 tracks)
- Artwork displays correctly at both thumbnail and full screen sizes
```

## See Also

- [SUPPORTED-DEVICES.md](SUPPORTED-DEVICES.md) - Complete device compatibility list
- [packages/gpod-testing/README.md](../packages/gpod-testing/README.md) - Test utility documentation
- [packages/e2e-tests/README.md](../packages/e2e-tests/README.md) - E2E test documentation
- [TESTING.md](TESTING.md) - General testing strategy
