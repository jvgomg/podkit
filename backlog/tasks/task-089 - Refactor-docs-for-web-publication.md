---
id: TASK-089
title: Refactor docs/ for web publication
status: In Progress
assignee: []
created_date: '2026-03-10 10:26'
updated_date: '2026-03-10 13:43'
labels:
  - docs-site
  - documentation
milestone: Documentation Website v1
dependencies:
  - TASK-087
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reorganize and enhance the existing documentation in `docs/` to be suitable for web publication via Starlight.

## Scope

1. **File organization**
   - Rename files for web-friendly URLs (lowercase, hyphens)
   - Organize into subdirectories matching navigation structure
   - Consider: `guides/`, `reference/`, `developer/`

2. **Add frontmatter to all docs**
   - Title, description
   - Sidebar position/ordering
   - Any Starlight-specific frontmatter

3. **Update AGENTS.md**
   - Add directives about maintaining frontmatter when editing docs
   - Document the docs/ structure and conventions
   - Guidance on adding new documentation

4. **Content assessment**
   - Review each document for web-readability
   - Identify content that needs rewriting (can be addressed in TASK-090/091)
   - Ensure internal links work with new structure

## Approach

This is a complex task that requires judgment about organization. The developer should:
1. Review the design/IA from TASK-087
2. Propose a file structure and discuss before implementing
3. Create the plan/acceptance criteria refinements based on discussion
4. Implement the reorganization
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All docs have valid frontmatter
- [x] #2 Files organized in web-friendly structure
- [x] #3 AGENTS.md updated with docs maintenance guidance
- [ ] #4 Existing docs render correctly in Starlight
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-03-10**: Starting docs refactoring based on TASK-087 design decisions.

**2026-03-10**: Completed documentation refactoring:

**New Structure:**
- `docs/index.md` - Introduction page
- `docs/getting-started/` - installation.md, quick-start.md, first-sync.md
- `docs/user-guide/` - configuration.md, music-sources.md, transcoding.md, video-sync.md
- `docs/devices/` - supported-devices.md, ipod-internals.md
- `docs/reference/` - cli-commands.md, config-file.md, quality-presets.md, transforms.md
- `docs/troubleshooting/` - macos-mounting.md, common-issues.md
- `docs/developers/` - architecture.md, development.md, testing.md, device-testing.md, libgpod.md
- `docs/developers/adr/` - index.md + 8 ADR files with frontmatter

**All Files Include:**
- Starlight-compatible frontmatter (title, description, sidebar order)
- Lowercase hyphenated filenames
- Updated internal links

**AGENTS.md Updated:**
- New Documentation Structure section with directory tree
- Updated Documentation Map table
- Added Documentation File Conventions section with frontmatter requirements
- Added Directory Structure table explaining each subdirectory
- Updated all ADR links to new locations

**Stub Files Created:**
- reference/cli-commands.md (with TODO note for expansion)
- reference/config-file.md (with TODO note for expansion)

**Old Files Removed:**
- All uppercase .md files from docs root
- Old docs/adr/ directory
<!-- SECTION:NOTES:END -->
