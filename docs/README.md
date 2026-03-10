# Documentation Index

This directory contains design documentation, research notes, and architecture decision records for the podkit project.

## Reading Order

If you're new to the project, read in this order:

1. **[../README.md](../README.md)** — Project overview and quick start
2. **[PRD.md](PRD.md)** — What we're building and why
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** — How it's structured
4. **[adr/README.md](adr/README.md)** — Key decisions and their rationale

## Document Overview

### Core Documents

| Document | Purpose |
|----------|---------|
| [SUPPORTED-DEVICES.md](SUPPORTED-DEVICES.md) | iPod model compatibility, verification status, feature support |
| [PRD.md](PRD.md) | Product requirements, user stories, functional requirements, milestones |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component design, interfaces, data flow, error handling |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Development environment setup (macOS, Linux, Windows) |
| [TESTING.md](TESTING.md) | Testing strategy, conventions, unit vs integration tests |
| [DEVICE-TESTING.md](DEVICE-TESTING.md) | Device verification strategy, adding model tests |

### Features

| Document | Purpose |
|----------|---------|
| [TRANSFORMS.md](TRANSFORMS.md) | Metadata transforms (ftintitle, etc.), pipeline architecture |
| [VIDEO-TRANSCODING.md](VIDEO-TRANSCODING.md) | Video sync support, quality presets, device profiles |

### Research & Reference

| Document | Purpose |
|----------|---------|
| [PROJECT-NAMING.md](PROJECT-NAMING.md) | Naming research, alternatives considered, recommendations |
| [LIBGPOD.md](LIBGPOD.md) | libgpod C library API, binding approaches, implementation notes |
| [TRANSCODING.md](TRANSCODING.md) | FFmpeg AAC encoding, quality presets, metadata handling |
| [COLLECTION-SOURCES.md](COLLECTION-SOURCES.md) | Directory scanning with music-metadata, adapter interface |
| [IPOD-INTERNALS.md](IPOD-INTERNALS.md) | iTunesDB format, artwork formats, device quirks |
| [MACOS-IPOD-MOUNTING.md](MACOS-IPOD-MOUNTING.md) | Workaround for large iFlash iPods not mounting on macOS |

### Architecture Decision Records

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](adr/ADR-001-runtime.md) | Runtime Choice (Bun/Node) | Proposed |
| [ADR-002](adr/ADR-002-libgpod-binding.md) | libgpod Binding Approach | Proposed |
| [ADR-003](adr/ADR-003-transcoding.md) | Transcoding Backend | Proposed |
| [ADR-004](adr/ADR-004-collection-sources.md) | Collection Source Abstraction | Accepted |
| [ADR-006](adr/ADR-006-video-transcoding.md) | Video Transcoding | Accepted |

See [adr/README.md](adr/README.md) for ADR workflow and how to create new ADRs.

## Document Conventions

### Status Indicators

Documents may include status at the top:

- **Draft** — Work in progress, incomplete
- **Review** — Ready for feedback
- **Final** — Stable, approved content

### Keeping Docs Current

When working in this codebase:

1. **Update docs when implementation diverges** — If you implement something differently than documented, update the docs
2. **Mark outdated sections** — If you notice outdated content but can't fix it now, add a note
3. **Add missing docs** — If you needed information that wasn't documented, add it

### Adding New Documents

1. Create the document in this directory with a descriptive `UPPERCASE-NAME.md` filename
2. Add it to the appropriate section in this README
3. Add it to the Documentation Map in [../AGENTS.md](../AGENTS.md)
4. Keep documents focused — one topic per file

## Related Files

| File | Purpose |
|------|---------|
| [../AGENTS.md](../AGENTS.md) | AI agent instructions and quick reference |
| [../README.md](../README.md) | Project overview for humans |
| [../backlog/](../backlog/) | Task management (use MCP tools, don't edit directly) |
