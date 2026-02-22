---
id: TASK-005
title: Research libgpod binding approach
status: Done
assignee: []
created_date: '2026-02-22 19:08'
updated_date: '2026-02-22 21:00'
labels:
  - research
  - decision
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-004
references:
  - docs/adr/ADR-002-libgpod-binding.md
  - docs/LIBGPOD.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Validate the recommended binding approach from ADR-002 before committing to implementation.

**Spike goals:**
- Test ffi-napi with libgpod on macOS
- Assess complexity of GLib type handling (GList, GError)
- Evaluate memory management challenges
- Test basic operations: itdb_parse, itdb_write, itdb_track_new
- Document any blockers or concerns

**Decision needed:**
- Confirm ffi-napi for prototype phase, or pivot to alternative
- Update ADR-002 status to "Accepted" with findings

**Alternatives if ffi-napi problematic:**
- node-addon-api (N-API) directly
- Rust + napi-rs
- Different abstraction layer
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decision Summary\n\n**Chosen approach:** Option B - N-API (node-addon-api) directly\n\n**Why skip ffi-napi prototype:**\n1. GLib types (GList, GError) are painful with ffi-napi\n2. libgpod API is small (~20 functions) - not enough to justify throwaway code\n3. gtkpod/Strawberry source shows usage patterns\n4. N-API AsyncWorker provides proper async support\n\n**Architecture:**\n- Layer 1: Thin C++ (~300-500 lines) - wraps libgpod, handles GLib memory\n- Layer 2: Rich TypeScript API - Database, Track, Playlist classes with full types\n\nSee ADR-002 for full details.
<!-- SECTION:NOTES:END -->
