---
"podkit": minor
"@podkit/core": minor
---

Unify sync-engine error and warning handling (architecture sweep)

Settles error and warning responsibilities across the sync engine. Hard
failures throw typed errors that carry their own category; soft signals
flow through an injected `WarningSink` and surface alongside hard errors
in `SyncOutput.warnings`. `console.warn` / `console.error` is now banned
in core.

See `documents/architecture/sync/error-handling.md` for the full
responsibility model.

## Breaking API changes

### Types

- **`SyncWarning` and `ExecutionWarning` types removed.** Replaced by a
  single `Warning` type with `phase: 'plan' | 'execute'`. Track
  references are now structured (`WarningTrackRef = {artist, title, album?}`)
  rather than a mix of `CollectionTrack[]` and an inline object.

  ```ts
  // before
  import type { SyncWarning, ExecutionWarning } from '@podkit/core';
  // after
  import type { Warning, WarningPhase, WarningType, WarningTrackRef } from '@podkit/core';
  ```

- **`SyncPlan.warnings`** is now `Warning[]` (always `phase: 'plan'`).
- **`ExecuteResult.warnings`** is now `Warning[]` (always `phase: 'execute'`).
- **`CollectionAdapter.getPlanWarnings?()`** now returns `Warning[]`.

### New types

- **`Warning`, `WarningPhase`, `WarningType`, `WarningTrackRef`,
  `WarningSink`** — the unified warning surface.
- **`CategorizedSyncError`** — abstract base class for all typed sync
  errors. Subclasses declare `readonly category: ErrorCategory` so the
  pipeline's categorizer reads it off the class instead of inspecting
  the message body.
- **`DatabaseWriteError`** — wraps libgpod failures at the
  `IpodAdapter` boundary so iTunesDB errors categorize as `database`
  (no retry) rather than falling through to op-type fallback.
- **`PictureWriteError`**, **`MoveError`** — typed siblings of the
  existing `TagWriteError` / `SidecarWriteError`, now also extending
  `CategorizedSyncError`.

### `DeviceAdapter` contract

- New optional **`setWarningSink(sink: WarningSink): void`** method.
  Adapters that emit execute-phase warnings (`IpodAdapter`,
  `MassStorageAdapter`) must implement it. The pipeline injects its
  accumulator sink at execute start.

## Breaking CLI JSON output changes

The `sync` command's JSON output replaces the prior two warning fields
with a single unified array:

```diff
{
  "success": true,
- "planWarnings": [{ "type": "lossy-to-lossy", "message": "...", "trackCount": 2, "tracks": [...] }],
- "executionWarnings": [{ "type": "artwork", "track": "Artist - Title", "message": "..." }]
+ "warnings": [
+   {
+     "phase": "plan",
+     "type": "lossy-to-lossy",
+     "message": "...",
+     "trackCount": 2,
+     "tracks": [{"artist": "...", "title": "...", "album": "..."}]
+   },
+   {
+     "phase": "execute",
+     "type": "artwork",
+     "message": "...",
+     "trackCount": 1,
+     "tracks": [{"artist": "...", "title": "...", "album": "..."}]
+   }
+ ]
}
```

Filter by `warning.phase` to recover the prior split. Track refs
inside warnings are now structured objects rather than pre-formatted
strings — consumers can format them as they wish.

## Behaviour fixes

- **Execute-phase warnings now surface in `--json`.** The
  `executionWarnings` field was declared on `SyncOutput` but never
  populated by the CLI's real-run path — artwork extraction failures,
  iPod portable tag-write misses, and mass-storage vanished-relocate
  events were accumulated by the pipeline and silently dropped before
  reaching JSON. They now appear in the unified `warnings` array.
- **`IpodAdapter` mutators (`addTrack`, `updateTrack`, `removeTrack`)
  wrap libgpod failures in `DatabaseWriteError`.** Without the wrap,
  libgpod errors during these mutators would categorize as `copy` via
  the op-type fallback and retry once. iTunesDB failures now correctly
  categorize as `database` (no retry).
- **Mass-storage picture-write stage normalized to collect-and-aggregate.**
  Was `Promise.all` fail-fast with an untyped rejection; now
  `runWithConcurrency` + settled-all + `PictureWriteError` + map-cleared-
  before-throw, matching the tag-write stage convention.
- **CLI text-mode now prints an execute-phase warning summary** at the
  end of a real sync run (grouped by warning type; expand with `-v`).
  Previously these warnings were invisible to text-mode users.

## New text-mode CLI behaviour

A new `Warnings:` block appears in the sync summary when execute-phase
warnings landed during the run:

```
=== Summary ===

Synced 152 items successfully
Duration: 8m 14s

Warnings: 3
  artwork: 2
  tag-write: 1
  (re-run with -v for details)
```
