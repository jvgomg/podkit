# @podkit/gpod-testing

Test utilities for creating and managing iPod test environments without physical hardware.

## Overview

This package provides TypeScript wrappers around `gpod-tool` for use in Bun tests. It enables testing iPod-related functionality by creating real iTunesDB databases in temporary directories.

## Prerequisites

Before using this package, build gpod-tool:

```bash
mise run tools:build
mise trust  # First time only
```

## Quick Start

```typescript
import { createTestIpod, withTestIpod } from '@podkit/gpod-testing';

// Option 1: Auto-cleanup with withTestIpod
await withTestIpod(async (ipod) => {
  await ipod.addTrack({ title: 'Test Song', artist: 'Artist' });
  const info = await ipod.info();
  expect(info.trackCount).toBe(1);
});
// Cleanup happens automatically

// Option 2: Manual cleanup with createTestIpod
const ipod = await createTestIpod();
try {
  await ipod.addTrack({ title: 'Test Song' });
  // ... run tests
} finally {
  await ipod.cleanup();
}
```

## API Reference

### High-Level Test Utilities

#### `createTestIpod(options?)`

Creates a test iPod in a temporary directory.

```typescript
interface CreateTestIpodOptions {
  model?: IpodModel;  // Default: 'MA147' (iPod Video 60GB)
  name?: string;      // Default: 'Test iPod'
  path?: string;      // Custom path (default: auto-generated temp dir)
}

const ipod = await createTestIpod({ model: 'MA002', name: 'My Test' });

// TestIpod properties and methods:
ipod.path      // Absolute path to iPod directory
ipod.model     // Model number used
ipod.name      // iPod display name
ipod.cleanup() // Delete the test iPod directory

// Helper methods (convenience wrappers):
await ipod.info()                    // Get database info
await ipod.tracks()                  // List all tracks
await ipod.addTrack({ title: '...' }) // Add a track
await ipod.verify()                  // Verify database integrity
```

#### `withTestIpod(fn, options?)`

Creates a test iPod, runs function, ensures cleanup even on error.

```typescript
const result = await withTestIpod(async (ipod) => {
  await ipod.addTrack({ title: 'Test' });
  return (await ipod.info()).trackCount;
});
// result === 1, cleanup already done
```

#### `createTestIpodsForModels(models)`

Creates multiple test iPods with different models.

```typescript
const ipods = await createTestIpodsForModels(['MA147', 'MA002']);
try {
  // Test across different iPod models
} finally {
  await Promise.all(ipods.map(i => i.cleanup()));
}
```

#### `TestModels`

Pre-configured model constants for common test scenarios.

```typescript
import { TestModels } from '@podkit/gpod-testing';

TestModels.VIDEO_60GB       // 'MA147' - Primary test target
TestModels.VIDEO_30GB       // 'MA002' - Alternative Video model
TestModels.VIDEO_30GB_BLACK // 'MA146' - Black variant
TestModels.NANO_2GB         // 'MA477' - Nano testing
TestModels.CLASSIC_120GB    // 'MB565' - Classic 6th gen
TestModels.CLASSIC_160GB    // 'MC293' - Classic 7th gen
TestModels.NANO_5G          // 'MC027' - Nano 5th gen
```

### Low-Level API

For advanced use cases, access gpod-tool functions directly:

```typescript
import { gpodTool, GpodToolError, isGpodToolAvailable } from '@podkit/gpod-testing';

// Check availability
if (await isGpodToolAvailable()) {
  // Direct CLI wrappers
  await gpodTool.init('/path/to/ipod', { model: 'MA147' });
  const info = await gpodTool.info('/path/to/ipod');
  const tracks = await gpodTool.tracks('/path/to/ipod');
  await gpodTool.addTrack('/path/to/ipod', { title: 'Song' });
  const result = await gpodTool.verify('/path/to/ipod');
}

// Error handling
try {
  await gpodTool.init('/nonexistent/readonly/path', { model: 'MA147' });
} catch (error) {
  if (error instanceof GpodToolError) {
    console.log(error.message);  // Error from gpod-tool
    console.log(error.command);  // Full command that failed
    console.log(error.exitCode); // Exit code
  }
}
```

## Supported Models

All supported iPod generations can be used for test environments. Models that require authentication checksums (Classic, Nano 3+) are handled automatically via a default test FirewireGuid.

| Constant | Model | Device |
|----------|-------|--------|
| `VIDEO_60GB` | MA147 | iPod Video 60GB (5th gen) |
| `VIDEO_30GB` | MA002 | iPod Video 30GB (5th gen) |
| `VIDEO_30GB_BLACK` | MA146 | iPod Video 30GB Black (5th gen) |
| `NANO_2GB` | MA477 | iPod Nano 2GB (2nd gen) |
| `CLASSIC_120GB` | MB565 | iPod Classic 120GB (6th gen) |
| `CLASSIC_160GB` | MC293 | iPod Classic 160GB (7th gen) |
| `NANO_5G` | MC027 | iPod Nano 8GB (5th gen) |

## Example Test Patterns

### Basic Test Structure

```typescript
import { describe, it, expect, beforeAll } from 'bun:test';
import { withTestIpod, isGpodToolAvailable } from '@podkit/gpod-testing';

describe('MyFeature', () => {
  beforeAll(async () => {
    if (!(await isGpodToolAvailable())) {
      throw new Error('Run `mise run tools:build` first');
    }
  });

  it('does something with iPod', async () => {
    await withTestIpod(async (ipod) => {
      // Arrange
      await ipod.addTrack({ title: 'Test', artist: 'Artist' });

      // Act
      const result = await yourFunction(ipod.path);

      // Assert
      expect(result).toBe(expected);
    });
  });
});
```

### Testing with Multiple Tracks

```typescript
it('handles multiple tracks', async () => {
  await withTestIpod(async (ipod) => {
    // Add several tracks
    await ipod.addTrack({ title: 'Track 1', artist: 'Artist A', album: 'Album 1' });
    await ipod.addTrack({ title: 'Track 2', artist: 'Artist A', album: 'Album 1' });
    await ipod.addTrack({ title: 'Track 3', artist: 'Artist B', album: 'Album 2' });

    const tracks = await ipod.tracks();
    expect(tracks).toHaveLength(3);

    const info = await ipod.info();
    expect(info.trackCount).toBe(3);
    expect(info.playlistCount).toBe(1); // Master playlist
  });
});
```

### Testing Error Cases

```typescript
import { GpodToolError } from '@podkit/gpod-testing';

it('provides detailed error info', async () => {
  try {
    await gpodTool.init('/nonexistent/readonly/path', { model: 'MA147' });
  } catch (error) {
    expect(error).toBeInstanceOf(GpodToolError);
    if (error instanceof GpodToolError) {
      expect(error.command).toContain('gpod-tool init');
    }
  }
});
```

### Testing Across Models

```typescript
import { createTestIpodsForModels, TestModels } from '@podkit/gpod-testing';

it('works on different iPod models', async () => {
  const ipods = await createTestIpodsForModels([
    TestModels.VIDEO_60GB,
    TestModels.CLASSIC_120GB,
    TestModels.NANO_5G,
  ]);

  try {
    for (const ipod of ipods) {
      await ipod.addTrack({ title: 'Test' });
      const info = await ipod.info();
      expect(info.device.supportsArtwork).toBe(true);
    }
  } finally {
    await Promise.all(ipods.map(i => i.cleanup()));
  }
});
```

### Using Custom Path

```typescript
it('creates iPod at specific path', async () => {
  const customPath = '/tmp/my-test-ipod';

  const ipod = await createTestIpod({ path: customPath });
  expect(ipod.path).toBe(customPath);

  // Note: cleanup() won't delete non-temp paths automatically
  // Clean up manually if needed
  await rm(customPath, { recursive: true });
});
```

## Troubleshooting

### "gpod-tool not found in PATH"

Build the tool first:
```bash
mise run tools:build
mise trust
# Restart shell or: eval "$(mise activate bash)"
```

### Tests timing out

Each `createTestIpod()` takes ~100-200ms. For many tests, consider:
- Using `withTestIpod()` for automatic cleanup
- Sharing a test iPod across related tests (with `beforeAll`/`afterAll`)
- Running tests in parallel where possible
