# @podkit/e2e-host-tests

End-to-end tests for the podkit CLI. Tests invoke the built CLI artifact (`dist/main.js`) as a real user would, against both dummy iPods (CI) and real iPods (manual validation).

## Running Tests

### Prerequisites

1. Build the CLI and native bindings:
   ```bash
   bun run build
   bun run build:native  # Build libgpod-node native bindings
   ```

2. Ensure gpod-tool is available:
   ```bash
   mise run tools:build
   ```

3. Ensure FFmpeg is installed:
   ```bash
   brew install ffmpeg  # macOS
   ```

**Note:** Tests that require libgpod (status, list from iPod, sync) need the native bindings to be built and accessible. The `init` command tests work without native bindings.

### Run with Dummy iPod (Default)

```bash
# Run all E2E tests
bun run test:e2e

# Or from test-packages/e2e-host-tests
bun run test
```

### Run with Real iPod

1. Connect your iPod and mount it

2. Run pre-flight checks:
   ```bash
   cd test-packages/e2e-host-tests
   IPOD_MOUNT=/Volumes/YourIPod bun run preflight
   ```

3. Run tests:
   ```bash
   IPOD_MOUNT=/Volumes/YourIPod bun run test:e2e:real
   ```

## Test Structure

```
src/
├── targets/           # iPod target abstraction
│   ├── types.ts       # IpodTarget interface
│   ├── dummy.ts       # Uses @podkit/gpod-testing
│   ├── real.ts        # Uses IPOD_MOUNT env var
│   └── factory.ts     # Creates target based on IPOD_TARGET env
│
├── sources/           # Music source abstraction (for remote sources)
│   ├── types.ts       # TestSource interface
│   ├── directory.ts   # Local directory source
│   ├── subsonic.ts    # Navidrome Docker source
│   └── index.ts       # Factory and exports
│
├── docker/            # Docker container management
│   ├── constants.ts   # Labels (podkit.e2e.managed=true)
│   ├── container-registry.ts  # Tracks active containers
│   ├── container-manager.ts   # start/stop with auto-cleanup
│   ├── signal-handler.ts      # SIGINT/SIGTERM handlers
│   ├── orphan-cleaner.ts      # Find/remove orphaned containers
│   └── index.ts
│
├── setup/             # Test setup
│   └── preload.ts     # Registers signal handlers (via bunfig.toml)
│
├── scripts/           # CLI utilities
│   └── cleanup-containers.ts  # Manual container cleanup
│
├── helpers/           # Test utilities
│   ├── cli-runner.ts  # Spawn CLI process, capture output
│   ├── fixtures.ts    # Audio fixture catalogue (path resolution delegated to @podkit/test-fixtures)
│   ├── video-fixtures.ts  # Video fixture catalogue (path resolution delegated to @podkit/test-fixtures)
│   └── preflight.ts   # Pre-flight checks for real iPod
│
├── commands/          # Per-command tests
│   ├── init.e2e.test.ts
│   ├── status.e2e.test.ts
│   ├── list.e2e.test.ts
│   ├── sync.e2e.test.ts
│   └── video-sync.e2e.test.ts
│
└── workflows/         # Multi-step workflow tests
    ├── fresh-sync.e2e.test.ts
    ├── incremental.e2e.test.ts
    └── subsonic-sync.e2e.test.ts  # Docker-based (opt-in)
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IPOD_TARGET` | Target type: `dummy` or `real` | `dummy` |
| `IPOD_MOUNT` | Mount path for real iPod (required when `IPOD_TARGET=real`) | - |
| `SUBSONIC_E2E` | Set to `1` to enable Docker-based Subsonic tests | - |

## Target Abstraction

Tests use an `IpodTarget` interface that abstracts away whether we're testing against a dummy iPod (temp directory) or a real device:

```typescript
interface IpodTarget {
  readonly path: string;           // Mount point
  readonly name: string;           // Display name
  readonly isRealDevice: boolean;  // Affects cleanup behavior

  getTrackCount(): Promise<number>;
  getTracks(): Promise<TrackInfo[]>;
  verify(): Promise<VerifyResult>;
  cleanup(): Promise<void>;
}
```

### Using Targets in Tests

```typescript
import { withTarget } from '../targets';

it('syncs tracks', async () => {
  await withTarget(async (target) => {
    // target.path is the iPod mount point
    const result = await runCli(['sync', '--device', target.path, ...]);

    // Verify tracks were added
    const count = await target.getTrackCount();
    expect(count).toBe(3);
  });
  // Cleanup happens automatically
});
```

## CLI Runner

The CLI runner spawns the actual CLI binary as a subprocess:

```typescript
import { runCli, runCliJson } from '../helpers/cli-runner';

// Basic usage
const result = await runCli(['status', '--device', '/path']);
expect(result.exitCode).toBe(0);
expect(result.stdout).toContain('Tracks:');

// JSON output parsing
const { result, json } = await runCliJson<StatusOutput>([
  'status', '--device', '/path', '--json'
]);
expect(json?.connected).toBe(true);
```

## Pre-flight Checks

Before running real iPod tests, pre-flight checks verify:

1. CLI is built
2. gpod-tool is available
3. FFmpeg is available
4. Test fixtures exist
5. Mount point exists and is accessible
6. iPod_Control directory exists
7. iTunesDB is readable
8. Sufficient free space (50MB minimum)
9. Write permissions

```bash
cd test-packages/e2e-host-tests
bun run preflight                           # Check basic requirements
IPOD_MOUNT=/Volumes/iPod bun run preflight  # Include real iPod checks
```

## Test Coverage

### Per-Command Tests

| Command | Tests |
|---------|-------|
| `init` | Config creation, `--force` overwrite, error handling |
| `status` | Device info, JSON output, error handling |
| `list` | Table/JSON/CSV formats, field selection |
| `sync` | Dry-run, actual sync, quality presets, errors |
| `video-sync` | Video sync via `sync -t video`, quality presets, content type categorization |

### Workflow Tests

| Workflow | Description |
|----------|-------------|
| Fresh sync | Empty iPod → init → sync → status → list |
| Incremental | Sync subset → sync full → verify only new tracks added |

## Safety Notes

### Real iPod Testing

- Tests **never auto-delete** user data on real devices
- `cleanup()` is a no-op for `RealIpodTarget`
- Always run pre-flight checks before testing with real hardware
- Consider using an old/test iPod rather than your main device

### Dummy iPod Testing

- Uses `@podkit/gpod-testing` to create temporary iPod directories
- Automatically cleaned up after each test
- Safe to run in CI environments

## Video Fixtures

Video E2E tests use pre-built video files generated by `@podkit/test-fixtures` (see that package's README for regen instructions and full file inventory):

| File | Purpose |
|------|---------|
| `compatible-h264.mp4` | iPod-compatible (640x480 H.264, AAC) - passthrough |
| `low-quality.mp4` | Low quality but compatible - passthrough |
| `high-res-h264.mkv` | 1080p H.264 - needs resolution downscale + remux |
| `incompatible-vp9.webm` | VP9 codec - needs full transcode |
| `movie-with-metadata.mp4` | Movie with embedded metadata (title, director) |
| `tvshow-episode.mp4` | TV show with S01E01 metadata |

### Using Video Fixtures in Tests

```typescript
import {
  withVideoSourceDir,
  getVideo,
  Videos,
  areVideoFixturesAvailable,
} from '../helpers/video-fixtures';

it('analyzes video collection', async () => {
  if (!await areVideoFixturesAvailable()) {
    console.log('Skipping: video fixtures not available');
    return;
  }

  await withVideoSourceDir(async (sourceDir) => {
    // sourceDir contains copies of video fixtures
    const configPath = await createTempConfig(sourceDir); // video collection
    const result = await runCli(['--config', configPath, 'sync', '--type', 'video', ...]);
    expect(result.exitCode).toBe(0);
  });
  // Cleanup happens automatically
});

// Use specific videos
await withVideoSourceDir(async (sourceDir) => {
  // ...
}, [getVideo(Videos.COMPATIBLE_H264), getVideo(Videos.MOVIE_WITH_METADATA)]);
```

### Video Test Considerations

- Full video transcoding is slow - focus on dry-run tests
- Dummy iPods may not have video support enabled
- Tests gracefully skip when device doesn't support video

## Docker-Based Tests

Some E2E tests require Docker to run external services (like Navidrome for Subsonic testing). These tests are disabled by default to avoid slow Docker operations in normal test runs.

### Running Docker Tests

```bash
# Run Subsonic E2E tests (requires Docker)
SUBSONIC_E2E=1 bun test src/workflows/subsonic-sync.e2e.test.ts

# Or use the convenience script
bun run test:subsonic
```

### Container Cleanup

Docker containers are automatically cleaned up via:
- Normal test completion (afterAll hooks)
- Signal handlers (Ctrl+C)
- Process exit handlers

If containers are left orphaned (e.g., after a crash), use the cleanup scripts:

```bash
# List orphaned test containers
bun run cleanup:docker:list

# Remove stopped test containers
bun run cleanup:docker

# Force remove all test containers (including running)
bun run cleanup:docker --force
```

Containers are labeled with `podkit.e2e.managed=true` for identification.

### Test Source Abstraction

Docker-based tests use the `TestSource` interface to abstract different music sources:

```typescript
interface TestSource {
  readonly name: string;           // Source identifier
  readonly requiresDocker: boolean;

  sourceUrl: string;              // URL for CLI --source
  trackCount: number;             // Expected tracks after setup

  setup(): Promise<void>;         // Start container, wait for ready
  teardown(): Promise<void>;      // Stop container, cleanup
  isAvailable(): Promise<boolean>;
  getEnv(): Record<string, string>;
}
```

### Adding New Docker Sources

To add a new Docker-based test source (e.g., Plex, Jellyfin):

1. Create `src/sources/yourservice.ts` implementing `TestSource`
2. Use the container manager for automatic cleanup:
   ```typescript
   import { startContainer, stopContainer } from '../docker/index.js';

   async setup() {
     const result = await startContainer({
       image: 'yourservice/image:latest',
       source: 'yourservice',  // Used in container labels
       ports: ['8080:8080'],
       env: ['CONFIG=value'],
     });
     this.containerId = result.containerId;
   }

   async teardown() {
     if (this.containerId) {
       await stopContainer(this.containerId);
     }
   }
   ```
3. Export from `src/sources/index.ts`
4. Create tests in `src/workflows/yourservice-sync.e2e.test.ts`

### Docker Infrastructure

```
src/docker/
├── constants.ts           # Labels (podkit.e2e.managed=true)
├── container-registry.ts  # Singleton tracking active containers
├── container-manager.ts   # start/stop with auto-labeling
├── signal-handler.ts      # SIGINT/SIGTERM cleanup
├── orphan-cleaner.ts      # Find/clean orphaned containers
└── index.ts               # Public exports
```

The `bunfig.toml` configures Bun to preload signal handlers before any tests run.
