---
id: TASK-108
title: Update docs site with Homebrew installation guide
status: To Do
assignee: []
created_date: '2026-03-11 14:18'
updated_date: '2026-03-11 14:21'
labels:
  - docs
milestone: Homebrew Distribution
dependencies:
  - TASK-106
references:
  - docs/getting-started/
  - docs/index.md
  - docs/developers/development.md
  - docs/reference/
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Update the documentation site so that Homebrew is the primary recommended installation method. Users visiting the docs should immediately see how to install podkit and get started.

## Context

Currently the docs describe building from source as the only install path. With Homebrew distribution in place, the getting-started experience changes fundamentally. The docs need to reflect this and also provide fallback instructions for manual binary download.

## Changes Required

### 1. Update `docs/getting-started/installation.md` (or create if it doesn't exist)

Primary content:

**macOS (Homebrew):**
```bash
brew install jvgomg/podkit/podkit
```

**Linux (Homebrew):**
```bash
brew install jvgomg/podkit/podkit
```

**Manual download (any platform):**
- Link to GitHub Releases page
- Instructions for downloading the correct tarball, extracting, and adding to PATH

**Prerequisites:**
- FFmpeg is required for transcoding (`brew install ffmpeg` or system package manager)
- Note that podkit's Homebrew formula depends on FFmpeg so it's installed automatically

### 2. Update `docs/getting-started/quick-start.md`

Remove or reduce any "build from source" content from the getting-started flow. The quick start should assume the user installed via Homebrew.

### 3. Update `docs/index.md` (landing/intro page)

Add a prominent installation snippet near the top.

### 4. Keep `docs/developers/development.md` as-is

The "Building from Source" section and "Building a Standalone Binary" section remain for contributors. These are developer docs, not user docs.

### 5. Add changelog/releases page

Create `docs/reference/changelog.md` or similar that:
- Links to GitHub Releases for the full changelog
- Optionally embeds or summarizes recent releases
- Explains the versioning scheme (independent package versions, CLI version is what users track)

### 6. Update any other references

Search docs for mentions of building from source, npm install, or manual setup that should now point to Homebrew.

## Notes

- All new/modified docs must have Starlight-compatible frontmatter (title, description, sidebar order)
- Keep the tone user-friendly — someone discovering podkit for the first time should be able to install and run their first sync in under 5 minutes
- The manual download section is important for users who can't or don't want to use Homebrew
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Installation page exists with Homebrew as the primary install method for macOS and Linux
- [ ] #2 Both install forms are documented: `brew tap jvgomg/podkit && brew install podkit` and shorthand `brew install jvgomg/podkit/podkit`
- [ ] #3 Manual binary download instructions link to GitHub Releases as a fallback
- [ ] #4 FFmpeg prerequisite is documented (and noted as automatic via Homebrew dependency)
- [ ] #5 Quick start guide assumes Homebrew installation, not building from source
- [ ] #6 Landing page includes a visible install snippet
- [ ] #7 Changelog/releases page exists linking to GitHub Releases
- [ ] #8 All docs have valid Starlight frontmatter (title, description, sidebar order)
- [ ] #9 No broken links or references to outdated install methods in user-facing docs
<!-- AC:END -->
