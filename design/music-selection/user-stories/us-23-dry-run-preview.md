---
id: US-23
title: Dry-run preview
priority: P1
status: open
scope: in
theme: diagnostics-ux
last-updated: 2026-05-11
addressed-by:
  features: [selector-pipeline]
  principles: []
  open-questions: []
  spikes: []
---

# US-23 — Dry-run preview

> Before syncing, see what would be added, removed, and kept, so I can
> sanity-check the plan.

## Detail

Today's `--dry-run` exists but its output is limited. With the new
selection model, users will be making more nuanced decisions and the
sync plan can be non-obvious (pinned playlists, capacity-fit decisions,
OTG protection). A real preview lets the user inspect the plan and
build trust before committing.

## Acceptance signal

`podkit sync --dry-run -d terapod` produces:

```
Plan for terapod (5GB free):
  + Add:     142 tracks (3.8 GB est.)
  - Remove:  18 tracks  (480 MB)
  = Keep:    302 tracks (1.0 GB)
  ⚠ Protect: 4 tracks (in OTG playlist, retained)

Top adds:
  - Workout Mix (12 tracks, 86 MB)
  - Road Trip (24 tracks, 192 MB)
  - Pool fill: 106 tracks from "Terapod" pool

Diagnostics:
  - Skipped playlist "Sleep Sounds" (referenced but not found in source)
```

`--dry-run --verbose` exposes per-track decisions.

## Notes

The dry-run output is the user's primary trust-building surface. It
should be rich enough to answer "why is this getting synced?" and
"why isn't this?" without leaving the CLI.
