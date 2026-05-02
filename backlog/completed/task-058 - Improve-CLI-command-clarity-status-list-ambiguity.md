---
id: TASK-058
title: Improve CLI command clarity (status/list ambiguity)
status: Done
assignee: []
created_date: '2026-02-26 11:37'
updated_date: '2026-03-09 15:15'
labels:
  - ux
  - cli
  - e2e-finding
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**UX issues found in E2E testing (TASK-029)**

Current commands are ambiguous about what they operate on:
- `podkit status` - unclear it shows iPod status
- `podkit list` - unclear what it's listing (iPod vs local)

**Options to consider:**

1. **Subcommand approach:**
   ```
   podkit ipod status
   podkit ipod list
   podkit local list
   podkit sync  # syncs local → ipod
   ```

2. **Flag approach:**
   ```
   podkit list --ipod (default)
   podkit list --local
   podkit status  # always iPod
   ```

3. **Clearer output headers:**
   Keep commands as-is but add clear headers:
   ```
   === iPod Status ===
   === iPod Tracks ===
   === Local Collection ===
   ```

**Recommendation:** Option 1 or 3. Discuss with user before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Commands clearly indicate what they operate on
- [ ] #2 User knows if viewing iPod or local collection
- [ ] #3 Consistent mental model across commands
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Decision Summary

Resolved CLI command clarity issues through a comprehensive restructuring discussion. The key insight was that the scope extends beyond just iPod tracks - we need to handle music, video, and potentially photos across both devices and collections.

### Chosen Approach: Entity-centric with content subcommands

**Core Principle:** Commands are structured as `<entity> <content-type> [name]` where:
- Entity = `device` (what's ON the iPod) or `collection` (what's IN the source)
- Content-type = `music`, `video`, (future: `photo`)
- Name = optional, uses default from config if omitted

### Key Decisions

1. **Use `music`/`video` not `tracks`** - More intuitive, matches config structure

2. **Positional `[name]` argument** - Since context is already established by parent command:
   - `podkit device music terapod` not `podkit device music -d terapod`
   - `podkit collection music mylib` not `podkit collection music -c mylib`

3. **Merge `device show` + `device status` → `device info`** - Single command shows config info plus live status when mounted

4. **Move `clear` and `reset` under `device`** - They operate on devices

5. **Root shortcuts for common operations** - `eject`, `mount`, `init` available both at root and under `device`

6. **No deprecation period** - Alpha software with no users, clean break

### New Task Created

TASK-070 contains the full implementation specification.
<!-- SECTION:FINAL_SUMMARY:END -->
