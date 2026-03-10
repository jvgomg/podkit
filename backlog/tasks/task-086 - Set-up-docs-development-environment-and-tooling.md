---
id: TASK-086
title: Set up docs development environment and tooling
status: In Progress
assignee: []
created_date: '2026-03-10 10:25'
updated_date: '2026-03-10 13:27'
labels:
  - docs-site
  - setup
milestone: Documentation Website v1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prepare the development environment for working with Astro and Starlight. This is a foundational task to ensure developers can effectively work on the documentation site.

## Scope

1. **Install Astro skill** - Add the astro skill from https://skills.sh/astrolicious/agent-skills/astro to enable AI agents to work effectively with Astro projects

2. **Document Starlight/Astro workflow** - Add guidance to AGENTS.md or a new docs file covering:
   - How to run the docs site locally
   - Starlight conventions and configuration
   - Content collections structure
   - Frontmatter requirements and validation

3. **Verify tooling** - Ensure bun/node can run Astro dev server in the monorepo context
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Astro skill installed and configured
- [ ] #2 Developer documentation exists for working with the docs site
- [ ] #3 Dev server runs successfully in monorepo
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-03-10**: PM commissioned sub-agent to research Astro skill, document Starlight workflow, and verify Bun/Astro compatibility.

## Research Completed

### Astro Skill
- Available at: https://skills.sh/astrolicious/agent-skills/astro
- Install: `npx skills add https://github.com/astrolicious/agent-skills --skill astro`

### Bun + Astro Compatibility
**Recommendation: Use Node.js for docs-site, not Bun**

Rationale:
- Bun has SSR issues during Astro dev server usage
- Starlight uses SSR features for live reload
- Static site generation works, but dev experience is problematic
- GitHub Actions deployment uses Node anyway

### GitHub Pages Configuration
```javascript
site: 'https://jvgomg.github.io',
base: '/podkit',
```

### Starlight Frontmatter
- Required: `title`
- Recommended: `description`, `sidebar.order`
- Optional: `draft`, `template`, `hero`, etc.

### Draft AGENTS.md Content
Comprehensive guidance for docs-site development prepared.

### Monorepo Integration
Recommend keeping docs-site isolated with own package-lock.json, excluded from Bun workspace.

**2026-03-10**: Astro skill installed successfully via `npx skills add`. Located at `.agents/skills/astro/SKILL.md`.
<!-- SECTION:NOTES:END -->
