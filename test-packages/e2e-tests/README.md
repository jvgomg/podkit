# @podkit/e2e-tests

End-to-end tests for the podkit CLI. Tests invoke the built CLI artifact (`dist/main.js`) as a real user would, against both dummy iPods (CI) and real iPods (manual validation). Tests that require a Docker harness (Subsonic / Navidrome today; other containerised back-ends in future) live in this same package under the `src/docker-source/` surface directory — the `test:e2e` task excludes that directory, the `test:e2e:docker` task runs only it.

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

### Run host-only tests with Dummy iPod (default)

```bash
# Run all host-only E2E tests
bun run test:e2e

# Same thing from this directory
bun run --filter @podkit/e2e-tests test:e2e
```

### Run with Real iPod

1. Connect your iPod and mount it.

2. Run pre-flight checks:
   ```bash
   cd test-packages/e2e-tests
   IPOD_MOUNT=/Volumes/YourIPod bun run preflight
   ```

3. Run tests:
   ```bash
   IPOD_MOUNT=/Volumes/YourIPod bun run test:e2e:real
   ```

### Run Docker-gated tests

```bash
# From the repo root — runs only src/docker-source/ files.
bun run test:e2e:docker

# Same thing from this directory
bun run --filter @podkit/e2e-tests test:e2e:docker
```

Docker availability is checked in each file's `beforeAll`; missing Docker throws a focused error rather than silently skipping.

## Test Structure

```
src/
├── targets/           # iPod target abstraction
│   ├── types.ts       # IpodTarget interface
│   ├── dummy.ts       # Uses @podkit/gpod-testing
│   ├── real.ts        # Uses IPOD_MOUNT env var
│   └── factory.ts     # Creates target based on IPOD_TARGET env
│
├── sources/           # Music source abstraction
│   ├── directory.ts   # Local directory source
│   ├── subsonic.ts    # Navidrome Docker source (used by docker tests)
│   └── index.ts       # Factory and exports
│
├── docker/            # Docker container management
│   ├── constants.ts          # Labels (podkit.e2e.managed=true)
│   ├── container-registry.ts # Tracks active containers
│   ├── container-manager.ts  # start/stop with auto-cleanup
│   ├── signal-handler.ts     # SIGINT/SIGTERM handlers
│   ├── orphan-cleaner.ts     # Find/remove orphaned containers
│   └── index.ts
│
├── setup/             # Test setup
│   └── preload.ts     # Registers docker signal handlers (via bunfig.toml)
│
├── scripts/           # CLI utilities
│   └── cleanup-containers.ts # Manual container cleanup
│
├── helpers/           # Test utilities
│   ├── cli-runner.ts      # Spawn CLI process, capture output (re-exports from @podkit/e2e-shared)
│   ├── cli-error.ts       # expectCliError for subprocess assertions
│   ├── fixtures.ts        # Audio fixture catalogue
│   ├── video-fixtures.ts  # Video fixture catalogue
│   ├── subsonic-config.ts # createSubsonicConfig (Docker tests only)
│   └── preflight.ts       # Pre-flight checks for real iPod
│
├── docker-source/     # Docker-gated tests (the `docker-sidecar` Surface — Subsonic / Navidrome source)
│   ├── artwork-change.test.ts
│   ├── compilation-subsonic.test.ts
│   ├── subsonic-sync.test.ts
│   └── ... (all 8 docker-source tests)
│
├── commands/          # Per-command tests (host-only, default surface)
│   ├── init.test.ts
│   ├── status.test.ts
│   ├── list.test.ts
│   ├── sync.test.ts
│   └── video-sync.test.ts
│
├── features/          # Feature-level tests (host-only, default surface)
│   └── (host-only feature tests)
│
└── workflows/         # Multi-step workflow tests (host-only, default surface)
    ├── fresh-sync.test.ts
    ├── incremental.test.ts
    └── mixed-formats.test.ts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IPOD_TARGET` | Target type: `dummy` or `real` | `dummy` |
| `IPOD_MOUNT` | Mount path for real iPod (required when `IPOD_TARGET=real`) | - |

There is no longer a `SUBSONIC_E2E=1` opt-in — the filename suffix gates Docker tests instead.

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
import { runCli, runCliJson } from '@podkit/e2e-shared';

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
cd test-packages/e2e-tests
bun run preflight                           # Check basic requirements
IPOD_MOUNT=/Volumes/iPod bun run preflight  # Include real iPod checks
```

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

Tests that require Docker (Navidrome / Subsonic today; other containerised back-ends in future) live in the `src/docker-source/` surface directory — the `docker-sidecar` Surface in [the test taxonomy](../../documents/architecture/testing/taxonomy.md). The directory (not a filename suffix) is what gates them: `test:e2e` excludes it, `test:e2e:docker` selects it.

### Running Docker Tests

```bash
bun run test:e2e:docker
```

Each docker test file's `beforeAll` calls `isDockerAvailable()` and throws a focused error if Docker isn't reachable — no silent skips.

### Container Cleanup

Docker containers are automatically cleaned up via:
- Normal test completion (afterAll hooks)
- Signal handlers (Ctrl+C) registered in `src/setup/preload.ts` (loaded by `bunfig.toml`)
- Process exit handlers

If containers are left orphaned (e.g., after a crash), use the cleanup scripts:

```bash
bun run cleanup:list   # List orphaned test containers
bun run cleanup        # Remove stopped test containers
bun run cleanup:force  # Force remove all test containers (including running)
```

Containers are labeled with `podkit.e2e.managed=true` for identification.

### Test Source Abstraction

Docker-based tests use the `TestSource` interface (defined in `@podkit/e2e-shared`) to abstract different music sources:

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

1. Create `src/sources/yourservice.ts` implementing `TestSource`.
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
3. Export from `src/sources/index.ts`.
4. Create tests in `src/docker-source/yourservice-sync.test.ts` (the `docker-source/` directory is what makes the runner pick them up only under `test:e2e:docker`).

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
