---
id: TASK-043
title: Design iPod database abstraction layer in podkit-core
status: To Do
assignee: []
created_date: '2026-02-25 18:26'
labels:
  - podkit-core
  - architecture
  - api-design
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Design a clean API in `@podkit/core` that abstracts iPod database operations, so consumers like `podkit-cli` don't need to depend directly on `@podkit/libgpod-node`.

## Background

Currently, the CLI directly imports and uses `@podkit/libgpod-node`:
- `sync.ts` - opens database, gets tracks, passes to executor
- `status.ts` - opens database, gets device info
- `list.ts` - opens database, lists tracks

This creates tight coupling and exposes low-level details (like `TrackHandle`) to consumers. When libgpod-node's API changes (as with TASK-042), all consumers break.

The intended architecture should be:
```
CLI → podkit-core → libgpod-node
```

Not:
```
CLI → podkit-core
CLI → libgpod-node (bypassing core)
```

## Tasks

1. **Understand current usage** - Review how the CLI currently uses libgpod-node
2. **Understand podkit-core's goals** - Review ARCHITECTURE.md and existing abstractions
3. **Design the API** - Propose an interface for iPod operations in podkit-core
4. **Discuss with user** - Present examples, discuss trade-offs, iterate on design
5. **Write spec** - Document the agreed design as a specification

## Key Questions to Answer

- What operations does the CLI need? (open, list tracks, get device info, sync)
- Should we create an `IpodDatabase` class or functional API?
- How should `IPodTrack` relate to `Track`/`TrackHandle` from libgpod-node?
- Should the executor interface change?
- What types should podkit-core export vs hide?

## Output

A specification document (attached to the implementation task) that covers:
- New types and interfaces
- API design with examples
- Migration path for CLI
- What libgpod-node details remain hidden
<!-- SECTION:DESCRIPTION:END -->
