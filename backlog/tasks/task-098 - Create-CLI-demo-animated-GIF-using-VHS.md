---
id: TASK-098
title: Create CLI demo animated GIF using VHS
status: Done
assignee: []
created_date: '2026-03-10 10:31'
updated_date: '2026-03-23 14:57'
labels:
  - docs-site
  - marketing
milestone: Documentation Website v2
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create an animated GIF demonstrating podkit CLI usage for the landing page and documentation.

## Scope

1. **Install and configure VHS** - https://github.com/charmbracelet/vhs
2. **Script the demo** - Create a .tape file showing:
   - Basic sync workflow
   - Key commands in action
   - Clean, readable terminal output
3. **Generate GIF** - Optimize for web (size, quality)
4. **Integrate into docs** - Add to landing page hero or getting started

## Notes

VHS allows scripting terminal recordings with precise timing and clean output.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VHS tape file exists for CLI demo
- [x] #2 Animated GIF generated and optimized
- [x] #3 GIF integrated into landing page or getting started
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
VHS tape file at `packages/demo/demo.tape`, generated GIF at `packages/demo/demo.gif` (404KB), integrated into both the docs landing page (`docs/index.mdx`) and root README.
<!-- SECTION:FINAL_SUMMARY:END -->
