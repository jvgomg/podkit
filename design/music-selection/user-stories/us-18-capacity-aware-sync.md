---
id: US-18
title: Capacity-aware sync
priority: P0
status: open
scope: in
theme: selection-fundamentals
last-updated: 2026-05-11
addressed-by:
  features: [selector-pipeline, estimation-accuracy]
  principles: []
  open-questions: [pinned-set-exceeds-capacity]
  spikes: [file-size-estimation-accuracy]
---

# US-18 — Capacity-aware sync

> The sync should fit within the device's capacity, the first time,
> without manual intervention or repeated retries.

## Detail

Currently podkit can sync until the device fills mid-run, leaving the
user with a partially-populated and potentially corrupt state. The
selector should compute a plan that fits the device's free space *before*
starting, and execute that plan with confidence that it will fit.

This requires:
- Reliable file-size estimation (gated by the
  [estimation-accuracy spike](../spikes/file-size-estimation-accuracy.md)).
- A capacity-fit stage in the selector pipeline.
- Clear policy for over-budget cases (see
  [open question](../open-questions/pinned-set-exceeds-capacity.md)).

## Acceptance signal

`podkit sync -d terapod` on a device with 5GB free, given a sync set
that would otherwise be 6GB, produces a coherent 5GB sync (or close, with
known headroom) and reports the trimming decisions clearly. No mid-sync
"device full" errors.

## Notes

Foundational story — half the user complaints about podkit selection
trace back to this.
