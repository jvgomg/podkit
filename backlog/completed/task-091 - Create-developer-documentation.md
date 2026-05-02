---
id: TASK-091
title: Create developer documentation
status: Done
assignee: []
created_date: '2026-03-10 10:26'
updated_date: '2026-03-10 14:02'
labels:
  - docs-site
  - documentation
  - developer-facing
milestone: Documentation Website v1
dependencies:
  - TASK-089
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Document the developer-facing aspects of podkit for library users and contributors.

## Scope

1. **libgpod-node section**
   - What it is and why it exists
   - Installation and basic usage
   - API reference or link to generated docs
   - Behavioral deviations from libgpod (already documented in package README)

2. **podkit-core section**
   - Building your own sync applications
   - Core concepts (adapters, sync engine, transcoding)
   - Example usage

3. **Contributing guide**
   - Development setup
   - Testing approach
   - PR process

4. **Architecture overview**
   - High-level system design (adapted from existing ARCHITECTURE.md)
   - Package responsibilities
   - Key design decisions (link to ADRs)

## Approach

This requires understanding the codebase deeply. The developer should:
1. Review existing developer docs (ARCHITECTURE.md, package READMEs, ADRs)
2. Identify what's suitable for external consumption
3. Propose structure and discuss
4. Write documentation that enables developers to use/contribute
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 libgpod-node has dedicated documentation section
- [ ] #2 podkit-core usage is documented
- [ ] #3 Contributing guide exists
- [ ] #4 Architecture overview adapted for web
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reviewed and improved all five developer documentation files against the actual codebase, and created a new contributing guide.

### Changes made:

**`docs/developers/architecture.md`**
- Updated package structure tree to accurately reflect all modules (video, transforms, device, metadata, config, output)
- Added gpod-testing and e2e-tests packages with their internal structure
- Added tools/ directory to the tree
- Fixed `CollectionAdapter.getFilePath()` to `getFileAccess()` with `FileAccess` union type (path vs stream)
- Fixed `SyncDiff` to include `toUpdate` field and use `IPodTrack` instead of `Track`
- Added description of transforms module
- Added note about parallel video sync types
- Replaced simplified track matching pseudocode with accurate description of normalization rules (unicode, articles, placeholders)
- Added Video Sync Pipeline section describing VideoDirectoryAdapter, differ, planner, executor, and device profiles

**`docs/developers/development.md`**
- Removed nonexistent `bun run dev:watch` command
- Added `lint:fix`, `format`, `format:check`, `clean` commands
- Noted that oxlint is the linter and Prettier is the formatter
- Added note about Turborepo orchestration

**`docs/developers/testing.md`**
- Clarified the real iPod test command comment

**`docs/developers/libgpod.md`**
- Added `initializeIpod()` directory auto-creation to behavioral deviations table
- Fixed TrackHandle code example to use actual API methods (`Database.openSync`, `db.updateTrack`, `db.copyTrackToDevice`, `db.saveSync`)
- Added "Native Code Structure" section documenting all C++ files in `native/`

**`docs/developers/device-testing.md`**
- Removed reference to nonexistent `packages/e2e-tests/src/models/` directory
- Simplified model test example to use supported Video models instead of Classic models that require FirewireID
- Added note about FirewireID limitation
- Fixed real hardware test instructions to show both root-level and package-level commands with correct env vars

**`docs/developers/contributing.md`** (new)
- Brief contributing guide covering workflow, code conventions, monorepo structure, testing, and documentation expectations
- Added to AGENTS.md Documentation Map
<!-- SECTION:FINAL_SUMMARY:END -->
