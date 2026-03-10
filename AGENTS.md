# AGENTS.md

Instructions for AI agents (Claude Code, Cursor, etc.) working in this repository.

## Project Summary

**podkit** is a TypeScript toolkit for syncing music collections to iPod devices. It provides a CLI and library that handles collection diffing, transcoding (FLAC→AAC), metadata preservation, and artwork transfer.

**Status:** Active development

**Monorepo structure:**
```
packages/
├── e2e-tests/       # End-to-end CLI tests (dummy + real iPod)
├── gpod-testing/    # Test utilities for iPod environments (no hardware needed)
├── libgpod-node/    # Native Node.js bindings for libgpod (C library)
├── podkit-core/     # Core sync logic, adapters, transcoding
└── podkit-cli/      # Command-line interface

tools/
├── gpod-tool/       # C CLI for iPod database operations
└── libgpod-macos/   # macOS build scripts for libgpod
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
bun test packages/podkit-core    # Run tests for specific package

# Build
bun run build                    # Build all packages for Node.js

# CLI
podkit sync --dry-run                   # Sync all collections (music + video)
podkit sync music -c main --dry-run     # Sync specific music collection
podkit sync --device terapod            # Sync to named device
podkit sync --device /Volumes/iPod      # Sync to device by path
podkit device info                      # Show device status
podkit device music --format json       # List music on device
```

### System Dependencies

| Dependency | Debian/Ubuntu | macOS |
|------------|---------------|-------|
| libgpod | `libgpod-dev` | Build from source (see `tools/libgpod-macos/`) |
| FFmpeg | `ffmpeg` | `brew install ffmpeg` |
| GLib | `libglib2.0-dev` | `brew install glib` (installed as libgpod dep) |

See [docs/developers/development.md](docs/developers/development.md) for full setup instructions.

## Documentation Structure

The `docs/` directory is organized for web publication (Starlight-compatible):

```
docs/
├── index.md                    # Introduction
├── getting-started/            # Installation, quick start, first sync
├── user-guide/                 # Configuration, sources, transcoding, video
├── devices/                    # Supported devices, iPod internals
├── reference/                  # CLI commands, config file, quality presets
├── troubleshooting/            # Common issues, macOS mounting
└── developers/                 # Architecture, development, testing, ADRs
    └── adr/                    # Architecture Decision Records
```

### Documentation Map

Read these documents based on what you're working on:

| Topic | Document |
|-------|----------|
| First time in repo | [docs/index.md](docs/index.md) |
| User install and first sync | [docs/getting-started/](docs/getting-started/) |
| Configuration options | [docs/user-guide/configuration.md](docs/user-guide/configuration.md) |
| iPod model compatibility | [docs/devices/supported-devices.md](docs/devices/supported-devices.md) |
| Architecture and design | [docs/developers/architecture.md](docs/developers/architecture.md) |
| Development environment | [docs/developers/development.md](docs/developers/development.md) |
| Testing strategy | [docs/developers/testing.md](docs/developers/testing.md) |
| ADRs | [docs/developers/adr/](docs/developers/adr/) |
| libgpod integration | [docs/developers/libgpod.md](docs/developers/libgpod.md) |
| Transcoding (audio) | [docs/user-guide/transcoding.md](docs/user-guide/transcoding.md) |
| Video sync | [docs/user-guide/video-sync.md](docs/user-guide/video-sync.md) |
| Music sources | [docs/user-guide/music-sources.md](docs/user-guide/music-sources.md) |
| iPod internals | [docs/devices/ipod-internals.md](docs/devices/ipod-internals.md) |
| Troubleshooting | [docs/troubleshooting/](docs/troubleshooting/) |
| Transforms | [docs/reference/transforms.md](docs/reference/transforms.md) |
| Package READMEs | `packages/*/README.md` |

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

ADRs document significant technical decisions. See [docs/developers/adr/](docs/developers/adr/) for the full workflow.

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
| `developers/` | Architecture, development, testing, ADRs | Contributors |
| `developers/adr/` | Architecture Decision Records | Contributors |

## Key Technical Decisions

These decisions are documented in ADRs — read the full ADR for context:

| Decision | Summary | ADR |
|----------|---------|-----|
| Runtime | Bun for dev, Node.js for distribution | [ADR-001](docs/developers/adr/adr-001-runtime.md) |
| libgpod bindings | N-API (node-addon-api) directly | [ADR-002](docs/developers/adr/adr-002-libgpod-binding.md) |
| Transcoding | FFmpeg with AAC encoder | [ADR-003](docs/developers/adr/adr-003-transcoding.md) |
| Collection sources | Adapter pattern | [ADR-004](docs/developers/adr/adr-004-collection-sources.md) |
| Test environments | gpod-tool + temp directories | [ADR-005](docs/developers/adr/adr-005-test-ipod-environment.md) |
| Video transcoding | FFmpeg with H.264/M4V output | [ADR-006](docs/developers/adr/adr-006-video-transcoding.md) |

## Testing

See [docs/developers/testing.md](docs/developers/testing.md) for full testing strategy and conventions.

### Quick Reference

- **Unit tests** (`*.test.ts`): Fast, no external dependencies
- **Integration tests** (`*.integration.test.ts`): Require gpod-tool, FFmpeg, etc.
- **E2E tests** (`packages/e2e-tests/`): Full CLI workflow tests

```bash
bun run test              # All tests
bun run test:unit         # Unit tests only
bun run test:integration  # Integration tests only
bun run test:e2e          # E2E tests (dummy iPod)
bun run test:e2e:real     # E2E tests (real iPod, requires IPOD_MOUNT)
bun run test:e2e:docker   # E2E tests requiring Docker (Subsonic, etc.)

# Container cleanup (in packages/e2e-tests/)
cd packages/e2e-tests && bun run cleanup:docker
```

### Prerequisites for Integration Tests

```bash
mise run tools:build   # Build gpod-tool CLI
mise trust             # Trust mise config (first time only)
```

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

### Investigating New Issues

When encountering libgpod CRITICAL assertions or unexpected behavior:

1. **Reproduce with a test** - Create an integration test that triggers the issue
2. **Check libgpod source** - Look at `tools/libgpod-macos/build/libgpod-0.8.3/src/`
3. **Understand the expectation** - What does libgpod expect vs. what we're providing?
4. **Fix and document** - Apply the fix and document the deviation

## Code Conventions

- TypeScript strict mode
- Bun test runner
- ESM modules

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
