# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

podkit is a TypeScript toolkit for syncing music collections to iPod devices. It provides a CLI tool and library that synchronizes music from collection sources (Strawberry, beets, local files) to iPod devices, handling transcoding, metadata, and artwork.

**Status:** Pre-development (planning/documentation phase)

## Commands

```bash
# Development (uses Bun)
bun install          # Install dependencies
bun run dev          # Run in development mode
bun test             # Run tests
bun test path/to/file.test.ts  # Run single test file

# Build for production (Node.js compatible)
bun run build        # Build all packages

# CLI usage (once implemented)
podkit sync --source strawberry --dry-run
podkit status
```

## Architecture

### Monorepo Structure

```
packages/
├── libgpod-node/    # Native Node.js bindings for libgpod (C library)
├── podkit-core/     # Core sync logic, adapters, transcoding
└── podkit-cli/      # Command-line interface
```

### Key Technical Decisions

- **Runtime:** Bun for development, Node.js 20+ for distribution (ADR-001)
- **libgpod bindings:** Hybrid approach - ffi-napi prototype, then N-API for production (ADR-002)
- **Transcoding:** FFmpeg with AAC encoder
- **Collection sources:** Adapter pattern (Strawberry SQLite, beets, directory scanning)

### Core Data Flow

1. **Collection Adapter** reads tracks from source (Strawberry/beets/directory)
2. **Differ** compares collection tracks to iPod tracks by (artist, title, album)
3. **Planner** creates operations: transcode, copy, remove, update-metadata
4. **Executor** runs operations: transcode → extract artwork → add to iPod DB → copy file
5. **libgpod** writes changes to iPod database

### Key Interfaces

- `CollectionAdapter` - Uniform interface for reading from music sources
- `IPodDatabase` - Wrapper around libgpod operations
- `Transcoder` - FFmpeg-based audio conversion
- `SyncEngine` - Orchestrates diff → plan → execute workflow

## System Dependencies

| Dependency | Debian | macOS (Homebrew) |
|------------|--------|------------------|
| libgpod    | `libgpod-dev` | `libgpod` |
| FFmpeg     | `ffmpeg` | `ffmpeg` |
| GLib       | `libglib2.0-dev` | (with libgpod) |

## Documentation

- `docs/PRD.md` - Product requirements and user stories
- `docs/ARCHITECTURE.md` - Component design and interfaces
- `docs/LIBGPOD.md` - libgpod API research
- `docs/TRANSCODING.md` - FFmpeg AAC encoding configuration
- `docs/adr/` - Architecture Decision Records


<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management activities.

**CRITICAL GUIDANCE**

- If your client supports MCP resources, read `backlog://workflow/overview` to understand when and how to use Backlog for this project.
- If your client only supports tools or the above request fails, call `backlog.get_workflow_overview()` tool to load the tool-oriented overview (it lists the matching guide tools).

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

These guides cover:
- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and finalization
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
