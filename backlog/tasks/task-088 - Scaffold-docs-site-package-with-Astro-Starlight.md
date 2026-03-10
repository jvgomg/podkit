---
id: TASK-088
title: Scaffold docs-site package with Astro + Starlight
status: In Progress
assignee: []
created_date: '2026-03-10 10:26'
updated_date: '2026-03-10 13:25'
labels:
  - docs-site
  - setup
milestone: Documentation Website v1
dependencies:
  - TASK-086
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the documentation site package in the monorepo using Astro and Starlight.

## Scope

1. **Initialize package** - Create `packages/docs-site/` with Astro + Starlight
   - Package.json with appropriate scripts
   - TypeScript configuration
   - Astro configuration

2. **Configure content collections** - Set up to pull markdown from `docs/` directory
   - Define collection schema with frontmatter validation
   - Configure glob loader to reference `../../docs/`
   - Ensure hot reload works for docs changes

3. **Basic Starlight configuration**
   - Site title and description
   - Base URL for jvgomg.github.io/podkit
   - Initial sidebar structure (can be refined later)
   - Dark/light mode

4. **Monorepo integration**
   - Add to workspace configuration
   - Ensure `bun run dev` works from package directory
   - Add root-level script for convenience

## Notes

This task can be done in parallel with TASK-087 (design exploration). The design decisions will inform sidebar structure, but the scaffolding can proceed independently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/docs-site/ exists with Astro + Starlight
- [ ] #2 Content collections configured to pull from docs/
- [ ] #3 Dev server runs and renders existing docs
- [ ] #4 Configured for GitHub Pages base URL
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-03-10**: Starting scaffold implementation based on TASK-086 research findings.
<!-- SECTION:NOTES:END -->
