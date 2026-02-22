# AGENTS.md

Instructions for AI agents (Claude Code, Cursor, etc.) working in this repository.

## Project Summary

**podkit** is a TypeScript toolkit for syncing music collections to iPod devices. It provides a CLI and library that handles collection diffing, transcoding (FLAC→AAC), metadata preservation, and artwork transfer.

**Status:** Pre-development (planning/documentation phase)

**Monorepo structure:**
```
packages/
├── libgpod-node/    # Native Node.js bindings for libgpod (C library)
├── podkit-core/     # Core sync logic, adapters, transcoding
└── podkit-cli/      # Command-line interface
```

## Quick Reference

### Commands

```bash
# Development (uses Bun)
bun install                      # Install dependencies
bun run dev                      # Run in development mode
bun test                         # Run all tests
bun test packages/podkit-core    # Run tests for specific package

# Build
bun run build                    # Build all packages for Node.js

# CLI (once implemented)
podkit sync --source strawberry --dry-run
podkit status
```

### System Dependencies

| Dependency | Debian/Ubuntu | macOS (Homebrew) |
|------------|---------------|------------------|
| libgpod | `libgpod-dev` | `libgpod` |
| FFmpeg | `ffmpeg` | `ffmpeg` |
| GLib | `libglib2.0-dev` | (included with libgpod) |

## Documentation Map

Read these documents based on what you're working on:

| Document | When to Read |
|----------|--------------|
| [docs/README.md](docs/README.md) | First time in repo, need orientation |
| [docs/PRD.md](docs/PRD.md) | Understanding requirements, user stories, scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Understanding component design, interfaces, data flow |
| [docs/adr/README.md](docs/adr/README.md) | Understanding or making architectural decisions |
| [docs/LIBGPOD.md](docs/LIBGPOD.md) | Working on iPod database integration |
| [docs/TRANSCODING.md](docs/TRANSCODING.md) | Working on audio conversion |
| [docs/COLLECTION-SOURCES.md](docs/COLLECTION-SOURCES.md) | Working on Strawberry/beets adapters |
| [docs/IPOD-INTERNALS.md](docs/IPOD-INTERNALS.md) | Debugging iPod-specific issues |

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

ADRs document significant technical decisions. See [docs/adr/README.md](docs/adr/README.md) for the full workflow.

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

**When creating new docs:**
- Place in `docs/` with a clear, descriptive filename
- Add to the Documentation Map above
- Add to `docs/README.md` index
- Keep docs focused and modular (one topic per file)

## Key Technical Decisions

These decisions are documented in ADRs — read the full ADR for context:

| Decision | Summary | ADR |
|----------|---------|-----|
| Runtime | Bun for dev, Node.js for distribution | [ADR-001](docs/adr/ADR-001-runtime.md) |
| libgpod bindings | ffi-napi prototype, then N-API | [ADR-002](docs/adr/ADR-002-libgpod-binding.md) |
| Transcoding | FFmpeg with AAC encoder | [ADR-003](docs/adr/ADR-003-transcoding.md) |
| Collection sources | Adapter pattern | [ADR-004](docs/adr/ADR-004-collection-sources.md) |

## Code Conventions

*(To be established when implementation begins — document conventions here as they emerge)*

- TypeScript strict mode
- Bun test runner
- ESM modules

## Entry Points

When implementation exists, key files to understand:

| Purpose | Path |
|---------|------|
| CLI entry | `packages/podkit-cli/src/main.ts` |
| Core library | `packages/podkit-core/src/index.ts` |
| libgpod bindings | `packages/libgpod-node/src/index.ts` |
