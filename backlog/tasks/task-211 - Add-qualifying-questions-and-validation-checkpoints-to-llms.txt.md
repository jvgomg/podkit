---
id: TASK-211
title: Add qualifying questions and validation checkpoints to llms.txt
status: To Do
assignee: []
created_date: '2026-03-23 15:01'
labels:
  - docs
  - llm
  - ux
dependencies: []
references:
  - TASK-028
  - packages/docs-site/src/llms-txt.ts
  - docs/getting-started/quick-start.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve the AI agent experience by adding two small pieces of guidance to the docs:

## 1. Qualifying questions in llms.txt

Add a "Before helping a user" block to the `llms.txt` `details` field (in `llms-txt.ts`) that prompts agents to ask upfront branching questions:

- **Platform:** macOS/Linux = proceed; Windows = unsupported, point to roadmap
- **Music source:** Local directory or Navidrome/Subsonic server? (changes setup path significantly)
- **iPod model:** Confirm it's a classic/nano/mini/shuffle (not iPod Touch/iPhone/iPad)
- **Intent:** New install or troubleshooting existing setup? (maps to different doc sets)

This is ~10 lines in the details field. It prevents agents from walking users down wrong paths (e.g. Windows users, or guiding a Navidrome user through local-directory setup).

## 2. Expected output notes in quick-start

Add brief "Expected output" or "Verification" callouts to each step in the quick-start docs so agents (and humans) know what success looks like before proceeding to the next step. For example, after `podkit --version`, note the expected format; after `podkit device scan`, note what a successful detection looks like.

**Context:** Follow-up from TASK-028. The llms.txt plugin satisfies the original agent guide goal, but these two additions would close the remaining gaps identified during review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 llms.txt details field includes qualifying questions block that prompts agents to ask about platform, music source, iPod model, and intent
- [ ] #2 Quick-start doc steps include brief expected output or verification notes
- [ ] #3 Changes benefit both AI agents and human readers
<!-- AC:END -->
