# Testing Strategy

This document describes the testing approach for podkit.

## Overview

- **Framework:** Bun test runner
- **Organization:** Co-located tests (`*.test.ts` alongside source files)
- **Categories:** Unit tests and integration tests, distinguished by file suffix

## Test Categories

### Unit Tests (`*.test.ts`)

### Integration Tests (`*.integration.test.ts`)

### End-to-End Tests (`packages/e2e-tests/`)

See each category below for details.

---

### Unit Tests (`*.test.ts`)

Fast tests with no external dependencies. These test individual functions, classes, and modules in isolation.

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

Tests that invoke the built CLI artifact (`dist/main.js`) as a real user would. E2E tests run against dummy iPods (CI-safe) or real iPods (manual validation).

**Characteristics:**
- Spawns actual CLI binary as subprocess
- Tests real user workflows end-to-end
- Uses target abstraction for dummy/real iPod switching
- Longer execution times (includes transcoding)

**Examples:**
- Full sync workflow: init → sync → status → list
- Incremental sync with growing collection
- CLI error handling and exit codes
- JSON output format validation

See [packages/e2e-tests/README.md](../packages/e2e-tests/README.md) for full documentation.

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

# Run E2E tests with real iPod
IPOD_MOUNT=/Volumes/iPod bun run test:e2e:real

# Run tests for a specific package
bun test packages/podkit-core

# Run a specific test file
bun test packages/podkit-core/src/adapter.test.ts
```

All commands work with turborepo for caching and parallel execution across packages.

## Dependency Handling

Integration tests require external dependencies (FFmpeg, gpod-tool, native bindings). Rather than silently skipping tests when dependencies are missing, tests **fail early with clear error messages** explaining what's missing and how to fix it.

### Why Fail Early?

- **Immediate feedback:** Developers know right away what's missing
- **No hidden skips:** Avoids situations where hundreds of tests appear to "pass" but were actually skipped
- **Clear instructions:** Error messages include the exact commands to fix the issue
- **Intentional runs:** If you run integration tests, you expect them to actually run

### Package Test Setup Files

Each package with integration tests has a `__tests__/helpers/test-setup.ts` file that provides early-fail checks:

**libgpod-node** (`packages/libgpod-node/src/__tests__/helpers/test-setup.ts`):
- Checks for native bindings (`requireNativeBinding()`)
- Checks for test MP3 file (`requireTestMp3()`)

**podkit-core** (`packages/podkit-core/src/__tests__/helpers/test-setup.ts`):
- `requireFFmpeg()` - Ensures FFmpeg is installed
- `requireGpodTool()` - Ensures gpod-tool is built and in PATH
- `requireLibgpod()` - Ensures libgpod-node native bindings are available
- `requireAllDeps()` - Combines all three checks

### Usage in Test Files

Import and call the requirement function at module load time:

```typescript
import { describe, it, expect } from 'bun:test';
import { requireFFmpeg } from '../__tests__/helpers/test-setup.js';

// Fail early if FFmpeg is not available
requireFFmpeg();

describe('FFmpegTranscoder', () => {
  it('transcodes audio', async () => {
    // Test runs only if FFmpeg is available
  });
});
```

For tests requiring multiple dependencies:

```typescript
import { requireAllDeps } from '../__tests__/helpers/test-setup.js';

// Fail early if any dependency is missing
requireAllDeps();

describe('SyncExecutor integration', () => {
  // Tests require FFmpeg, gpod-tool, and libgpod-node
});
```

### Error Message Example

When a dependency is missing, tests fail immediately with a clear message:

```
═══════════════════════════════════════════════════════════════════
 FFmpeg not available!
═══════════════════════════════════════════════════════════════════

 Integration tests require FFmpeg to be installed.

 Install FFmpeg:

     macOS:   brew install ffmpeg
     Ubuntu:  sudo apt install ffmpeg

═══════════════════════════════════════════════════════════════════
```

## Testing with iPod Databases

Use `@podkit/gpod-testing` to create test iPod environments. No physical hardware needed.

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

See [packages/gpod-testing/README.md](../packages/gpod-testing/README.md) for full API documentation.

## Writing Good Tests

### Test Coverage Philosophy

No hard coverage targets, but high coverage is expected:

- If a simple test can be written, write it
- Test all public API surfaces
- Test error handling and edge cases
- Integration tests for key user workflows

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
├── adapter.ts
├── adapter.test.ts              # Unit tests for adapter
├── adapter.integration.test.ts  # Integration tests (if needed)
├── sync/
│   ├── planner.ts
│   ├── planner.test.ts
│   └── executor.integration.test.ts
```

## Prerequisites for Integration Tests

Before running integration tests, ensure dependencies are built:

```bash
# Build gpod-tool (required for iPod database tests)
mise run tools:build
mise trust  # First time only

# FFmpeg with libfdk_aac (required for transcoding tests)
# See docs/TRANSCODING.md for installation
```

## Test Fixtures

### Pre-built Audio Fixtures

Pre-built FLAC files with complete metadata and embedded artwork are available in `test/fixtures/audio/`. These are useful for testing sync, transcoding, and artwork transfer:

- 6 FLAC files organized as 2 albums (3 tracks each)
- Complete metadata (artist, album, title, track number, year, genre)
- Embedded album artwork (different per album)
- One track without artwork for edge case testing

See [test/fixtures/audio/README.md](../test/fixtures/audio/README.md) for file details and metadata inspection commands.

### Dynamically Generated Audio

For tests that need specific audio characteristics, generate files dynamically using FFmpeg rather than storing additional binary fixtures.

**Why dynamic generation?**

1. **No binaries in repo:** Keeps repository small and avoids Git LFS complexity
2. **Always current:** Fixtures match the exact format requirements of tests
3. **Easy to modify:** Adding new test scenarios only requires code changes
4. **Verifies real parsing:** Tests actual music-metadata library behavior

**Example: Generating test audio files**

```typescript
async function generateTestAudio(
  filePath: string,
  format: string,
  metadata: Record<string, string>
): Promise<void> {
  // Build FFmpeg metadata arguments
  const metadataArgs = Object.entries(metadata)
    .map(([key, value]) => ['-metadata', `${key}=${value}`])
    .flat();

  // Generate a 0.1 second silent audio file
  const args = [
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '0.1',
    ...metadataArgs,
    '-y', // Overwrite output
    '-loglevel', 'error',
    filePath,
  ];

  const result = spawnSync('ffmpeg', args, { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`FFmpeg failed with status ${result.status}`);
  }
}
```

**Usage in tests:**

```typescript
beforeAll(async () => {
  testDir = join(tmpdir(), `podkit-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });

  await generateTestAudio(join(testDir, 'song.mp3'), 'mp3', {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    track: '1/10',
    date: '2023',
    genre: 'Rock',
  });
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

**Supported metadata keys for FFmpeg:**
- `title` - Track title
- `artist` - Artist name
- `album` - Album name
- `albumartist` - Album artist (for compilations)
- `track` - Track number (format: "N/M" or just "N")
- `disc` - Disc number
- `date` - Year (or full date)
- `genre` - Genre name

See `packages/podkit-core/src/adapters/directory.integration.test.ts` for complete examples.

## CI Considerations

Integration tests will **fail** in CI if dependencies aren't available. This is intentional - it ensures CI runs are meaningful and not silently skipping tests.

For full integration test coverage in CI, ensure:
- gpod-tool is built as part of CI setup (`mise run tools:build`)
- libgpod-node native bindings are built (`bun run build` from root)
- FFmpeg is installed (with libfdk_aac for AAC encoding)

If a CI environment cannot provide all dependencies, run only unit tests:

```bash
bun run test:unit
```
