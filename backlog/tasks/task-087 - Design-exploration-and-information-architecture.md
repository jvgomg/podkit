---
id: TASK-087
title: Design exploration and information architecture
status: Done
assignee: []
created_date: '2026-03-10 10:25'
updated_date: '2026-03-10 13:24'
labels:
  - docs-site
  - design
milestone: Documentation Website v1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the messaging, structure, and visual direction for the documentation website before implementation begins.

## Scope

1. **Value proposition messaging** - Define how to communicate podkit's value:
   - Sync music collections to iPod devices
   - Preserve metadata and artwork
   - Automatic FLAC→AAC transcoding
   - Support for multiple collection sources (filesystem, Subsonic)

2. **Information architecture** - Plan the documentation structure:
   - User guides (getting started, syncing, CLI)
   - Developer docs (libgpod-node, podkit-core, contributing)
   - Navigation hierarchy and sidebar organization

3. **Landing page concept** - Rough design/wireframe for the marketing landing page:
   - Hero section with value prop
   - Feature highlights
   - Quick start section
   - Links into documentation

## Approach

This task requires research and design thinking. The developer should:
1. Review existing docs and identify gaps
2. Look at similar CLI tool documentation sites for inspiration
3. Propose a structure and messaging approach
4. Discuss with stakeholders before finalizing
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Value proposition messaging documented
- [x] #2 Documentation structure/navigation plan created
- [x] #3 Landing page concept/wireframe exists
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-03-10**: PM commissioned sub-agent to research similar sites, propose IA/messaging, and create landing page concept.

## Design Research Completed

### Value Proposition
- **One-liner:** "Sync your music collection to classic iPods, the way it should work."
- **Tagline:** "The music library sync tool for iPod enthusiasts"

### Proposed Navigation Structure
1. **Getting Started** - Introduction, Installation, Quick Start, First Sync
2. **User Guide** - Configuration, Collection Sources, Transcoding, Video, Multi-device
3. **Device Compatibility** - Supported Devices, iFlash/SD, Rockbox
4. **Reference** - CLI Commands, Config File, Quality Presets, Transforms
5. **Troubleshooting** - macOS Mounting, Database Errors, Transcoding
6. **Developer Guide** (collapsible) - Architecture, Development, Testing, libgpod, ADRs

### Landing Page Structure
- Hero with headline, install command, CTAs
- 5 feature cards: Smart Sync, High-Quality Transcoding, Full Metadata, Scriptable CLI, Multiple Sources
- Quick Start code snippet
- Supported Devices grid

### New Content Identified
- CLI Commands Reference (HIGH priority)
- Configuration File Reference (HIGH priority)
- FAQ (MEDIUM priority)

### Research Sources
Analyzed: beets.io, rclone.org, MusicBrainz Picard

**Status:** Awaiting review feedback before finalizing.

## Review Feedback (Sonnet Review)

### Confirmed Strengths
- One-liner excellent: "Sync your music collection to classic iPods, the way it should work."
- Navigation structure logical and well-organized
- Developer Guide as collapsible is smart
- Troubleshooting as dedicated section is excellent

### Accepted Improvements

**1. Revised Feature Grid:**
- Fast Incremental Sync (not "Smart Sync")
- Lossless Metadata & Artwork
- Scriptable & Automated
- High-Quality Transcoding
- Classic iPod Support (replaces "Multiple Sources")

**2. Add "Why podkit?" section** - comparison table vs Strawberry, gtkpod, iTunes

**3. Installation prominence** - elevate given macOS complexity

**4. Rename "Collection Sources" → "Music Sources"**

**5. Hero install command** - needs to acknowledge prerequisites

### Deferred/Minor
- Video sync visibility (address in TASK-090 content)
- Social proof elements (future, when available)

### Final Design Decisions
- Proceed with revised feature grid
- Add comparison section to landing page
- Platform-specific installation guidance
<!-- SECTION:NOTES:END -->
