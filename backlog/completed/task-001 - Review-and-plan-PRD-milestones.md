---
id: TASK-001
title: Review and plan PRD milestones
status: Done
assignee: []
created_date: '2026-02-22 18:32'
updated_date: '2026-02-22 20:01'
labels: []
milestone: 'M0: Project Bootstrap'
dependencies: []
references:
  - docs/PRD.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Interactive planning session to review each PRD milestone (M1-M4) with the user before creating detailed implementation tasks.

This task should be worked on incrementally - an agent can complete one milestone review, update this task with notes, and leave remaining milestones for future sessions.

**Process for each milestone:**
1. Review the milestone scope in docs/PRD.md
2. Discuss with user: scope changes, priorities, concerns
3. Identify tasks needed for the milestone
4. Create tasks in backlog with user approval
5. Update this task's notes with decisions made

**Milestones to review:**
- [ ] M1: Foundation (v0.1.0) - libgpod bindings, basic CLI
- [ ] M2: Core Sync (v0.2.0) - Strawberry adapter, diff engine, transcoding
- [ ] M3: Production Ready (v1.0.0) - Artwork, quality presets, error handling
- [ ] M4: Extended Sources (v1.1.0) - beets adapter, directory scanning
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All four PRD milestones (M1-M4) have been reviewed with user
- [x] #2 Implementation tasks created for at least M1
- [x] #3 Any scope changes documented in task notes
- [x] #4 PRD.md updated if milestones changed significantly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## M1 Review - 2026-02-22

**Discussed with user. Key decisions:**

1. **Binding approach not yet decided** - ADR-002 is Proposed, not Accepted. Added TASK-005 to research and validate before implementation.

2. **CLI design** - User wants CLI UX designed upfront with stubbed commands. Use commander library, Bun runtime with Node APIs. Created TASK-006.

3. **Test environment** - Need sandboxed/simulated iPod for testing. User has physical iPod but prefers test environment. Created TASK-007 to research options.

4. **podkit-core in M1** - Added to establish codebase shape early (TASK-011).

5. **Labels for workflow** - Using `research` and `decision` labels to identify tasks needing user input and to show blocking relationships.

**M1 Tasks Created:**
- TASK-005: Research libgpod binding approach [research, decision]
- TASK-006: Design CLI UX and stub commands [decision]
- TASK-007: Research iPod test environment [research]
- TASK-008: Create libgpod-node package
- TASK-009: Implement read iPod tracks
- TASK-010: Implement write track to iPod
- TASK-011: Create podkit-core package structure
- TASK-012: Implement podkit status command

## M2 Review - 2026-02-22

**Key changes from PRD:**

1. **Dropped Strawberry adapter** - User no longer wants to focus on Strawberry
2. **Collection source decision needed** - Research beets CLI vs direct file reading (TASK-013)
3. **FFmpeg decision** - Finalize AAC encoder availability on mac/linux (TASK-014)
4. **Testing emphasis** - Extensive tests for metadata extraction, song matching, diff engine

**M2 Tasks Created:**
- TASK-013: Research collection source [research, decision]
- TASK-014: Research FFmpeg AAC encoder [research, decision]
- TASK-015: Implement collection adapter
- TASK-016: Implement metadata extraction with tests
- TASK-017: Implement song matching with tests
- TASK-018: Implement diff engine with tests
- TASK-019: Implement FFmpeg transcoding with tests
- TASK-020: Implement sync planner
- TASK-021: Implement sync executor
- TASK-022: Implement podkit sync command

## M3 Review - 2026-02-22

**Scope clarifications:**

1. **Artwork** - Only embedded artwork, no external files (cover.jpg)
2. **Error handling** - Skip failed tracks and continue, report summary at end
3. **Documentation** - Getting-started guide + LLM agent guide
4. **User testing** - End-to-end testing with real files/iPod before 1.0

**M3 Tasks Created:**
- TASK-023: Implement embedded artwork extraction
- TASK-024: Implement artwork resize/format conversion
- TASK-025: Implement artwork transfer to iPod
- TASK-026: Implement skip-and-continue error handling
- TASK-027: Write getting-started user guide
- TASK-028: Write getting-started-llms agent guide
- TASK-029: End-to-end user testing

## M4 Review - 2026-02-22

**Decision:** M4 is a container for future improvements. Scope depends on M2 decisions.

**Potential features:**
- Second collection adapter
- Query/filter support
- Playlist support
- Watch mode

**M4 Tasks Created:**
- TASK-030: Plan M4 features based on M2 decisions [decision]

## PRD Update - 2026-02-22

PRD shortened and updated:
- Removed detailed milestone checklists (now in backlog)
- Removed Strawberry references
- Removed detailed functional requirements (see ARCHITECTURE.md)
- Added reference to backlog for milestone/task tracking
- Simplified user stories
- Version updated to 1.1
<!-- SECTION:NOTES:END -->
