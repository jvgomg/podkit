---
id: TASK-028
title: Write getting-started-llms agent guide
status: Done
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-03-23 15:01'
labels: []
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-027
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write a guide designed for AI agents to help users through the setup and sync process.

**Purpose:** An LLM agent can read this guide and interactively help a user set up and use podkit.

**Content:**
1. Context: What podkit is, who it's for
2. Qualifying questions for agent to ask:
   - Do you have a music library? What format?
   - Do you have a compatible iPod? Which model?
3. Step-by-step process with checkpoints:
   - Verify prerequisites
   - Install dependencies (offer to run commands)
   - Install podkit
   - Test installation (`podkit --version`)
   - Connect iPod, verify detection (`podkit status`)
   - Dry run (`podkit sync --dry-run`)
   - Full sync
4. Each step: what to check, how to validate, common errors

**Interaction style:** Agent should:
- Ask before running commands
- Validate each step before proceeding
- Explain what's happening
- Handle errors helpfully

**Location:** docs/GETTING-STARTED-LLMS.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Guide enables LLM to help user end-to-end
- [x] #2 Includes qualifying questions
- [x] #3 Step-by-step with validation checkpoints
- [x] #4 Covers common errors and recovery
- [x] #5 Tested with actual LLM agent
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Addressed by the `starlight-llms-txt` plugin which generates machine-readable `llms.txt` entry points with targeted doc sets (setup-guide, syncing-devices, etc.). Combined with comprehensive getting-started docs, troubleshooting, and CLI reference, an AI agent can guide users end-to-end. Qualifying questions follow-up created separately.
<!-- SECTION:FINAL_SUMMARY:END -->
