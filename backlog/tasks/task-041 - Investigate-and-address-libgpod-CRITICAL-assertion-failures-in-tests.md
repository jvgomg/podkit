---
id: TASK-041
title: Investigate and address libgpod CRITICAL assertion failures in tests
status: To Do
assignee: []
created_date: '2026-02-25 12:21'
labels:
  - libgpod
  - testing
  - investigation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During test runs of `@podkit/libgpod-node`, GLib CRITICAL assertion failures are logged to stderr even though all tests pass. This suggests we may be using libgpod incorrectly - potentially missing required initialization steps or calling APIs in the wrong order.

## Observed Errors

```
CRITICAL: itdb_playlist_mpl: assertion 'pl' failed
CRITICAL: prepare_itdb_for_write: assertion 'mpl' failed
CRITICAL: mk_mhla: assertion 'fexp->albums' failed
CRITICAL: mk_mhli: assertion 'fexp->artists' failed
CRITICAL: itdb_chapterdata_free: assertion 'chapterdata' failed
```

## Context

- GLib CRITICAL errors are non-fatal by default (log and continue)
- Functions return NULL/early when assertions fail
- Tests pass because the code handles NULL returns gracefully
- However, this may indicate improper library usage

## Concerns

1. **Missing initialization**: libgpod may require creating certain structures (master playlist, albums list, artists list) before other operations
2. **Wrong API call order**: We may be calling write/export APIs before the database is properly set up
3. **Cleanup issues**: `itdb_chapterdata_free` assertion suggests we're freeing NULL or already-freed data
4. **Silent failures**: Operations may be silently failing and we're not detecting it
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Identify which specific test scenarios trigger each CRITICAL error
- [ ] #2 Understand what libgpod expects (required initialization, API call order)
- [ ] #3 Determine if current behavior causes actual bugs or just noise
- [ ] #4 Fix improper library usage if found
- [ ] #5 Tests run without CRITICAL errors (or document why they're acceptable)
<!-- AC:END -->
