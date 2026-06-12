# AGENTS.md

Instructions for AI agents (Claude Code, Cursor, etc.) working in this repository.

## Project Summary

**podkit** is a TypeScript toolkit for syncing music collections to iPod devices. It provides a CLI and library that handles collection diffing, transcoding (FLAC→AAC), metadata preservation, and artwork transfer.

**Status:** Active development

**Monorepo structure:**
```
packages/            # Published / published-adjacent packages
├── compatibility/   # Cross-version compatibility helpers
├── demo/            # Animated GIF demo (VHS + mocked CLI build)
├── device-types/    # Shared TypeScript types for device capabilities, identity, firmware
├── devices-ipod/    # Pure TypeScript iPod generation tables + capability synthesis (no libgpod)
├── devices-mass-storage/ # User-extensible mass-storage preset framework (Echo Mini, Rockbox, generic)
├── docs-site/       # Documentation site (Starlight/Astro)
├── ipod-avatar/     # iPod avatar image assets
├── ipod-db/         # Pure TypeScript iTunesDB/ArtworkDB parser (browser-compatible)
├── ipod-firmware/   # iPod firmware inquiry — SCSI via koffi (SG_IO/IOKit), USB via the `usb` npm package
├── ipod-web/        # Virtual iPod UI — React + Jotai web component
├── libgpod-node/    # Native Node.js bindings for libgpod (database operations only; no USB/libusb)
├── podkit-core/     # Core sync logic, adapters, transcoding
├── podkit-cli/      # Command-line interface
├── podkit-docker/   # Docker image (Dockerfile, entrypoint, compose files)
├── podkit-daemon/   # Background sync daemon
├── virtual-ipod-app/    # Tauri macOS app — frameless iPod-shaped window
└── virtual-ipod-server/ # Lima VM backend — USB gadget + REST/WebSocket API

test-packages/             # Testing infrastructure (private, not published)
├── device-testing/        # VM test harness — DevicePersona + SystemState registries, TestRuntime, Lima yamls, apply-state.sh
├── device-testing-daemon/ # Userspace daemon — synthesises iPod USB gadgets (FunctionFS + mass-storage) on dummy_hcd
├── e2e-tests/             # End-to-end CLI tests on the host (dummy + real iPod). Docker-gated files use the `*.docker.test.ts` suffix
├── e2e-shared/            # Cross-cutting helpers shared by every e2e package (CLI runner, preflight, error assertions)
├── e2e-vm-tests/          # End-to-end podkit feature tests inside the Lima VM
├── gpod-testing/          # Test utilities for iPod environments (no hardware needed)
└── test-fixtures/         # Static + dynamic test fixtures (audio + video, lib + CLI generators)

tools/
├── demo/            # Live demo documentation for the virtual iPod system
├── gpod-tool/       # C CLI for iPod database operations
├── libgpod-macos/   # macOS build scripts for libgpod
└── lima/            # Lima VM configs (Debian, Alpine, virtual-ipod)

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
bun run test:perf                # Run *.perf.test.ts performance benchmarks (manual)
bun run test:e2e                 # Run E2E tests (dummy iPod, no Docker)
bun run test:e2e:docker              # Run Docker-gated E2E tests (Subsonic / Navidrome)
bun run test --filter podkit-core # Run tests for specific package
bun run quality                  # Full quality gate: lint+typecheck+build (parallel) → test → test:e2e → test:e2e:docker → test:vm (serial)
mise run test:linux               # Run tests on Debian + Alpine Linux VMs

# Device-harness VM lifecycle (macOS dev; Lima)
bun run harness:setup            # First-time: create VM, build + install binaries, seal baseline hash
bun run harness:start            # Resume a stopped VM
bun run harness:stop             # Stop the VM (preserves state)
bun run harness:status           # Health check: VM, binaries, systemd unit, kernel modules
bun run harness:install          # Rebuild + transfer podkit/daemon/gpod-tool/unit (manual; test:vm now does this automatically)
bun run harness:shell            # Interactive shell inside the VM
bun run harness:destroy          # Delete the VM entirely (--yes to skip confirm)
bun run test:vm                  # Run VM tests — auto-runs vm:install (cached) + vm:doctor (drift check) first
bunx turbo run @podkit/device-testing#vm:install  # Force-refresh the in-VM binary outside test:vm
bunx turbo run @podkit/device-testing#vm:doctor   # Drift-check only — no install

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

## Architecture Docs

`documents/architecture/` holds the slow-moving, settled descriptions of how podkit is put together — what each subsystem owns, the primitives it exposes, the responsibility boundaries between layers, and the conventions a new contributor (or agent) must follow. **Read [documents/architecture/README.md](documents/architecture/README.md) before working on a subsystem you don't know.**

Cross-cutting rules (typed errors, no `console.warn` in core, sink-not-stderr, test-pins-contract) live in [documents/architecture/conventions.md](documents/architecture/conventions.md) — these apply to every package and every PR.

Per-subsystem docs (currently only [sync/error-handling.md](documents/architecture/sync/error-handling.md); more pending — see the README's migration plan) follow a consistent eight-section template described in the README. When a refactor changes a convention, update the relevant architecture doc in the same PR. When you settle a new convention not yet documented, file a new doc or extend an existing one.

The architecture docs are distinct from the rough-edges journals in `backlog/docs/doc-NNN-*.md` (working catalogue of *what's still smelly*) and from ADRs in `adr/` (decision log frozen at decision time). Don't duplicate content across them — link.

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

## ipod-firmware: USB inquiry + bundling

Read [agents/ipod-firmware.md](agents/ipod-firmware.md) when working on the firmware inquiry orchestrator, the diagnostic logger surface, or bundling `@podkit/ipod-firmware` (or anything that depends on it transitively) into a single-file binary.

## Demo GIF

Read [agents/demo.md](agents/demo.md) when making CLI or core changes that could affect the demo recording.

## Shell Completions

Read [agents/shell-completions.md](agents/shell-completions.md) when modifying CLI commands or options.

## Docker Image

Read [agents/docker.md](agents/docker.md) when working on Docker distribution, the entrypoint, or daemon mode.

## Virtual iPod

The virtual iPod system creates a synthetic iPod for demonstrating podkit. It consists of four packages and a Lima VM. See [backlog/docs/doc-028](backlog/docs/doc-028%20-%20Virtual-iPod-Architecture-and-Package-Design.md) for the full architecture document and [tools/demo/README.md](tools/demo/README.md) for the live demo guide.

**Packages:**
- `@podkit/ipod-db` — Pure TypeScript iTunesDB/ArtworkDB parser. Browser-compatible (DataView-based, no Node.js Buffer). Used by ipod-web to read real iPod databases. Shares foundational work with the libgpod-node replacement (m-8).
- `@podkit/ipod-web` — React + Jotai iPod 5th gen UI component. Reusable — works in browser, Tauri, or any web context. Click wheel with rotational drag + keyboard. Menu state machine, playback engine, Now Playing screen. StorageProvider interface with RemoteStorage (HTTP/WS) and BrowserStorage (stub).
- `@podkit/virtual-ipod-server` — Runs inside a Lima VM. Manages USB gadget via configfs + dummy_hcd (Apple vendor/product IDs). Serves iPod filesystem over REST + WebSocket. podkit sees the virtual device as a real iPod with zero code changes.
- `@podkit/virtual-ipod-app` — Tauri v2 macOS app. Frameless transparent window shaped like an iPod. Manages Lima VM lifecycle.

**Lima VM (`tools/lima/podkit-virtual-ipod.yaml`):**
- Debian 12 with dummy_hcd + configfs USB gadget support
- `mise run vipod:install` rsyncs source to `/opt/podkit/` (VM-local, won't touch macOS node_modules), builds, and installs podkit binary to `/usr/local/bin`
- `mise run vipod:shell` drops into an isolated `james@lima-virtual-ipod:~$` with podkit in PATH and tab completion

**Milestone:** m-17 (Virtual iPod). Tasks tracked in backlog.

## Code Conventions

- TypeScript strict mode
- Bun test runner
- ESM modules

## Release Workflow

Read [agents/releases.md](agents/releases.md) when creating changesets, reviewing release PRs, or publishing releases.

Quick reference: `bunx changeset` to create a changeset. Required for user-facing changes to `podkit`, `@podkit/core`, `@podkit/libgpod-node`, `@podkit/daemon` or `@podkit/docker`.

Docs site deploys from a dedicated `docs-live` branch, not from `main`. Releases sync `docs-live` automatically; docs-only updates between releases require a cherry-pick from `main` to `docs-live`. See the "Docs Site Deployment" section in [agents/releases.md](agents/releases.md).

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
| Test utilities | `test-packages/gpod-testing/src/index.ts` |
| Shared e2e helpers | `test-packages/e2e-shared/src/index.ts` |
| E2E test helpers | `test-packages/e2e-tests/src/helpers/index.ts` |
| E2E host preflight | `test-packages/e2e-tests/src/helpers/preflight.ts` |
| Docker e2e harness | `test-packages/e2e-tests/src/docker/index.ts` |
| Subsonic test source | `test-packages/e2e-tests/src/sources/subsonic.ts` |
| VM test harness | `test-packages/device-testing/src/index.ts` |
| VM test entry | `test-packages/e2e-vm-tests/src/` |
| FunctionFS daemon | `test-packages/device-testing-daemon/src/main.ts` |
| VM test Lima configs | `test-packages/device-testing/lima/` |
| Harness lifecycle script | `test-packages/device-testing/scripts/harness.ts` |
| apply-state.sh | `test-packages/device-testing/scripts/apply-state.sh` |
| gpod-tool CLI | `tools/gpod-tool/gpod-tool.c` |
| Demo build | `packages/demo/build.ts` |
| Demo tape | `packages/demo/demo.tape` |
| Test fixtures lib | `test-packages/test-fixtures/src/lib.ts` |
| Static fixture generators | `test-packages/test-fixtures/src/static/` |
| Dynamic fixture CLI | `test-packages/test-fixtures/scripts/generate-fixtures.ts` |
| Static fixture CLI | `test-packages/test-fixtures/scripts/generate-static-fixtures.ts` |
| Docker entrypoint | `packages/podkit-docker/entrypoint.sh` |
| Dockerfile | `packages/podkit-docker/Dockerfile` |
| Linux device manager | `packages/podkit-core/src/device/platforms/linux.ts` |
| Lima VM configs | `tools/lima/` |
| Diagnostics framework | `packages/podkit-core/src/diagnostics/` |
| Lima test runner | `tools/lima/run-tests.sh` |
| iPod DB parser | `packages/ipod-db/src/index.ts` |
| iPod DB reader facade | `packages/ipod-db/src/reader.ts` |
| iPod DB fixture generator | `packages/ipod-db/fixtures/generate.ts` |
| iPod web component | `packages/ipod-web/src/index.ts` |
| iPod web firmware | `packages/ipod-web/src/firmware/menu.ts` |
| Virtual iPod server | `packages/virtual-ipod-server/src/main.ts` |
| Virtual iPod USB gadget | `packages/virtual-ipod-server/src/gadget.ts` |
| Virtual iPod Tauri app | `packages/virtual-ipod-app/src/App.tsx` |
| Virtual iPod Lima config | `tools/lima/podkit-virtual-ipod.yaml` |
| Live demo guide | `tools/demo/README.md` |
| Device-types entry | `packages/device-types/src/index.ts` |
| iPod identity | `packages/devices-ipod/src/identity.ts` |
| iPod capabilities | `packages/devices-ipod/src/capabilities.ts` |
| Mass-storage preset | `packages/devices-mass-storage/src/preset.ts` |
| iPod firmware orchestrator | `packages/ipod-firmware/src/inquiry/orchestrator.ts` |
| iPod firmware SCSI transport | `packages/ipod-firmware/src/inquiry/scsi/index.ts` |
| iPod sysinfo I/O | `packages/ipod-firmware/src/sysinfo/` |
| Plist parser | `packages/ipod-firmware/src/plist/parser.ts` |
| Capability resolver | `packages/podkit-core/src/device/resolve-capabilities.ts` |
