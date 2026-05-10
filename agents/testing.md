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
mise run test:linux        # Runs on Debian + Alpine VMs (requires: brew install lima)

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
mise run test:linux              # Run tests on Debian + Alpine VMs
mise run test:linux:debian       # Debian (glibc) only
mise run test:linux:alpine       # Alpine (musl, Docker parity) only
mise run test:linux:stop         # Stop VMs (preserves state + turbo cache)
mise run test:linux:destroy      # Delete VMs entirely
mise run test:linux:cache:clear  # Clear turbo cache without deleting VMs
mise run tools:brew-test   # Homebrew install smoke test (after releases)

# Container cleanup (in packages/e2e-tests/)
cd packages/e2e-tests && bun run cleanup:docker
```

## Prerequisites for Integration Tests

```bash
mise trust             # Trust mise config (first time only)
mise install           # Pin to the bun version in mise.toml
mise run tools:build   # Build gpod-tool CLI
```

### Preflight checks

Each package that has integration tests ships a `bunfig.toml` and a small `test/` directory:

```
packages/<pkg>/
  bunfig.toml                    # [test] preload + pathIgnorePatterns
  test/preload.ts                # smart loader: only fires preflight when an integration test is in argv
  test/integration-preflight.ts  # actual dep assertions (gpod-tool, libgpod-node binding, ffmpeg, fixtures)
```

**Behavior:**

- `bun test` (bare) and `bun run test:unit` honour `pathIgnorePatterns` and skip `*.integration.test.ts` files entirely — unit-only iteration works without libgpod-node or gpod-tool installed.
- `bun run test:integration` clears the ignore (`--path-ignore-patterns=`) and filters to `.integration.` substring. The preload sees `.integration.` in argv, imports `integration-preflight.ts`, and that file throws if any required system dep is missing. **No silent skips.**
- The preload also fires for direct invocations like `bun test src/foo.integration.test.ts`, so you cannot bypass dep checks by calling bun directly.

**Adding a new integration test in a package without these files yet:** add `bunfig.toml`, `test/preload.ts`, `test/integration-preflight.ts` (copy from another package), and update `package.json scripts.test:unit` / `test:integration` to the standard form.

### Diagnosing environment issues

When integration tests pass but `podkit sync` produces no tracks (or similar silent failures), run the diagnostic suite against a virtual iPod:

```bash
node packages/podkit-cli/dist/main.js doctor --device <mount> --json
```

Particularly relevant checks: `codec-encoders` (audio encoders for the configured preference stack) and `video-encoder` (libx264 / h264_videotoolbox availability). The `doctor-system.e2e.test.ts` suite asserts both pass on every supported platform — Linux VMs especially, where macOS-only paths historically slipped through.

## Working in Git Worktrees

When working in a git worktree (e.g., `.claude/worktrees/`), you must run these setup steps — worktrees are independent working directories and don't share the main repo's build artifacts or mise trust state:

```bash
bun install            # Install dependencies (worktree has its own node_modules)
mise trust             # Trust mise config for this worktree
mise install           # Pull pinned bun version into this worktree
mise run tools:build   # Build gpod-tool (needed for iPod database tests)
```

Without these steps, integration tests will fail at preload time with a clear "Missing required test dependency" message naming the missing tool. That's the preflight system doing its job — fix the environment, don't suppress the error.

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

### Parallel integration test execution

Packages with many integration test files (`@podkit/libgpod-node`, `@podkit/core`) use the `gpod-tests-parallel` runner from `@podkit/gpod-testing` to run files in parallel subprocesses.

Direct invocation gets a big speedup:

```bash
cd packages/libgpod-node && bun run test:integration   # ~12s (was ~25s serial)
cd packages/podkit-core && bun run test:integration    # ~5s (was ~18s serial)
```

When run via `bun turbo run test:integration` across all packages, total wall-clock barely changes — turbo already runs packages in parallel and CPU is saturated. The runner's value is the **dev-iteration loop on a single package**, not full-suite wall-clock.

**Why files, not in-process `--concurrent`:** libgpod's native binding has non-thread-safe global state. `bun test --concurrent` collides — observed 4 failures. File-level subprocess isolation (one `bun test` per file) sidesteps this entirely.

**Why not all packages:** packages with few files (`podkit-cli` 3 files, `gpod-testing` 2 files) regress under parallelism — CPU contention overhead exceeds the parallelism gain. The runner is opt-in per package via `package.json scripts.test:integration`.

**Tuning:**

```bash
TEST_CONCURRENCY=4 bun run test:integration   # lower if oversubscribed
TEST_TIMEOUT=60000 bun run test:integration   # bump if tests are CPU-starved
```

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

## Writing CLI Unit and Integration Tests

**Hard rule: never spawn the podkit CLI as a subprocess from a unit or integration test.** Subprocess invocation lives only in `packages/e2e-tests/`. The rule is enforced by an oxlint check (`no-restricted-imports` for `node:child_process` in `packages/podkit-cli/src/**/*.test.ts`) — see `oxlint.json`.

For tests that need to drive a CLI command, call its **runner function** in-process. Each runner is an exported `async function runX(options, out, deps?)` extracted from the Commander action callback. Examples:

- `runDeviceAdd(options, out, deps?)` in `commands/device.ts`
- `runCollectionMusic(options, out)` / `runCollectionVideo(options, out)` in `commands/collection.ts`

### The four building blocks

| Piece | Purpose | Where |
|-------|---------|-------|
| `runWithContext(ctx, fn)` | Scope a `CliContext` for the runner via AsyncLocalStorage. Concurrent-safe. | `src/context.ts` |
| `OutputContext` + `BufferSink` | Capture stdout/stderr into a buffer instead of writing to the terminal. | `src/output/`, `src/test-utils/buffer-sink.ts` |
| `runAction(out, fn)` | Wrap a runner so thrown `CliError`s become structured output + `process.exitCode`. Use this in tests AND production action callbacks. | `src/errors.ts` |
| `<XDeps>` (e.g. `DeviceAddDeps`) | Inject fakes for `getDeviceManager`, `confirm`, `loadCore` so the runner doesn't perform real USB walks / prompts / dynamic imports. | per-runner |

### Test pattern

```typescript
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { OutputContext } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { runDeviceAdd, type DeviceAddDeps } from './device.js';

function makeContext(/* ... */): CliContext { /* construct config + globalOpts + configResult */ }

function makeOut(json = true) {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = new OutputContext({ mode: json ? 'json' : 'text', /* ... */, stdout, stderr });
  return { out, stdout, stderr };
}

// Compose runWithContext + runAction so the test runs the same path production does.
function runAdd(ctx: CliContext, opts: Parameters<typeof runDeviceAdd>[0], out: OutputContext, deps?: DeviceAddDeps) {
  return runWithContext(ctx, () => runAction(out, () => runDeviceAdd(opts, out, deps)));
}

it('rejects an unknown --quality preset', async () => {
  const ctx = makeContext({ device: 'd' });
  const { out, stdout } = makeOut();
  await runAdd(ctx, { type: 'echo-mini', quality: 'bogus' as never }, out);
  expect(stdout.json<{ success: false; error: string; code: string }>()).toMatchObject({
    success: false,
    code: 'INVALID_QUALITY',
  });
});
```

### When to extract a runner

If a Commander action callback grows beyond ~100 lines, or has any branch you'd like to unit-test, extract it. The pattern: pull the body into `export async function runX(opts, out, deps?)`, leave the `.action()` callback as a one-liner that builds `out` and calls `runAction(out, () => runX(...))`.

For external dependencies the runner pulls in (`getDeviceManager`, `confirm`, dynamic `import('@podkit/core')`), put them behind a `XDeps` interface so tests can stub. See `DeviceAddDeps` in `commands/device.ts:1658` as the canonical example.

### Throwing `CliError` instead of `process.exitCode = 1`

Inside a runner, error paths should:

```typescript
throw new CliError({
  message: 'Path not found: ' + path,
  code: 'PATH_NOT_FOUND',           // machine-readable tag, optional but encouraged
  details: { path },                // command-specific extras, merged into JSON output
});
```

The wrapper translates this to:
- text mode: `out.error(err.message)`
- JSON mode: `{ success: false, error, code, ...details }` on stdout
- `process.exitCode = err.exitCode` (default 1)

Tests assert on the captured JSON shape. Don't write `expect(process.exitCode).toBe(1)` as the primary assertion — `process.exitCode` is process-global and prevents `it.concurrent` within a file. Asserting on the structured JSON is concurrent-safe.

### `it.concurrent` caveat

`process.exitCode` is process-global, so any test that *also* asserts on `process.exitCode` cannot be `it.concurrent` with peers in the same file. Tests that only inspect stdout/stderr buffers can be concurrent — `runWithContext` provides ALS isolation, and each test's `BufferSink` is per-test state.

When in doubt, default to plain `it()`. Cross-file parallelism (bun test workers) gives you most of the speedup for free.

### Canonical error output shape

Every CLI command returning JSON on failure emits the same shape:

```json
{
  "success": false,
  "error": "<human-readable message>",
  "code": "<machine-readable tag>",
  "...command-specific details": "..."
}
```

JSON consumers should branch on `success === false` and read `error` / `code`. The shape is enforced by `runAction` + `CliError` — every command's `.action()` callback wraps its body in `runAction(out, () => fn())`, every error path inside throws `CliError`. No command sets `process.exitCode` directly for error cases. (A small handful of commands set `process.exitCode = 1` AFTER emitting a successful-shape JSON to signal "ran cleanly but found problems" — e.g. `doctor` reporting an unhealthy device. That is not an error case.)

For multi-line text-mode output, pass a `printText: (out: OutputContext) => void` callback in the `CliError` payload:

```typescript
throw new CliError({
  message: 'Mount failed',
  code: 'MOUNT_REQUIRES_SUDO',
  details: { device: '/dev/disk4s2' },
  printText: (o) => {
    o.error('Mount failed.');
    o.error('Run: sudo podkit mount');
  },
});
```

Without `printText`, runAction defaults to `out.error(err.message)`. The JSON-mode payload is unaffected; details merge into the top-level object.

### Text-only commands

A few commands (`completions zsh`, `completions bash`) emit non-JSON content (shell scripts) on the success path because that output is meant to be `eval`'d by the shell. Wrapping it in `{ "success": true, "script": "..." }` would break the use case.

For these commands:

- The **success path** writes plain text to stdout via `console.log` or `out.stdout()`. `--json` is ignored on success — the output is still the script.
- The **error path** still goes through `CliError` + `runAction`. Errors emit canonical JSON when `--json` is set. This part is universal.

Don't add per-command JSON shapes for text-only commands. If a user pipes the output, they want the shell script, not metadata. Document the asymmetry in the command's docstring.

### Narrowing the discriminated union

Each command's `*Output` type is a discriminated union of its success variant `| CliErrorOutput`. Consumers narrow with the `success` field:

```ts
import type { MountOutput } from 'podkit/commands/mount';

function handle(output: MountOutput) {
  if (output.success) {
    // narrowed to MountSuccess: device, mountPoint, dryRunCommand, etc.
    console.log(`Mounted at ${output.mountPoint}`);
  } else {
    // narrowed to CliErrorOutput: error, code, details
    console.error(`[${output.code}] ${output.error}`);
    if (output.details.requiresSudo) {
      console.error('Try: sudo podkit mount');
    }
  }
}
```

The `code` field (typed per-command via `XErrorCode`) lets consumers branch on machine-readable tags without parsing English. The `details` object carries command-specific extras nested one level — never spread at the top level — so the canonical fields can't collide with payload contents.

For asserting on this shape in tests, use `expectCliError` from `../test-utils/cli-error.js` (in-process) or `../helpers/cli-error.ts` (e2e/subprocess) — see "Asserting on CliError shape" above.

### Test helper: `expectCliError`

Both the in-process (`packages/podkit-cli/src/test-utils/cli-error.ts`) and subprocess (`packages/e2e-tests/src/helpers/cli-error.ts`) helpers collapse the standard "parse JSON, narrow, check fields" flow into one call:

```ts
// in-process
expectCliError(stdout, exitCode, {
  code: MountErrorCodes.MOUNT_REQUIRES_SUDO,
  error: /elevated privileges/,
  details: { device: '/dev/disk4s2' },
  exitCode: 1,           // optional, default 1
});

// e2e (spawns the CLI)
const { json } = await expectCliError(
  ['--config', cfg, 'mount', '--json'],
  { code: 'MOUNT_REQUIRES_SUDO', error: /sudo/ }
);
```

The helper asserts `success === false`, matches `code` exactly, optionally substring/regex-matches `error`, optionally checks `details` with `toMatchObject`, and asserts the exit code. Returns the parsed payload for additional inspection.

### Where the patterns live

| Pattern | Canonical file |
|---------|----------------|
| Runner extraction | `commands/device.ts` (`runDeviceAdd`), `commands/collection.ts` (`runCollectionMusic`) |
| Deps injection seam | `commands/device.ts` (`DeviceAddDeps`) |
| Test helper composition | `commands/collection.integration.test.ts` (`runMusic`, `runVideo`), `commands/device-add.unit.test.ts` (`runAdd`) |
| ALS isolation test | `context.test.ts` (the `runWithContext isolation` describe block) |
| Choices()-driven argv test (no runner) | `commands/doctor.test.ts` |

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
