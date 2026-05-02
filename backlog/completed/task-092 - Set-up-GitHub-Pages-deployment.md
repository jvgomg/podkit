---
id: TASK-092
title: Set up GitHub Pages deployment
status: Done
assignee: []
created_date: '2026-03-10 10:26'
updated_date: '2026-03-10 14:09'
labels:
  - docs-site
  - ci-cd
milestone: Documentation Website v1
dependencies:
  - TASK-088
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure automated deployment of the documentation site to GitHub Pages.

## Scope

1. **GitHub Actions workflow**
   - Build the docs-site package
   - Deploy to GitHub Pages
   - Trigger on push to main (with path filters for relevant changes)

2. **Configuration**
   - Site URL: jvgomg.github.io/podkit
   - Ensure base path is correctly configured in Astro
   - Set up GitHub Pages in repository settings

3. **Workflow optimization**
   - Cache dependencies for faster builds
   - Only rebuild when docs or docs-site changes

## Notes

This can proceed as soon as TASK-088 (scaffold) is complete. Doesn't need to wait for content to be finalized.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GitHub Actions workflow exists and succeeds
- [ ] #2 Site deploys to jvgomg.github.io/podkit
- [ ] #3 Deployment triggers automatically on relevant changes
<!-- AC:END -->
