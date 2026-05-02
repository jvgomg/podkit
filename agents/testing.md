# Testing

Detailed testing guidance for agents working in this repository. See [AGENTS.md](../AGENTS.md) for project overview.

Also see [docs/developers/testing.md](../docs/developers/testing.md) for full testing strategy and conventions.

## Quick Reference

- **Unit tests** (`*.test.ts`): Fast, no external dependencies
- **Integration tests** (`*.integration.test.ts`): Require gpod-tool, FFmpeg, etc.
- **E2E tests** (`packages/e2e-tests/`): Full CLI workflow tests

## Test Task Composition

The `test` turbo task is composed from `test:unit` and `test:integration` — it doesn't run tests itself. This means turbo can cache each sub-task independently:

```bash
bun run test:unit                    # Runs and caches unit tests per-package
bun run test:integration             # Runs and caches integration tests per-package
bun run test                         # Runs both — reuses cached sub-tasks
bun run test --filter podkit-core    # Same composition, scoped to one package
```

E2E tests are separate — `bun run test:e2e` runs the `test` script in `@podkit/e2e-tests` directly (not composed).

**Important:** Package `test` scripts are no-ops (`true`) because turbo handles the composition. Don't `cd` into a package and run `bun run test` directly — use turbo from the repo root. To run a single test file directly:

```bash
bun test packages/podkit-core/src/foo.test.ts  # Run a single file (bypasses turbo)
```

## Running Tests Efficiently

**Run targeted tests, not the full suite.** `bun run test` runs all unit and integration tests across every package — the output is long and noisy. After making changes, prefer running only what's needed:

```bash
bun run test:unit --filter podkit-core    # Unit tests for one package (fast)
bun run test --filter podkit-core         # All tests for one package
bun test packages/podkit-core/src/foo.test.ts  # Single file (bypasses turbo)
```

To re-run a specific failed test by name, use `-t` with a pattern:

```bash
bun test -t "fails when no device"   # Match test name substring
```

## Interpreting Test Output

Test output is prefixed with the package name (e.g., `@podkit/e2e-tests:test:`) because turborepo runs packages in parallel. Failures from different packages can be interleaved.

**Finding failures quickly:**

- Grep for `✗` (U+2717) — each failed test is marked with this symbol
- Grep for `error:` — Bun prints `error: expect(received).toBe(expected)` etc. on failure lines
- The `Expected` / `Received` block immediately after the error is the most useful part
- The stack trace gives the exact `file:line` of the assertion

**Common failure patterns:**

| Pattern | What it means | What to do |
|---------|---------------|------------|
| Exit code mismatch (`toBe(0)` got `1`) | The CLI command failed | Check stderr in the test output for the actual error message |
| String containment failure | An error message or output text changed | Read the `Received` value — the message was updated or the behavior changed |
| Timeout | Test exceeded time limit | Likely a real hang or missing async resolution |

**After running tests**, check the summary line at the end of each package's output:

```
Ran 316 tests across 13 files. [121.24s]
```

If any tests failed, Bun also prints a count like `X pass, Y fail` — scan for `fail` to confirm whether a package had failures.

## Turbo Cache Awareness

Turbo caches test results based on file inputs. Be aware of these pitfalls:

- **Stale cache can mask failures.** If tests pass but you suspect they shouldn't (e.g., after changing behavior in an upstream package), clear the cache: `npx turbo run test --force`
- **E2E tests depend on the built CLI.** The `@podkit/e2e-tests#test` task uses `^build` (upstream builds) in its cache key. If you change podkit-cli or podkit-core source, the e2e cache invalidates automatically. But if you only change test files, `bun run build` may not re-run — rebuild explicitly if needed.
- **The `Cached: N cached` line in turbo output tells you what was reused.** If you expect a task to re-run but it shows as cached, the inputs may not cover what changed.

## Debugging E2E Failures

E2E tests spawn the CLI as a subprocess and check exit codes and output. When a test fails with `expect(result.exitCode).toBe(0)` / `Received: 1`, the test output often doesn't show the CLI's stderr. To see the actual error:

```bash
# Run the CLI command manually to see the real error message
node packages/podkit-cli/dist/main.js --config /path/to/test/config.toml sync --device /tmp/ipod --dry-run
```

Or add temporary logging in the test: `console.log(result.stderr)` before the assertion.

## Full Local Validation

Run this sequence before submitting a PR:

```bash
# 1. Build, type check, lint
bun run build
bun run typecheck
bun run lint

# 2. macOS tests
bun run test              # Unit + integration
bun run test:e2e          # E2E with dummy iPod

# 3. Linux tests (cross-platform or device-related changes)
mise run lima:test         # Runs on Debian + Alpine VMs (requires: brew install lima)

# 4. Docker E2E (Subsonic changes only)
bun run test:e2e:docker
```

## All Test Commands

```bash
bun run test              # All tests (composed: runs test:unit + test:integration)
bun run test:unit         # Unit tests only (cached independently)
bun run test:integration  # Integration tests only (cached independently)
bun run test:e2e          # E2E tests (dummy iPod, not composed)
bun run test:e2e:real     # E2E tests (real iPod, requires IPOD_MOUNT)
bun run test:e2e:docker   # E2E tests requiring Docker (Subsonic, etc.)
mise run lima:test         # Run tests on Debian + Alpine VMs
mise run lima:test:debian  # Debian only
mise run lima:test:alpine  # Alpine only
mise run lima:stop         # Stop VMs (preserves state)
mise run lima:destroy      # Delete VMs entirely
mise run tools:brew-test   # Homebrew install smoke test (after releases)

# Container cleanup (in packages/e2e-tests/)
cd packages/e2e-tests && bun run cleanup:docker
```

## Prerequisites for Integration Tests

```bash
mise trust             # Trust mise config (first time only)
mise run tools:build   # Build gpod-tool CLI
```

## Working in Git Worktrees

When working in a git worktree (e.g., `.claude/worktrees/`), you must run these setup steps — worktrees are independent working directories and don't share the main repo's build artifacts or mise trust state:

```bash
bun install            # Install dependencies (worktree has its own node_modules)
mise trust             # Trust mise config for this worktree
mise run tools:build   # Build gpod-tool (needed for iPod database tests)
```

Without these steps, integration and E2E tests that use `@podkit/gpod-testing` will fail with "Missing iTunesDB file" errors because `gpod-tool` won't be in PATH.

## Writing Tests with iPod Databases

Use `@podkit/gpod-testing` to create test iPod environments:

```typescript
import { withTestIpod } from '@podkit/gpod-testing';

it('works with iPod database', async () => {
  await withTestIpod(async (ipod) => {
    await ipod.addTrack({ title: 'Test', artist: 'Artist' });
    const info = await ipod.info();
    expect(info.trackCount).toBe(1);
  });
});
```

See [packages/gpod-testing/README.md](../packages/gpod-testing/README.md) for full API documentation.

### Why gpod-testing for setup, not the production code

Test setup uses `gpod-tool` (an independent C program built from `tools/gpod-tool/`) to populate the iPod database. The production code being exercised — `IpodDatabase` from `@podkit/core`, backed by `@podkit/libgpod-node` — is then used to read or manipulate that state.

**Do not use `IpodDatabase` to seed test fixtures.** That would create circular validation: a libgpod-node bug where its writes are only readable by itself would still pass the test, because both sides of the round-trip use the same code. Setup with one tool, exercise with another, verify cross-tool compatibility.

### Adding multiple tracks: use `addTracks`, not a loop of `addTrack`

Each call to `ipod.addTrack(...)` spawns a `gpod-tool` subprocess (~150ms). For tests that need more than one track of setup state, use the bulk helper:

```typescript
// SLOW: 5 subprocess spawns + 5 libgpod open/save cycles
await ipod.addTrack({ title: 'A', artist: 'X' });
await ipod.addTrack({ title: 'B', artist: 'X' });
await ipod.addTrack({ title: 'C', artist: 'X' });
await ipod.addTrack({ title: 'D', artist: 'X' });
await ipod.addTrack({ title: 'E', artist: 'X' });

// FAST: one spawn, one open/save (~150ms total instead of ~750ms)
await ipod.addTracks([
  { title: 'A', artist: 'X' },
  { title: 'B', artist: 'X' },
  { title: 'C', artist: 'X' },
  { title: 'D', artist: 'X' },
  { title: 'E', artist: 'X' },
]);
```

Internally this is one `gpod-tool add-tracks` invocation that reads a TSV stream on stdin. Returns `AddTrackResult[]` in the same order as the input. Single-track tests can keep using `addTrack` — there's no benefit to converting them.

### Template Fast-Path

`createTestIpod()` is internally backed by pre-built iPod database templates. When a test calls it with default arguments, it copies a template directory (~5ms) instead of spawning `gpod-tool init` (~300ms). This delivers a ~3.3× speedup on `test:integration` (111s → 34s on the maintainer's machine).

**Transparent to test authors** — no API change. Use `createTestIpod()` and `withTestIpod()` exactly as before.

**When the fast path is used:** all of the following must be true:
- `model` is in `TEMPLATE_MODELS` (MA147, MA002, MA146, MA477, MB565, MC293, MC027)
- `name` is the default (`'Test iPod'`)
- `firewireId` is the default (`TEST_FIREWIRE_GUID`)
- The template directory exists on disk

Otherwise it falls back to a `gpod-tool init` subprocess. The fallback is correct but ~60× slower per call.

**Regenerating templates:**

```bash
bun turbo run generate-templates --filter=@podkit/gpod-testing  # cached
bun turbo run generate-templates --filter=@podkit/gpod-testing --force  # force rebuild
```

Templates live in `packages/gpod-testing/templates/` (gitignored, ~290KB total). The turbo task invalidates on changes to the generation script, `src/templates.ts`, `src/test-ipod.ts`, `src/gpod-tool.ts`, or the `bin/gpod-tool` binary itself. Consuming integration test tasks (`@podkit/gpod-testing#test:integration`, the global `test:integration`, `@podkit/ipod-db#test:integration`, `@podkit/e2e-tests#test`, `@podkit/ipod-db#generate-fixtures`) declare it as a dependency, so templates rebuild automatically when needed.

**Adding a new model:**
1. Add the model number to `TEMPLATE_MODELS` in `packages/gpod-testing/src/templates.ts`.
2. Add it to the `IpodModelNumber` literal union in `packages/gpod-testing/src/types.ts`.
3. (Optional) Add a friendly alias to `TestModels` in `packages/gpod-testing/src/test-ipod.ts`.
4. Run `bun turbo run generate-templates --filter=@podkit/gpod-testing --force` to regenerate.

**Disabling the fast path** (for benchmarking or debugging suspected template-induced bugs):

```bash
PODKIT_DISABLE_TEMPLATE_CACHE=1 bun turbo run test:integration --force
```

This forces every `createTestIpod()` call through the subprocess path. The env var is declared in `globalPassThroughEnv` in `turbo.json` so turbo passes it through to test runs.

## Test Audio Fixtures

Pre-built FLAC files with metadata and artwork are available in `test/fixtures/audio/` for integration tests. See [test/fixtures/audio/README.md](../test/fixtures/audio/README.md) for details.

## Test Fixture Generator

The `@podkit/test-fixtures` package generates FLAC files with controllable metadata and artwork for manual testing:

```bash
bun run generate-fixtures                    # Default: 3 FLAC tracks with blue artwork
bun run generate-fixtures --artwork red      # Regenerate with red artwork
bun run generate-fixtures --artwork          # Random different artwork color
bun run generate-fixtures --tracks 5         # Generate 5 tracks
bun run generate-fixtures --format mp3       # Convert to MP3
bun run generate-fixtures --replaygain -3.5  # Set specific ReplayGain value
```

Output goes to `test/manual-collection/` (gitignored). Without flags, output is deterministic and turbo-cached. Each variance flag (`--artwork`, `--format`, `--replaygain`) picks a random different value if no specific value is given. Requires FFmpeg and metaflac.

## Writing E2E Tests

Use `@podkit/e2e-tests` helpers for CLI testing:

```typescript
import { withTarget } from '../targets';
import { runCli, runCliJson } from '../helpers/cli-runner';

it('syncs tracks to iPod', async () => {
  await withTarget(async (target) => {
    // target.path is the iPod mount point (dummy or real)
    const result = await runCli(['sync', '--device', target.path, '--source', '/music']);
    expect(result.exitCode).toBe(0);

    // Verify tracks were added
    const count = await target.getTrackCount();
    expect(count).toBeGreaterThan(0);
  });
});
```

See [packages/e2e-tests/README.md](../packages/e2e-tests/README.md) for full documentation.

**Config files must include `version = 1`.** Every test config — whether created via `createTempConfig()` or inline — must start with `version = 1`. Configs without a version field are treated as version 0 and cause a hard error requiring migration. Use the helpers when possible:

```typescript
// Helper handles version automatically
const configPath = await createTempConfig('/path/to/music');

// For inline configs, always start with version = 1
await writeFile(configPath, `version = 1

[music.main]
path = "${musicPath}"

[defaults]
music = "main"
`);

// For minimal/empty configs
await writeFile(configPath, 'version = 1\n');
```

## Docker-Based E2E Tests

Some E2E tests use Docker to run external services (Navidrome for Subsonic). These are opt-in to avoid slow operations. See also [agents/docker.md](docker.md) for the Docker image architecture.

**Running Docker tests:**
```bash
cd packages/e2e-tests
bun run test:subsonic  # Runs Subsonic E2E tests with Docker
```

**Container cleanup:**
Docker containers are automatically cleaned up on test completion, Ctrl+C, and crashes. If orphaned containers remain:

```bash
cd packages/e2e-tests
bun run cleanup:docker:list   # List orphaned containers
bun run cleanup:docker        # Remove stopped containers
bun run cleanup:docker --force  # Force remove all
```

**Adding new Docker sources:**
When implementing new Docker-based test sources, use the container manager at `packages/e2e-tests/src/docker/`:

```typescript
import { startContainer, stopContainer } from '../docker/index.js';

// Containers are automatically labeled and registered for cleanup
const result = await startContainer({
  image: 'service/image:latest',
  source: 'service-name',
  ports: ['8080:8080'],
  env: ['CONFIG=value'],
});
```

See [packages/e2e-tests/README.md](../packages/e2e-tests/README.md) for the full Docker infrastructure documentation.
