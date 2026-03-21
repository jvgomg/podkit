---
id: TASK-184
title: Design new landing page for docs site
status: To Do
assignee: []
created_date: '2026-03-21 22:04'
labels:
  - docs
  - design
dependencies: []
references:
  - backlog/docs/doc-009 - Podkit-Website-Branding.md
  - 'https://github.com/jvgomg/podkit/pull/47'
  - packages/docs-site/astro.config.mjs
  - docs/index.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design and implement a compelling landing page for the podkit docs site (`packages/docs-site/`) that replaces the current default Starlight index page.

## Context

The docs site currently uses the default Starlight landing page. We want something more visually distinctive that evokes iPod nostalgia and showcases what podkit does.

## Typography

Custom webfonts are being added in PR #47 (`docs/custom-webfonts-v2`):
- **Source Sans 3 Variable** — body font (Myriad Pro alternative)
- **Chicago FLF** — pixel display font (iPod-era Chicago recreation, Public Domain)
- **ChiKareGo2** — bitmap pixel font (Chicago recreation, CC BY)

See backlog doc-009 (Podkit Website Branding) for full branding research.

## Prerequisites

- PR #47 (custom webfonts) must be merged first

## Design Considerations

- Use Chicago-style pixel fonts for hero text / headings to evoke the iPod aesthetic
- Source Sans 3 for body/descriptive text
- Consider iPod-era visual motifs (click wheel, screen UI, silhouette ads)
- The demo GIF (`packages/demo/demo.gif`) could feature prominently
- Key selling points to surface: FLAC→AAC transcoding, metadata preservation, artwork transfer, multi-device support, incremental sync
- Should work well in both light and dark mode
- Starlight supports custom landing page components via overrides
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Landing page uses Chicago-style pixel font for hero/display text
- [ ] #2 Source Sans 3 used for body text
- [ ] #3 Demo GIF or equivalent visual is featured
- [ ] #4 Key features are highlighted (transcoding, metadata, artwork, multi-device, incremental sync)
- [ ] #5 Works in both light and dark mode
- [ ] #6 Mobile responsive
- [ ] #7 Builds successfully with astro build
<!-- AC:END -->
