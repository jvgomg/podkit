# AGENTS.md

Instructions for AI agents (Claude Code, Cursor, etc.) working in this repository.

## Project Summary

**podkit** is a TypeScript toolkit for syncing music collections to iPod devices. It provides a CLI and library that handles collection diffing, transcoding (FLAC→AAC), metadata preservation, and artwork transfer.

**Status:** Active development

**Monorepo structure:**
```
packages/
├── demo/            # Animated GIF demo (VHS + mocked CLI build)
├── e2e-tests/       # End-to-end CLI tests (dummy + real iPod)
├── gpod-testing/    # Test utilities for iPod environments (no hardware needed)
├── libgpod-node/    # Native Node.js bindings for libgpod (C library)
├── podkit-core/     # Core sync logic, adapters, transcoding
├── podkit-cli/      # Command-line interface
├── podkit-docker/   # Docker image (Dockerfile, entrypoint, compose files)
└── test-fixtures/   # Test fixture generator (FLAC files with controllable metadata/artwork)

tools/
├── gpod-tool/       # C CLI for iPod database operations
├── libgpod-macos/   # macOS build scripts for libgpod
└── lima/            # Lima VM configs for cross-platform testing (Debian + Alpine)
```

## Quick Reference

### Commands

```bash
# Development (uses Bun)
bun install                      # Install dependencies
bun run dev                      # Run in development mode
bun run test                     # Run all tests (unit + integration)
bun run test:unit                # Run unit tests only
bun run test:integration         # Run integration tests only
bun run test:e2e                 # Run E2E tests (dummy iPod)
bun run test --filter podkit-core # Run tests for specific package
mise run lima:test                # Run tests on Debian + Alpine VMs

# Build
bun run build                    # Build all packages for Node.js

# Release
bunx changeset                   # Create a changeset for your changes
bunx changeset version           # Apply pending changesets (CI does this)
bun run compile                  # Build standalone CLI binary locally

# CLI
podkit sync --dry-run                   # Sync all collections (music + video)
podkit sync -t music -c main --dry-run  # Sync specific music collection
podkit sync -d myipod                   # Sync to named device
podkit sync -d /Volumes/iPod            # Sync to device by path
podkit device scan                      # Scan for connected iPods
podkit device info                      # Show device status
podkit device music --format json       # List music on device
```

### System Dependencies

**For end users:** Only FFmpeg is required. libgpod is statically linked into prebuilt binaries.

| Dependency | Debian/Ubuntu | macOS | Alpine | Required for |
|------------|---------------|-------|--------|--------------|
| FFmpeg | `ffmpeg` | `brew install ffmpeg` | `ffmpeg` | Users + developers |
| libgpod | `libgpod-dev` | Build from source (see `tools/libgpod-macos/`) | `libgpod-dev` (community) | Development only |
| GLib | `libglib2.0-dev` | `brew install glib` (installed as libgpod dep) | `glib-dev` | Development only |
| util-linux | Pre-installed | N/A | `lsblk` | Linux device manager |
| Lima | N/A | `brew install lima` | N/A | Cross-platform testing |

See [docs/developers/development.md](docs/developers/development.md) for full setup instructions.

## Documentation Structure

The `docs/` directory is organized for web publication (Starlight-compatible):

```
docs/
├── index.md                    # Introduction
├── getting-started/            # Installation, quick start, first sync
├── user-guide/                 # Configuration, sources, devices, transcoding
├── devices/                    # Supported devices, iPod internals
├── reference/                  # CLI commands, config file, quality presets
├── troubleshooting/            # Common issues, macOS mounting
└── developers/                 # Architecture, development, testing
```

ADRs are stored at the repo root in `adr/` (outside `docs/` so they are not published to the docs site).

### Documentation Map

Read these documents based on what you're working on:

| Topic | Document |
|-------|----------|
| First time in repo | [docs/index.md](docs/index.md) |
| User install and first sync | [docs/getting-started/](docs/getting-started/) |
| Configuration concepts | [docs/user-guide/configuration.md](docs/user-guide/configuration.md) |
| Config file reference | [docs/reference/config-file.md](docs/reference/config-file.md) |
| Environment variables | [docs/reference/environment-variables.md](docs/reference/environment-variables.md) |
| iPod model compatibility | [docs/devices/supported-devices.md](docs/devices/supported-devices.md) |
| Architecture and design | [docs/developers/architecture.md](docs/developers/architecture.md) |
| Development environment | [docs/developers/development.md](docs/developers/development.md) |
| Testing strategy | [docs/developers/testing.md](docs/developers/testing.md) |
| ADRs | [adr/](adr/) |
| Contributing | [docs/developers/contributing.md](docs/developers/contributing.md) |
| libgpod integration | [docs/developers/libgpod.md](docs/developers/libgpod.md) |
| Device management | [docs/user-guide/devices/](docs/user-guide/devices/) |
| Transcoding (audio) | [docs/user-guide/transcoding/audio.md](docs/user-guide/transcoding/audio.md) |
| Transcoding (video) | [docs/user-guide/transcoding/video.md](docs/user-guide/transcoding/video.md) |
| Directory source | [docs/user-guide/directory-source.md](docs/user-guide/directory-source.md) |
| Subsonic source | [docs/user-guide/subsonic-source.md](docs/user-guide/subsonic-source.md) |
| iPod internals | [docs/devices/ipod-internals.md](docs/devices/ipod-internals.md) |
| Troubleshooting | [docs/troubleshooting/](docs/troubleshooting/) |
| Compilation albums | [docs/user-guide/syncing/compilation-albums.md](docs/user-guide/syncing/compilation-albums.md) |
| Artwork | [docs/user-guide/syncing/artwork.md](docs/user-guide/syncing/artwork.md) |
| Sound Check | [docs/user-guide/syncing/sound-check.md](docs/user-guide/syncing/sound-check.md) |
| Track upgrades | [docs/user-guide/syncing/upgrades.md](docs/user-guide/syncing/upgrades.md) |
| Clean Artists | [docs/reference/clean-artists.md](docs/reference/clean-artists.md) |
| Show Language (video) | [docs/reference/show-language.md](docs/reference/show-language.md) |
| Sync tags | [docs/reference/sync-tags.md](docs/reference/sync-tags.md) |
| Demo GIF package | [packages/demo/README.md](packages/demo/README.md) |
| Lima VMs (cross-platform testing) | [tools/lima/README.md](tools/lima/README.md) |
| Config migrations | [docs/developers/config-migrations.md](docs/developers/config-migrations.md) |
| Device hardware testing | [docs/developers/device-hardware-testing.md](docs/developers/device-hardware-testing.md) |
| Package READMEs | `packages/*/README.md` |
| Feature requests | [agents/feature-requests.md](agents/feature-requests.md) |
| About the project | [docs/project/about.md](docs/project/about.md) |
| Rockbox compatibility | [docs/devices/rockbox.md](docs/devices/rockbox.md) |
| Similar projects | [docs/project/similar-projects.md](docs/project/similar-projects.md) |
| Roadmap | [docs/project/roadmap.md](docs/project/roadmap.md) |
| Feedback & feature requests (user-facing) | [docs/project/feedback.md](docs/project/feedback.md) |
| Docker | [docs/getting-started/docker.md](docs/getting-started/docker.md) |
| Docker daemon mode | [docs/getting-started/docker-daemon.md](docs/getting-started/docker-daemon.md) |
| Config migrations | [docs/developers/config-migrations.md](docs/developers/config-migrations.md) |
| Config migration examples | `packages/podkit-cli/src/config/migrations/examples/` |
| LLM documentation system | [docs/developers/llm-documentation.md](docs/developers/llm-documentation.md) |

## Feature Requests & GitHub Discussions

Feature requests are managed through GitHub Discussions (Ideas category), with links in the documentation and backlog tasks. **See [agents/feature-requests.md](agents/feature-requests.md) for the complete guide** covering:

- Creating, updating, and closing discussions via the GitHub API
- The current discussions registry (all feature discussions with numbers and URLs)
- Which doc files reference which discussions and how to update them
- Workflows for moving features between roadmap tiers
- How discussions, docs, and backlog tasks stay in sync

When working on anything related to feature requests, planned features, or the roadmap, read that file first.

## Task Management (Backlog.md)

This project uses Backlog.md for task management via MCP tools. **Never edit backlog files directly** — always use the MCP tools.

### When to Create Tasks

**Create a task** when work requires planning or decisions (investigating bugs, designing features, choosing approaches).

**Skip tasks** for trivial/mechanical changes (typos, version bumps, obvious one-line fixes).

### Workflow

1. **Search first:** Use `task_search` or `task_list` to find existing related work
2. **View details:** Use `task_view` to understand existing task scope and progress
3. **Create if needed:** Use `task_create` for new work (consult `get_task_creation_guide` for structure)
4. **Update progress:** Use `task_edit` to update status, add notes, check acceptance criteria
5. **Mark done:** Set status to "Done" when complete (do not use `task_complete` — that's for batch cleanup)

### MCP Tools Reference

```
Guides:     get_workflow_overview, get_task_creation_guide,
            get_task_execution_guide, get_task_finalization_guide
Tasks:      task_list, task_search, task_view, task_create, task_edit
Documents:  document_list, document_view, document_create, document_update
```

## Architecture Decision Records (ADRs)

ADRs document significant technical decisions. See [adr/](adr/) for the full workflow.

### When to Create ADRs

- **Research tasks:** Create an ADR to capture findings and recommendations
- **Architectural changes:** Document the decision and alternatives considered
- **Technology choices:** Record why a library/pattern/approach was chosen

**Guidance:**
- If clearly significant (new package, binding strategy, data model) → create ADR without asking
- If unsure and working interactively → ask the user
- If unsure and working autonomously → create the ADR (easier to delete than reconstruct reasoning)

### Referencing ADRs

- Link ADRs in backlog tasks that implement them
- Update ADR status to "Accepted" when implementation begins
- Reference ADRs in code comments for non-obvious decisions

## Documentation Maintenance

**Continuously improve documentation as you work:**

1. **Fix errors:** If docs are wrong or outdated, fix them
2. **Fill gaps:** If you needed information that wasn't documented, add it
3. **Clarify ambiguity:** If you had to guess or ask for clarification, improve the docs
4. **Update status:** Keep ADR statuses, feature flags, and roadmaps current

### Documentation File Conventions

All markdown files in `docs/` must have Starlight-compatible frontmatter:

```yaml
---
title: Page Title
description: Brief SEO description (1-2 sentences)
sidebar:
  order: N  # Lower numbers appear higher in navigation
---
```

**When creating new docs:**
- Place in the appropriate subdirectory (`getting-started/`, `user-guide/`, `devices/`, `reference/`, `troubleshooting/`, or `developers/`)
- Use lowercase filenames with hyphens (e.g., `my-new-guide.md`)
- Add frontmatter with title, description, and sidebar order
- Update the Documentation Map in this file
- Keep docs focused and modular (one topic per file)

**When editing existing docs:**
- Preserve frontmatter format
- Keep sidebar order consistent within a section
- Update links if you rename or move files

### Directory Structure

| Directory | Purpose | Audience |
|-----------|---------|----------|
| `getting-started/` | Installation, quick start, first sync | New users |
| `user-guide/` | Configuration, sources, transcoding, video | All users |
| `devices/` | Supported devices, iPod internals | Users + developers |
| `reference/` | CLI commands, config file, quality presets | All users |
| `troubleshooting/` | Common issues, macOS mounting | Users with problems |
| `developers/` | Architecture, development, testing | Contributors |

## LLM Documentation

The docs site generates machine-readable documentation for LLM agents via the `starlight-llms-txt` plugin. Configuration is in `packages/docs-site/astro.config.mjs`.

**When adding or moving docs pages:**
- New pages within existing directories are automatically included in the right custom documentation sets (glob patterns use `**` wildcards).
- If you create a new top-level docs section, add it to the appropriate custom set in the plugin config.
- If you change common workflows, install methods, or the config format, update the `description` and `details` in the plugin config — this is the entry point agents always read.

See [docs/developers/llm-documentation.md](docs/developers/llm-documentation.md) for the full guide.

## Key Technical Decisions

These decisions are documented in ADRs — read the full ADR for context:

| Decision | Summary | ADR |
|----------|---------|-----|
| Runtime | Bun for dev, Node.js for distribution | [ADR-001](adr/adr-001-runtime.md) |
| libgpod bindings | N-API (node-addon-api) directly | [ADR-002](adr/adr-002-libgpod-binding.md) |
| Transcoding | FFmpeg with AAC encoder | [ADR-003](adr/adr-003-transcoding.md) |
| Collection sources | Adapter pattern | [ADR-004](adr/adr-004-collection-sources.md) |
| Test environments | gpod-tool + temp directories | [ADR-005](adr/adr-005-test-ipod-environment.md) |
| Video transcoding | FFmpeg with H.264/M4V output | [ADR-006](adr/adr-006-video-transcoding.md) |
| Self-healing sync | Detect and upgrade changed source files | [ADR-009](adr/adr-009-self-healing-sync.md) |
| Artwork change detection | Hash-based artwork diffing with opt-in scanning | [ADR-012](adr/adr-012-artwork-change-detection.md) |

## Testing

See [docs/developers/testing.md](docs/developers/testing.md) for full testing strategy and conventions.

### Quick Reference

- **Unit tests** (`*.test.ts`): Fast, no external dependencies
- **Integration tests** (`*.integration.test.ts`): Require gpod-tool, FFmpeg, etc.
- **E2E tests** (`packages/e2e-tests/`): Full CLI workflow tests

### Test Task Composition

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

### Running Tests Efficiently

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

### Interpreting Test Output

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

### Turbo Cache Awareness

Turbo caches test results based on file inputs. Be aware of these pitfalls:

- **Stale cache can mask failures.** If tests pass but you suspect they shouldn't (e.g., after changing behavior in an upstream package), clear the cache: `npx turbo run test --force`
- **E2E tests depend on the built CLI.** The `@podkit/e2e-tests#test` task uses `^build` (upstream builds) in its cache key. If you change podkit-cli or podkit-core source, the e2e cache invalidates automatically. But if you only change test files, `bun run build` may not re-run — rebuild explicitly if needed.
- **The `Cached: N cached` line in turbo output tells you what was reused.** If you expect a task to re-run but it shows as cached, the inputs may not cover what changed.

### Debugging E2E Failures

E2E tests spawn the CLI as a subprocess and check exit codes and output. When a test fails with `expect(result.exitCode).toBe(0)` / `Received: 1`, the test output often doesn't show the CLI's stderr. To see the actual error:

```bash
# Run the CLI command manually to see the real error message
node packages/podkit-cli/dist/main.js --config /path/to/test/config.toml sync --device /tmp/ipod --dry-run
```

Or add temporary logging in the test: `console.log(result.stderr)` before the assertion.

### Full Local Validation

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

### All Test Commands

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

### Prerequisites for Integration Tests

```bash
mise trust             # Trust mise config (first time only)
mise run tools:build   # Build gpod-tool CLI
```

### Working in Git Worktrees

When working in a git worktree (e.g., `.claude/worktrees/`), you must run these setup steps — worktrees are independent working directories and don't share the main repo's build artifacts or mise trust state:

```bash
bun install            # Install dependencies (worktree has its own node_modules)
mise trust             # Trust mise config for this worktree
mise run tools:build   # Build gpod-tool (needed for iPod database tests)
```

Without these steps, integration and E2E tests that use `@podkit/gpod-testing` will fail with "Missing iTunesDB file" errors because `gpod-tool` won't be in PATH.

### Writing Tests with iPod Databases

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

See [packages/gpod-testing/README.md](packages/gpod-testing/README.md) for full API documentation.

### Test Audio Fixtures

Pre-built FLAC files with metadata and artwork are available in `test/fixtures/audio/` for integration tests. See [test/fixtures/audio/README.md](test/fixtures/audio/README.md) for details.

### Test Fixture Generator

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

### Writing E2E Tests

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

See [packages/e2e-tests/README.md](packages/e2e-tests/README.md) for full documentation.

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

### Docker-Based E2E Tests

Some E2E tests use Docker to run external services (Navidrome for Subsonic). These are opt-in to avoid slow operations.

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

See [packages/e2e-tests/README.md](packages/e2e-tests/README.md) for the full Docker infrastructure documentation.

## libgpod-node: Native Bindings

The `@podkit/libgpod-node` package provides N-API bindings to libgpod. While it aims to closely follow libgpod's API, **some operations have enhanced behavior** to handle edge cases that libgpod doesn't address automatically.

### Documentation Requirement

**When modifying libgpod-node native code:**

1. **Document behavioral deviations** - If the binding behaves differently from raw libgpod, document it in:
   - `packages/libgpod-node/README.md` under "Behavioral Deviations from libgpod"
   - Inline comments in the native C++ code explaining the deviation

2. **Explain the "why"** - Include:
   - What libgpod does (or doesn't do)
   - What problems this causes (assertion failures, data corruption, etc.)
   - How our implementation differs
   - Why we can't just use libgpod's default behavior

3. **Add test coverage** - Create integration tests that verify the edge case is handled correctly

### Current Deviations

See `packages/libgpod-node/README.md` for the full list. Key deviations:

| Operation | libgpod Issue | Our Fix |
|-----------|---------------|---------|
| `removeTrack()` | Doesn't remove from playlists | Remove from all playlists first |
| `create()` | No master playlist | Create master playlist |
| `clearTrackChapters()` | NULL chapterdata crashes | Create empty chapterdata |
| `replaceTrackFile()` | `copyTrackToDevice()` no-ops if already transferred | Reset `transferred` flag, overwrite file in place |

### Investigating New Issues

When encountering libgpod CRITICAL assertions or unexpected behavior:

1. **Reproduce with a test** - Create an integration test that triggers the issue
2. **Check libgpod source** - Look at `tools/libgpod-macos/build/libgpod-0.8.3/src/`
3. **Understand the expectation** - What does libgpod expect vs. what we're providing?
4. **Fix and document** - Apply the fix and document the deviation

## Demo GIF

The `packages/demo/` package produces an animated GIF for the README using [VHS](https://github.com/charmbracelet/vhs). It compiles a standalone CLI binary with mocked `@podkit/core` and `packages/podkit-cli/src/utils/fs.ts` swapped at build time via Bun plugins.

```bash
bun run demo    # Build demo binary + record GIF
```

**Impact on CLI and core changes:**

- The demo binary compiles `packages/podkit-cli/src/main.ts` directly. CLI changes (new commands, changed flags, altered output) may break the demo build or recording.
- `src/mock-core.ts` must match the `@podkit/core` public API — adding/removing exports requires updating the mock.
- New filesystem usage in CLI commands should go through `packages/podkit-cli/src/utils/fs.ts` (not `node:fs` directly) so the demo's mock can intercept it.
- Run `bun run demo` after CLI or core changes to verify the demo still works.

See [packages/demo/README.md](packages/demo/README.md) for full details.

## Shell Completions

The `podkit completions` command generates shell completion scripts (zsh, bash) by walking the Commander.js command tree at runtime. Completions are **auto-generated from the actual CLI structure** — there is no static completion file to maintain.

The completion system supports three tiers:
1. **Subcommands and flags** — auto-generated from the Commander.js tree
2. **Static argument values** — options using `.choices()` or `.addOption(new Option(...).choices([...]))` auto-complete their values (e.g. `--quality` → `max`, `high`, `medium`, `low`)
3. **Dynamic argument values** — `--device` and `--collection` complete with names from the user's config via a hidden `__complete` command

**Impact on CLI changes:**

- Adding or removing commands, subcommands, or options requires **no changes** to the completions system. The generator reads the Commander.js program tree dynamically, so new commands automatically appear in completions.
- When adding an option with known values, use `.addOption(new Option(...).choices([...]))` instead of `.option()` — the completion generator picks up `argChoices` automatically.
- For options with a custom parse function (like sync's repeatable `-t, --type`), use `new Option()` with manual `argChoices` assignment to preserve the parser while exposing choices for completions.
- The hidden `__complete` command reads the config file directly (no validation) and outputs names. Dynamic completions for new option types require updating `extractCommandTree` (to tag the option) and the zsh/bash generators.
- The `--cmd` flag on `completions zsh/bash` controls which binary the dynamic helpers call. This is important for dev binaries with non-standard names (e.g. `podkit-dev`).

**Testing completions during development:**

```bash
bun run --filter podkit install:dev   # Build and install podkit-dev binary
# Add to ~/.zshrc:
#   source <(podkit-dev completions zsh --cmd podkit-dev)
#   compdef _podkit podkit-dev
```

See [docs/developers/development.md](docs/developers/development.md) for full setup.

## Docker Image

podkit is distributed as a Docker image at `ghcr.io/jvgomg/podkit`. See [docs/getting-started/docker.md](docs/getting-started/docker.md) for user documentation.

**Key files:**

| Purpose | Path |
|---------|------|
| Dockerfile | `packages/podkit-docker/Dockerfile` |
| Entrypoint script | `packages/podkit-docker/entrypoint.sh` |
| Docker Compose example | `packages/podkit-docker/docker-compose.yml` |
| Daemon Compose example | `packages/podkit-docker/docker-compose.daemon.yml` |
| CI workflow | `.github/workflows/docker.yml` |

**Architecture:**
- Base image: Alpine 3.21 (musl libc — CI produces musl-specific binaries for Docker)
- Multi-arch: linux/amd64 and linux/arm64 via `docker buildx`
- Pre-built musl binaries are copied from CI artifacts per `TARGETARCH`
- Runtime deps: FFmpeg + su-exec + shadow (for PUID/PGID)
- Follows LinuxServer.io conventions: PUID/PGID env vars, /config volume, branded startup banner

**Entrypoint behavior:**
1. Creates user/group matching PUID/PGID
2. `init` command generates a config file into the mounted /config volume
3. `sync` command auto-injects `--device /ipod`
4. `daemon` command runs `podkit-daemon` (separate binary, polls for iPods and auto-syncs)

Collections can be configured via environment variables (e.g., `PODKIT_MUSIC_PATH=/music`) — no config file required. See [docs/reference/environment-variables.md](docs/reference/environment-variables.md) for details.

**Impact on CLI changes:**
- New CLI commands need to be added to the `PODKIT_COMMANDS` list in `packages/podkit-docker/entrypoint.sh`
- The entrypoint passes `PODKIT_CONFIG=/config/config.toml` by default
- `PODKIT_TIPS=false` is set in the Dockerfile (tips aren't useful in Docker context)

**Daemon mode:**
- Opt-in via `command: daemon` in Docker Compose (CLI remains the default)
- Separate binary `podkit-daemon` polls for iPod devices and auto-syncs
- Requires USB passthrough (`--device /dev/bus/usb` or `--privileged`)
- Supports Apprise notifications via `PODKIT_APPRISE_URL`
- File-based health check at `/tmp/podkit-daemon-health`
- See [docs/getting-started/docker-daemon.md](docs/getting-started/docker-daemon.md) for user docs
- Daemon entry point: `packages/podkit-daemon/src/main.ts`

## Code Conventions

- TypeScript strict mode
- Bun test runner
- ESM modules

## Release Workflow

This project uses [changesets](https://github.com/changesets/changesets) for versioning and changelog generation.

### When to Add a Changeset

**Required** for any user-facing change to a published package:
- `podkit` (CLI)
- `@podkit/core`
- `@podkit/libgpod-node`

**Not required** for:
- Test-only changes
- Documentation-only changes
- CI/CD changes, dev tooling
- Changes to private packages (`@podkit/gpod-testing`, `@podkit/e2e-tests`, `@podkit/demo`, `@podkit/docs-site`)

### How to Add a Changeset

```bash
bunx changeset
```

1. Select affected package(s)
2. Choose bump type (`patch` / `minor` / `major`)
3. Write a summary from the user's perspective (this becomes the changelog entry)
4. Commit the generated `.changeset/*.md` file in the same PR as the code change

### Changeset Content Guidelines

- Write for end users, not developers
- Focus on what changed and why, not implementation details
- Use present tense ("Add", "Fix", "Improve")
- Good examples:
  - "Add support for syncing video files to iPod"
  - "Fix artwork not transferring for FLAC files"
  - "Improve transcoding performance for large collections"

### Version Bump Rules

- **patch**: Bug fixes, minor improvements
- **minor**: New features, non-breaking changes
- **major**: Breaking changes (config format, CLI flags, API)
- When in doubt, use `patch`
- Forgetting a changeset is recoverable — add one in a follow-up PR

### Release Flow

1. Changesets accumulate on `main` as PRs are merged
2. A bot PR ("Version Packages") is created/updated automatically
3. When ready to release, merge the version PR
4. CI builds binaries for 4 platforms and creates a GitHub Release with tarballs (`.github/workflows/release.yml`)
5. Docker image is built for linux/amd64 and linux/arm64 and pushed to GHCR (`.github/workflows/docker.yml`)
6. Homebrew formula is auto-updated with new version and checksums
7. Users get the update via `brew upgrade podkit` or `docker pull ghcr.io/jvgomg/podkit:latest`

### Reviewing and Improving a Release PR

Before merging a Version Packages PR, add a hand-written release summary above the auto-generated changelog. This makes the release accessible to users who follow the project. The audience is primarily CLI end users, but they're also interested in the technical side of how the tool is built.

**Workflow:**

1. **Read all pending changesets** in `.changeset/*.md` and the current PR body (`gh pr view`)
2. **Group changes by theme** — identify major features, breaking changes, performance/UX improvements, and bug fixes
3. **Draft a release summary** to prepend above the auto-generated changelog:
   - **Intro paragraph** — friendly, acknowledges the size and nature of the release. If there are breaking changes and the project is pre-v1, note that explicitly
   - **Highlights** — major features with 1-2 sentence descriptions and inline links to the published docs site (`https://jvgomg.github.io/podkit/...`)
   - **Breaking Changes** — each breaking item called out clearly with before/after code examples and migration steps
   - **Under the Hood** — technical engineering wins told in an engaging, light-hearted way. Communicate the value to users (e.g., "the 'high' preset was quietly producing ~44 kbps instead of ~256 kbps" rather than dry technical details). Bugs that were tricky or surprising make for good storytelling here
   - **Quality of Life** — smaller UX fixes in a bullet list
   - Wrap the existing auto-generated changelog in a `<details>` block at the bottom
4. **Check for doc gaps** — if new features don't have dedicated doc pages, create them before the release. New docs should be linked from the release summary
5. **Update the PR body** via `gh pr edit`
6. **Review feature discussions** — cross-reference the release contents against open GitHub Discussions (see [agents/feature-requests.md](agents/feature-requests.md) for the registry). For any feature that shipped in this release:
   - Apply the `released` label to the discussion
   - Update the Status section in the discussion body to say **Released** with a link to the relevant docs
   - Post a comment summarizing what shipped and linking to the docs page
   - Discuss with the user before closing discussions — some may prefer to keep them open for follow-up feedback

**Tone guidelines:**
- Conversational and enthusiastic but not over-the-top
- Focus on what changes mean for the user's experience, not just what was implemented
- For bug fixes, be light-hearted about tricky issues and communicate the user-facing impact
- Include links to relevant docs pages so users can learn more

## Config Migrations

podkit uses a versioned config system with a migration engine. The config file has a `version` field (positive integer). Configs without a version field are version 0 (pre-versioning era).

### When a Migration is Needed

**Required** for:
- Breaking config restructures (renaming/removing sections)
- Breaking field changes (type changes, renames, removals)
- New required fields that must have a value

**Not required** for:
- New optional fields with defaults (existing configs work without them)
- Internal-only changes that don't affect the config file
- Documentation-only changes

### How Config Versions Work

- `CURRENT_CONFIG_VERSION` in `packages/podkit-cli/src/config/version.ts` is the latest version
- Running any command with an outdated config → hard error pointing to `podkit migrate`
- `podkit migrate` detects the version, shows pending migrations, runs them sequentially, backs up the original, and writes the updated config
- Migrations work with raw TOML strings (not typed config objects) so they can handle incompatible structures

### How to Create a Migration

1. Increment `CURRENT_CONFIG_VERSION` in `packages/podkit-cli/src/config/version.ts`
2. Create a new migration file: `packages/podkit-cli/src/config/migrations/NNNN-description.ts`
3. Implement the `Migration` interface (see `packages/podkit-cli/src/config/migrations/types.ts`)
4. Register it in `packages/podkit-cli/src/config/migrations/registry.ts`
5. Add tests in a corresponding `.test.ts` file
6. See example migrations in `packages/podkit-cli/src/config/migrations/examples/` for templates covering 6 common scenarios

### Migration Types

- **Automatic** (`type: 'automatic'`): Deterministic transformations, no user input needed
- **Interactive** (`type: 'interactive'`): Uses `context.prompt` to ask user for decisions. User can abort at any point — aborting leaves the config unchanged.

### Key Files

| Purpose | Path |
|---------|------|
| Version constant | `packages/podkit-cli/src/config/version.ts` |
| Migration types | `packages/podkit-cli/src/config/migrations/types.ts` |
| Migration engine | `packages/podkit-cli/src/config/migrations/engine.ts` |
| Migration registry | `packages/podkit-cli/src/config/migrations/registry.ts` |
| Migrate command | `packages/podkit-cli/src/commands/migrate.ts` |
| Example migrations | `packages/podkit-cli/src/config/migrations/examples/` |
| Test utilities | `packages/podkit-cli/src/config/migrations/test-utils.ts` |

See [docs/developers/config-migrations.md](docs/developers/config-migrations.md) for the full developer guide.


## Entry Points

Key files to understand:

| Purpose | Path |
|---------|------|
| CLI entry | `packages/podkit-cli/src/main.ts` |
| Core library | `packages/podkit-core/src/index.ts` |
| libgpod bindings | `packages/libgpod-node/src/index.ts` |
| Test utilities | `packages/gpod-testing/src/index.ts` |
| E2E test helpers | `packages/e2e-tests/src/helpers/index.ts` |
| gpod-tool CLI | `tools/gpod-tool/gpod-tool.c` |
| Demo build | `packages/demo/build.ts` |
| Demo tape | `packages/demo/demo.tape` |
| Test fixture generator | `packages/test-fixtures/src/index.ts` |
| Docker entrypoint | `packages/podkit-docker/entrypoint.sh` |
| Dockerfile | `packages/podkit-docker/Dockerfile` |
| Linux device manager | `packages/podkit-core/src/device/platforms/linux.ts` |
| Lima VM configs | `tools/lima/` |
| Lima test runner | `tools/lima/run-tests.sh` |
