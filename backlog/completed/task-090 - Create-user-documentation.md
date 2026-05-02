---
id: TASK-090
title: Create user documentation
status: Done
assignee: []
created_date: '2026-03-10 10:26'
updated_date: '2026-03-10 14:09'
labels:
  - docs-site
  - documentation
  - user-facing
milestone: Documentation Website v1
dependencies:
  - TASK-089
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write clear, user-friendly documentation for people using podkit to sync music to their iPods.

## Scope

1. **Installation guide**
   - System requirements (macOS, libgpod, FFmpeg)
   - Installation steps
   - Verification that it works

2. **Getting started**
   - First sync walkthrough
   - Basic concepts (collections, devices, sync)
   - Common workflows

3. **CLI reference**
   - All commands with examples
   - Global options
   - Configuration file format

4. **Guides**
   - Collections: filesystem and Subsonic sources
   - Transcoding: quality settings, what gets converted
   - Troubleshooting common issues

## Approach

This is a substantial content task. The developer should:
1. Review the information architecture from TASK-087
2. Audit existing content that can be adapted
3. Propose an outline and discuss before writing
4. Write documentation in digestible, modular sections
5. Include practical examples throughout
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Installation guide exists and is accurate
- [ ] #2 Getting started guide walks through first sync
- [ ] #3 CLI reference documents all commands
- [ ] #4 At least 2 additional guides (collections, transcoding)
<!-- AC:END -->
