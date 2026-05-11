---
id: US-19
title: Estimation transparency
priority: P1
status: open
scope: in
theme: diagnostics-ux
last-updated: 2026-05-11
addressed-by:
  features: [estimation-accuracy]
  principles: [runtime-mismatches-not-config-errors]
  open-questions: []
  spikes: [file-size-estimation-accuracy]
---

# US-19 — Estimation transparency

> When estimates are uncertain, podkit should tell the user — not silently
> surprise them when a sync overflows.

## Detail

File-size estimation for transcoded files is imperfect. Rather than
presenting estimates as authoritative numbers and then failing when
reality differs, podkit should communicate the *confidence* of an
estimate to the user. "About 4.2GB, ±10%" is honest; "4.2GB" implies a
precision we don't have.

Particularly important in `--dry-run` output and pre-sync summaries.

## Acceptance signal

`podkit sync --dry-run` output includes confidence indicators:

```
Estimated payload: 4.2 GB (±10%)
Device free space:  4.5 GB
Headroom margin:    300 MB (likely fits; some risk of overshoot)
```

When the estimator has low confidence on a particular file class
(e.g., a format we haven't characterised), the diagnostic names it
specifically.

## Notes

Depends on the file-size estimation work. The spike should produce a
characterisation good enough to express confidence intervals
meaningfully.
