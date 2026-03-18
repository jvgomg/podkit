---
name: prd-to-tasks
description: Break a PRD into independently-grabbable Backlog tasks using tracer-bullet vertical slices. Use when user wants to convert a PRD to tasks, create implementation tickets, or break down a PRD into work items.
---

# PRD to Tasks

Break a PRD into independently-grabbable Backlog tasks using vertical slices (tracer bullets).

## Process

### 1. Locate the PRD

Ask the user for the PRD — it may be a Backlog document, a file in the repo, or pasted inline.

If the PRD is a Backlog document, fetch it with `document_view`. If it's a file, read it from disk.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Draft vertical slices

Break the PRD into **tracer bullet** tasks. Each task is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories from the PRD this addresses

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Create the Backlog tasks

For each approved slice, create a task using `task_create` (consult `get_task_creation_guide` for structure). Create tasks in dependency order (blockers first) so you can reference them in later tasks.

Each task should include:

- **Title**: the slice title
- **Description**: a concise description of the end-to-end behavior (not layer-by-layer implementation). Reference the parent PRD document rather than duplicating content.
- **Acceptance criteria**: checkable criteria for completion
- **Dependencies**: note which other tasks must complete first, or "None - can start immediately"
- **Context**: which user stories from the PRD this addresses

If the PRD is a Backlog document, link back to it in each task's description. Do NOT modify the parent PRD document.
