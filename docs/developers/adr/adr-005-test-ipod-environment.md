---
title: "ADR-005: iPod Test Environment"
description: Decision to use gpod-tool with libgpod's init function for testing.
sidebar:
  order: 6
---

# ADR-005: iPod Test Environment

## Status

**Accepted** (2026-02-22)

## Context

podkit requires testing libgpod operations (database parsing, track management, artwork handling) without physical iPod hardware. Tests must run in CI environments without special permissions, device access, or complex setup.

## Decision Drivers

- CI-friendly (no root, no devices, no loopback mounts)
- Fast test setup/teardown
- Cross-platform (Linux, macOS)
- Full libgpod API coverage

## Options Considered

### Option A: Loopback Disk Image

Create a FAT32 disk image, mount via loopback.

**Cons:**
- Requires root/sudo for mounting
- Cannot run in most CI environments

### Option B: Manual Directory Structure

Create the iPod directory structure manually.

**Cons:**
- iTunesDB is binary format, hard to create manually
- Fragile: must track libgpod's expectations

### Option C: libgpod's itdb_init_ipod() (Chosen)

Use libgpod's built-in initialization function.

**Pros:**
- Creates complete, valid structure
- No root or special permissions
- Fast (~10ms)
- Cross-platform

## Decision

**Option C: Use libgpod's `itdb_init_ipod()` function**

This provides the best balance of correctness, speed, and CI compatibility.

### gpod-tool CLI

A standalone C utility (`tools/gpod-tool/`) wraps libgpod operations:

```bash
# Create a test iPod structure
gpod-tool init <path> --model MA147 --name "Test iPod"

# Display database info
gpod-tool info <path>

# List all tracks
gpod-tool tracks <path>

# Add a track entry (metadata only)
gpod-tool add-track <path> --title "Song" --artist "Artist"

# Verify database integrity
gpod-tool verify <path>
```

All commands support `--json` for machine-readable output.

### Use in Tests

```typescript
import { mkdtemp, rm } from 'fs/promises';

async function createTestIpod(model = 'MA147'): Promise<string> {
  const dir = await mkdtemp('/tmp/test-ipod-');
  await $`gpod-tool init ${dir} --model ${model}`;
  return dir;
}

describe('iPod sync', () => {
  let testIpod: string;

  beforeEach(async () => {
    testIpod = await createTestIpod();
  });

  afterEach(async () => {
    await rm(testIpod, { recursive: true });
  });

  it('reads empty database', async () => {
    const result = await $`gpod-tool info ${testIpod} --json`.json();
    expect(result.track_count).toBe(0);
  });
});
```

## Consequences

### Positive

- Tests run anywhere without special setup
- Fast test execution (~10ms per test iPod)
- Enables comprehensive CI testing

### Negative

- Tests require libgpod installed
- Cannot test filesystem edge cases (permissions, FAT32 limits)

## Related Decisions

- [ADR-002](/developers/adr/adr-002-libgpod-binding): libgpod binding approach

## References

- [libgpod Device API](https://tmz.fedorapeople.org/docs/libgpod/libgpod-Device.html)
