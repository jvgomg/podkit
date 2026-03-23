---
id: TASK-135
title: Add "Similar Projects" docs page
status: Done
assignee: []
created_date: '2026-03-14 00:10'
updated_date: '2026-03-23 14:57'
labels:
  - docs
dependencies: []
documentation:
  - docs/about.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a lightweight documentation page covering other iPod syncing tools and how they compare to podkit at a high level. The tone should be supportive — acknowledging what each project does well and helping users understand which tool fits their needs.

**Projects to cover:**
- iOpenPod
- Tunes Reloaded
- Rhythmbox (iPod plugin)
- Strawberry Music Player

**Page structure per project:**
- Brief description (1-2 sentences)
- Key strengths / when you might prefer it
- Link to the project

**Also include** a short section on podkit's differentiators — not a deep feature comparison, just high-level keypoints that help users understand why they might choose podkit (e.g. CLI-first, collection-level sync, transcoding, headless/scriptable).

**Tone:** Supportive, not combative. "Here are great alternatives" with honest guidance on trade-offs.

**Page location:** TBD — decide during implementation based on where it fits best in the sidebar (likely under About or as a top-level page).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Page covers iOpenPod, Tunes Reloaded, Rhythmbox, and Strawberry Music Player
- [x] #2 Each project has a brief description, key strengths, and a link
- [x] #3 Includes a short podkit differentiators section (high-level, not a feature matrix)
- [x] #4 Tone is supportive and helps users pick the right tool
- [x] #5 Page has Starlight-compatible frontmatter
- [x] #6 Documentation Map in AGENTS.md is updated with the new page
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Similar projects page at `docs/project/similar-projects.md` covering iOpenPod, Tunes Reloaded, Rhythmbox, Strawberry, plus gtkpod and GNUpod. Includes podkit differentiators section, Starlight frontmatter, and documentation map updated.
<!-- SECTION:FINAL_SUMMARY:END -->
