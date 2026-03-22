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

devices/             # Device documentation profiles (specs, capabilities, research)
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

## Documentation

The `docs/` directory is organized for web publication (Starlight-compatible). Read [agents/documentation.md](agents/documentation.md) for the full documentation map, file conventions, and maintenance guidelines.

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

Read [agents/testing.md](agents/testing.md) when writing, running, or debugging tests.

Quick reference: `bun run test:unit --filter <package>` for targeted tests, `bun run test` for all, `bun test path/to/file.test.ts` for a single file.

## libgpod-node: Native Bindings

Read [agents/libgpod-node.md](agents/libgpod-node.md) when modifying the N-API bindings or investigating libgpod edge cases.

## Demo GIF

Read [agents/demo.md](agents/demo.md) when making CLI or core changes that could affect the demo recording.

## Shell Completions

Read [agents/shell-completions.md](agents/shell-completions.md) when modifying CLI commands or options.

## Docker Image

Read [agents/docker.md](agents/docker.md) when working on Docker distribution, the entrypoint, or daemon mode.

## Code Conventions

- TypeScript strict mode
- Bun test runner
- ESM modules

## Release Workflow

Read [agents/releases.md](agents/releases.md) when creating changesets, reviewing release PRs, or publishing releases.

Quick reference: `bunx changeset` to create a changeset. Required for user-facing changes to `podkit`, `@podkit/core`, `@podkit/libgpod-node`, `@podkit/daemon` or `@podkit/docker`.

## Config Migrations

Read [agents/config-migrations.md](agents/config-migrations.md) when making breaking changes to the config file format.

## Device Profiles

The `devices/` directory contains structured documentation for portable music players that podkit supports or may support in the future. Each file uses markdown with a YAML frontmatter block covering device specs, audio format support, metadata handling, artwork, playlists, and features.

Use `devices/TEMPLATE.md` when documenting a new device. Current profiles: `ipod.md` (stock firmware), `rockbox.md`, `echo-mini.md`.

When implementing support for a new device, read its profile first. When researching a device, update or create its profile with findings.

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
| Diagnostics framework | `packages/podkit-core/src/diagnostics/` |
| Lima test runner | `tools/lima/run-tests.sh` |
