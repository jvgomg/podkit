---
id: TASK-043
title: Design iPod database abstraction layer in podkit-core
status: Done
assignee: []
created_date: '2026-02-25 18:26'
updated_date: '2026-02-25 21:21'
labels:
  - podkit-core
  - architecture
  - api-design
dependencies: []
references:
  - doc-001
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Researched current CLI usage of libgpod-node
- [x] #2 Researched podkit-core's current exports and architecture
- [x] #3 Designed IpodDatabase API with fluent track/playlist operations
- [x] #4 Discussed design decisions with user and iterated
- [x] #5 Created specification document (doc-001)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Designed a clean `IpodDatabase` API for `@podkit/core` that abstracts iPod database operations, decoupling CLI from direct `@podkit/libgpod-node` dependency.

## Key Design Decisions

1. **Track objects as references** - `IPodTrack` objects serve as both data snapshots and references for operations (no exposed IDs/handles)

2. **Fluent methods on objects** - Tracks and playlists have methods like `track.update()`, `track.remove()`, `playlist.addTrack()` that return new snapshots

3. **Immutable snapshots** - All operations return new object instances; original objects remain unchanged

4. **Warning on save** - `save()` returns warnings for tracks without audio files rather than throwing

5. **Custom error types** - `IpodError` with typed error codes instead of exposing `LibgpodError`

## Deliverable

Specification document: **doc-001 - iPod Database Abstraction Layer Specification**

Covers:
- Complete type definitions (TrackInput, TrackFields, IPodTrack, IpodPlaylist, etc.)
- IpodDatabase class API
- Usage examples for all CLI commands
- Executor integration approach
- Internal implementation notes
- Migration path for CLI

## Next Steps

Create implementation task to build `IpodDatabase` in `@podkit/core` following this spec.
<!-- SECTION:FINAL_SUMMARY:END -->
