---
id: TASK-094
title: Add Starlight LLMs plugin
status: Done
assignee: []
created_date: '2026-03-10 10:26'
updated_date: '2026-03-10 14:09'
labels:
  - docs-site
  - ai
milestone: Documentation Website v1
dependencies:
  - TASK-088
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integrate the Starlight LLMs plugin to make documentation AI-friendly.

## Background

The Starlight LLMs plugin generates files that help LLMs understand and reference the documentation:
- `llms.txt` - Overview of documentation structure
- `llms-full.txt` - Complete documentation in a single file
- Per-page `.md` files optimized for LLM consumption

## Scope

1. **Install and configure the plugin**
   - Add `starlight-llms-txt` package
   - Configure in astro.config.mjs

2. **Verify output**
   - Check generated files are correct
   - Ensure they're included in build output

3. **Document the feature**
   - Brief note in developer docs about LLM-friendly documentation

## Reference

- Plugin: https://github.com/nicholasgubbins/starlight-llms-txt (or similar)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Starlight LLMs plugin installed and configured
- [ ] #2 llms.txt generated in build output
- [ ] #3 Plugin documented in developer docs
<!-- AC:END -->
