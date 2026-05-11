---
status: tentative
last-updated: 2026-05-11
links:
  - source-capabilities.md
  - track-identity-foundation.md
---

# Mismatches are runtime warnings, not config-time errors

> **Principle.** When a collection asks for something that the active
> source or its data cannot supply (a missing playlist, a track that doesn't
> match anything in the source), the failure is reported at sync time as a
> warning with clear diagnostics — not as a config-validation error. The
> sync proceeds with what it can produce.

## Why

Several mismatches are *expected* in normal operation:

- A playlist is renamed in Subsonic; the next sync can't find it under the
  old name.
- A track in a curated playlist has been deleted from the source.
- A user swaps source via CLI, and the new source doesn't have all the
  tracks the previous one did.
- A file referenced by an M3U has been moved or deleted.

If we treat these as config-validation errors, the sync fails entirely and
the user has to fix tooling problems before they can sync at all. That's
hostile to "I just want my music on my iPod" and it punishes the user for
data drift outside their control.

If we treat them as runtime warnings, the sync does what it can and tells
the user what it skipped. The user can act on the diagnostics on their
schedule.

## What the principle implies

- The default for any "expected data" missing or mismatched is: skip,
  warn, continue.
- Diagnostics name the *cause* (not just the symptom) and point at how the
  user can investigate or fix.
- A `--strict` or per-collection `strict = true` option exists for users
  who want a hard fail (e.g., a CI sync that should refuse to drift).
- True config errors (malformed TOML, undeclared collection name, capability
  mismatches that prevent any meaningful work) remain hard errors — the
  principle is about *data* mismatches, not *structural* ones.

## What the principle does not say

- It does not say validation is unimportant. A `podkit doctor`-style
  pre-flight check can surface likely problems before sync and is encouraged
  — it's just additive, not gating.
- It does not say warnings are silent. The CLI should surface them
  prominently in the sync summary; daemon mode should propagate them as
  notifications.
- It does not say the sync proceeds *infinitely*. A sync where >N% of
  expected items are missing should probably abort with a clearer
  "something is wrong" — heuristic threshold to be set per feature.

## Discussion / origin

Emerged from the playlist source/identity discussion. The user's framing
when sketching cross-source: *"obviously there could be a runtime issue if
a playlist is available in one source but not another."* The natural
extension was that all such "available in some configurations, not others"
mismatches should be runtime concerns, not config concerns.

## Concrete diagnostic shapes

```
Warning: Collection 'commute' references playlist 'Commute Mix', but
source 'local-music' has no matching playlist (looked in
/Volumes/Music/playlists/). Skipping playlist resolution.

  Try: podkit collection list-playlists --source local-music
  Or:  podkit sync -d terapod --playlist-source navidrome
```

```
Warning: Playlist 'Workout Mix' references 23 tracks; 4 not found in
active source 'local-music' (best-effort tag matching).

  Run with --explain-playlist=workout-mix for the per-track breakdown.
```

The diagnostic *and* the suggested next action are both required. A bare
warning without an action loop is hostile.
