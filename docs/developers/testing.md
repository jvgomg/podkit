---
title: Testing
description: Testing strategy, conventions, and how to write tests for podkit.
sidebar:
  order: 4
---

This document describes the testing approach for podkit.

## Overview

- **Framework:** Bun test runner
- **Organization:** Co-located tests (`*.test.ts` alongside source files)
- **Categories:** Unit tests, integration tests, and E2E tests

## Test Categories

### Unit Tests (`*.test.ts`)

Fast tests with no external dependencies. Test individual functions, classes, and modules in isolation.

**Characteristics:**
- No external tools required (no FFmpeg, no gpod-tool)
- No filesystem side effects outside temp directories
- Fast execution (milliseconds per test)
- Can run anywhere without special setup

**Examples:**
- Testing pure functions
- Testing class methods with mocked dependencies
- Testing CLI command structure
- Testing data transformations

### Integration Tests (`*.integration.test.ts`)

Tests that verify components work together with real external dependencies.

**Characteristics:**
- May require external tools (gpod-tool, FFmpeg)
- May create real files/databases in temp directories
- Slower execution
- May require setup steps before running

**Examples:**
- Testing gpod-tool wrapper functions with real iTunesDB
- Testing FFmpeg transcoding with real audio files
- Testing full sync workflows

### End-to-End Tests (`packages/e2e-tests/`)

Tests that invoke the built CLI as a real user would. Run against dummy iPods (CI-safe) or real iPods (manual validation).

**Characteristics:**
- Spawns actual CLI binary as subprocess
- Tests real user workflows end-to-end
- Uses target abstraction for dummy/real iPod switching
- Longer execution times

**Examples:**
- Full sync workflow: init, sync, status, list
- Incremental sync with growing collection
- CLI error handling and exit codes

## Running Tests

```bash
# Run all tests (unit + integration)
bun run test

# Run only unit tests
bun run test:unit

# Run only integration tests
bun run test:integration

# Run E2E tests (with dummy iPod)
bun run test:e2e

# Run E2E tests with real iPod (requires both env vars)
IPOD_MOUNT=/Volumes/iPod bun run test:e2e:real

# Run Docker-based E2E tests (Subsonic, etc.)
bun run test:e2e:docker

# Run tests for a specific package
bun run test --filter @podkit/core

# Run a specific test file
bun test packages/podkit-core/src/adapter.test.ts
```

## Full Local Validation

Before submitting a PR, run the full validation sequence. This covers everything that CI would check.

### Quick check (most changes)

```bash
bun run build             # Build all packages
bun run typecheck         # Type check all packages
bun run lint              # Lint all files
bun run test              # Unit + integration tests (macOS)
```

### Full check (cross-platform or device-related changes)

```bash
# 1. Build, type check, lint
bun run build
bun run typecheck
bun run lint

# 2. macOS tests
bun run test              # Unit + integration
bun run test:e2e          # E2E with dummy iPod

# 3. Linux tests (requires Lima — brew install lima)
mise run lima:test         # Runs on both Debian + Alpine VMs

# 4. Docker E2E (requires Docker — for Subsonic tests)
bun run test:e2e:docker
```

### Real hardware validation (device changes only)

```bash
# macOS with real iPod connected
IPOD_MOUNT=/Volumes/iPod bun run test:e2e:real
```

### Summary of all test commands

| Command | What it tests | When to run |
|---------|--------------|-------------|
| `bun run test` | Unit + integration tests on macOS | Every change |
| `bun run test:unit` | Unit tests only | Quick iteration |
| `bun run test:integration` | Integration tests only (needs gpod-tool, FFmpeg) | After changing sync/transcode logic |
| `bun run test:e2e` | E2E with dummy iPod | After CLI changes |
| `bun run test:e2e:real` | E2E with real iPod (needs `IPOD_MOUNT`) | Device-related changes |
| `bun run test:e2e:docker` | Docker-based E2E (Subsonic) | Subsonic adapter changes |
| `mise run lima:test` | Full suite on Debian + Alpine VMs | Linux/device manager changes |
| `mise run lima:test:debian` | Full suite on Debian VM only | Quick Linux check |
| `mise run lima:test:alpine` | Full suite on Alpine VM only | Docker image compatibility |
| `mise run tools:brew-test` | Homebrew install smoke test | After releases |
| `bun run build` | Build all packages | Every change |
| `bun run typecheck` | TypeScript type checking | Every change |
| `bun run lint` | Linting (oxlint) | Every change |

## Writing Tests

### Test Structure

Use the Arrange-Act-Assert pattern:

```typescript
it('parses track metadata from file', async () => {
  // Arrange
  const testFile = await createTestAudioFile({ title: 'Test Song' });

  // Act
  const metadata = await parseMetadata(testFile);

  // Assert
  expect(metadata.title).toBe('Test Song');
});
```

### Naming Conventions

- Describe blocks: noun phrases (`'DirectoryAdapter'`, `'sync command'`)
- Test names: should read as sentences (`'parses FLAC metadata'`, `'skips hidden files'`)

### File Organization

```
src/
+-- adapter.ts
+-- adapter.test.ts              # Unit tests for adapter
+-- adapter.integration.test.ts  # Integration tests (if needed)
+-- sync/
    +-- planner.ts
    +-- planner.test.ts
    +-- executor.integration.test.ts
```

## Testing with iPod Databases

Use `@podkit/gpod-testing` to create test iPod environments without real hardware:

```typescript
import { withTestIpod } from '@podkit/gpod-testing';

it('adds a track to iPod', async () => {
  await withTestIpod(async (ipod) => {
    await ipod.addTrack({ title: 'Test', artist: 'Artist' });

    const tracks = await ipod.tracks();
    expect(tracks).toHaveLength(1);
  });
  // Cleanup is automatic
});
```

See `packages/gpod-testing/README.md` for full API documentation.

## Test Audio Fixtures

Pre-built FLAC files with complete metadata and embedded artwork are available in `test/fixtures/audio/`:

- 6 FLAC files organized as 2 albums (3 tracks each)
- Complete metadata (artist, album, title, track number, year, genre)
- Embedded album artwork (different per album)
- One track without artwork for edge case testing

For tests needing specific audio characteristics, generate files dynamically:

```typescript
async function generateTestAudio(
  filePath: string,
  format: string,
  metadata: Record<string, string>
): Promise<void> {
  const metadataArgs = Object.entries(metadata)
    .map(([key, value]) => ['-metadata', `${key}=${value}`])
    .flat();

  const args = [
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '0.1',
    ...metadataArgs,
    '-y', '-loglevel', 'error',
    filePath,
  ];

  spawnSync('ffmpeg', args, { stdio: 'ignore' });
}
```

## Dependency Handling

Integration tests require external dependencies. Tests **fail early with clear error messages** when dependencies are missing:

```typescript
import { requireFFmpeg } from '../__tests__/helpers/test-setup.js';

// Fail early if FFmpeg is not available
requireFFmpeg();

describe('FFmpegTranscoder', () => {
  it('transcodes audio', async () => {
    // Test runs only if FFmpeg is available
  });
});
```

Error message example:

```
=======================================================================
 FFmpeg not available!
=======================================================================

 Integration tests require FFmpeg to be installed.

 Install FFmpeg:

     macOS:   brew install ffmpeg
     Ubuntu:  sudo apt install ffmpeg

=======================================================================
```

## Prerequisites for Integration Tests

```bash
# Build gpod-tool (required for iPod database tests)
mise run tools:build
mise trust  # First time only

# Verify FFmpeg
ffmpeg -version
```

## Docker-Based E2E Tests

Some E2E tests require Docker for external services (Navidrome for Subsonic):

```bash
# Run Docker-based tests
bun run test:e2e:docker

# Container cleanup
cd packages/e2e-tests
bun run cleanup:docker:list   # List orphaned containers
bun run cleanup:docker        # Remove stopped containers
bun run cleanup:docker --force  # Force remove all
```

## Brew Install Smoke Test

Verifies that the published Homebrew formula installs and runs correctly on Debian Linux using Docker.

```bash
mise run tools:brew-test
```

This spins up a `debian:bookworm-slim` container, installs Homebrew, taps `jvgomg/podkit`, installs podkit, and runs `podkit --version` and `podkit --help`. The container exits non-zero on any failure.

**When to run it:** After publishing a new release, before announcing it. It catches formula issues (wrong URLs, bad checksums, missing deps) that unit/integration tests can't.

The build is layered for speed: system deps, Homebrew, and ffmpeg are cached build layers. The `brew install podkit` step and assertions run as the container's startup command (not a build layer), so they always execute fresh against the live formula regardless of Docker's build cache. A cold build takes ~5-10 minutes (dominated by ffmpeg); warm runs are ~1 minute.

Source: `tools/brew-test/`

## Cross-Platform Testing (Lima VMs)

The test suite can be run on Linux via Lima VMs to validate platform-specific code (e.g., the Linux device manager).

```bash
# Run tests on both Debian and Alpine
mise run lima:test

# Run on a specific distro
mise run lima:test:debian
mise run lima:test:alpine
```

VMs are created automatically on first run. See [Development Setup](/developers/development#cross-platform-testing-with-lima) for setup instructions and `tools/lima/README.md` for VM details.

## Quality Preset Device Testing

See [Quality Preset Device Testing](/developers/quality-preset-testing) for the methodology and results of testing preset change detection with real iPod hardware.

## See Also

- [Device Testing](/developers/device-testing) - Testing device compatibility
- [Development Setup](/developers/development) - Setting up dev environment
- `packages/gpod-testing/README.md` - Test utility documentation
- `packages/e2e-tests/README.md` - E2E test documentation
