# gpod-tool

A command-line utility for libgpod operations. This tool enables creating and managing iPod database structures for testing and development without requiring a physical iPod device.

## Purpose

- **Testing**: Create test iPod environments for unit/integration tests
- **Development**: Manually create and inspect iPod databases
- **CI/CD**: Automate iPod database operations in build pipelines

## Quick Start

The easiest way to build and use gpod-tool is via mise:

```bash
# Build (compiles and copies to ./bin/)
mise run tools:build

# Trust the mise config (first time only)
mise trust

# Restart shell or run: eval "$(mise activate bash)"
# Now gpod-tool is in PATH
gpod-tool --help
```

## Requirements

- libgpod (with development headers)
- GLib 2.0
- pkg-config
- C compiler (gcc or clang)

### macOS Setup

Build libgpod locally (see `tools/libgpod-macos/`). The mise tasks handle the environment setup automatically.

### Linux Setup

```bash
# Debian/Ubuntu
sudo apt install libgpod-dev

# Fedora
sudo dnf install libgpod-devel
```

## Building

### Via mise (recommended)

```bash
mise run tools:build   # Build and install to ./bin/
mise run tools:check   # Build and run tests
mise run tools:clean   # Clean build artifacts
```

### Manual build

```bash
cd tools/gpod-tool

# On macOS with local libgpod:
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"

make
make check      # Run tests
make install    # Install to /usr/local/bin (optional)
```

## Commands

### init

Create a new iPod database structure.

```bash
gpod-tool init <path> [options]

Options:
  -m, --model <model>   Model number (default: MA147 - iPod Video 60GB)
  -n, --name <name>     iPod name (default: Test iPod)
  -j, --json            Output result as JSON
```

**Examples:**

```bash
# Create default iPod Video
gpod-tool init ./test-ipod

# Create iPod Classic
gpod-tool init ./test-ipod --model MB565 --name "My Classic"

# JSON output for scripting
gpod-tool init ./test-ipod --json
```

### info

Display information about an iPod database.

```bash
gpod-tool info <path> [options]

Options:
  -j, --json   Output as JSON
```

**Example:**

```bash
$ gpod-tool info ./test-ipod
iPod Database Info
  Path:      ./test-ipod
  Model:     A147 (iPod Video)
  Tracks:    0
  Playlists: 1
  Artwork:   supported
  Video:     supported
```

### tracks

List all tracks in the database.

```bash
gpod-tool tracks <path> [options]

Options:
  -j, --json   Output as JSON
```

**Example:**

```bash
$ gpod-tool tracks ./test-ipod
Tracks (2):
  [1] Pink Floyd - Comfortably Numb (The Wall)
  [2] Led Zeppelin - Stairway to Heaven (Led Zeppelin IV)
```

### add-track

Add a track entry to the database (metadata only, no file copy).

```bash
gpod-tool add-track <path> [options]

Options:
  -t, --title <title>       Track title (required)
  -a, --artist <artist>     Artist name
  -A, --album <album>       Album name
  -n, --track-num <num>     Track number
  -d, --duration <ms>       Duration in milliseconds
  -b, --bitrate <kbps>      Bitrate in kbps (default: 256)
  -s, --sample-rate <hz>    Sample rate in Hz (default: 44100)
  -j, --json                Output as JSON
```

**Example:**

```bash
gpod-tool add-track ./test-ipod \
  --title "Bohemian Rhapsody" \
  --artist "Queen" \
  --album "A Night at the Opera" \
  --track-num 11 \
  --duration 354000
```

### verify

Verify that a database can be parsed correctly.

```bash
gpod-tool verify <path> [options]

Options:
  -j, --json   Output as JSON
```

**Example:**

```bash
$ gpod-tool verify ./test-ipod
Database is valid
  Path:      ./test-ipod
  Tracks:    2
  Playlists: 1
```

## JSON Output

All commands support `--json` for machine-readable output:

```bash
$ gpod-tool info ./test-ipod --json
{
  "success": true,
  "path": "./test-ipod",
  "device": {
    "model_number": "A147",
    "model_name": "iPod Video",
    "supports_artwork": true,
    "supports_video": true
  },
  "track_count": 0,
  "playlist_count": 1
}
```

## Model Numbers

Common model numbers for testing:

| Model | Device | Notes |
|-------|--------|-------|
| MA147 | iPod Video 60GB (5th gen) | Default, full-featured |
| MA002 | iPod Video 30GB (5th gen) | Same features, smaller |
| MB565 | iPod Classic 120GB (6th gen) | JPEG artwork format |
| MA477 | iPod Nano 2GB (2nd gen) | Nano-specific testing |

See `docs/IPOD-INTERNALS.md` for a complete model number list.

## Use in Tests

### Shell Script

```bash
#!/bin/bash
set -e

# Setup
TEST_IPOD=$(mktemp -d)/test-ipod
gpod-tool init "$TEST_IPOD" --model MA147

# Add test data
gpod-tool add-track "$TEST_IPOD" -t "Test" -a "Artist"

# Run your tests against $TEST_IPOD
# ...

# Cleanup
rm -rf "$(dirname "$TEST_IPOD")"
```

### Bun/TypeScript

```typescript
import { $ } from 'bun';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

async function createTestIpod(model = 'MA147'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'test-ipod-'));
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
    expect(result.playlist_count).toBe(1);
  });
});
```

## Related Documentation

- [ADR-005: iPod Test Environment](../../docs/adr/ADR-005-test-ipod-environment.md)
- [docs/LIBGPOD.md](../../docs/LIBGPOD.md)
- [docs/IPOD-INTERNALS.md](../../docs/IPOD-INTERNALS.md)
