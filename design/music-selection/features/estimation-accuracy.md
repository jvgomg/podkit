---
slug: estimation-accuracy
title: File-size estimation accuracy
tier: 0
status: not-drafted
last-updated: 2026-05-11
user-stories-addressed: [US-18, US-19]
depends-on:
  features: []
depended-on-by-features: []
gated-by:
  open-questions: []
informed-by-spikes: [file-size-estimation-accuracy]
---

# File-size estimation accuracy

> **Status: not drafted.** Reserves the feature slug. The sub-PRD lands
> after the
> [estimation spike](../spikes/file-size-estimation-accuracy.md) has
> produced findings.

## Scope (at a glance)

Improve podkit's file-size estimation for transcoded outputs so that
capacity-fit can be reliable. Likely components:

- Better estimation model (tuned per source format / target codec).
- Pre-transcode cache (transcode once, hash, reuse).
- Confidence intervals exposed in CLI output (US-19).
- Calibration over time (recording actual vs estimate to feed back into
  the model).

The shape and emphasis depend on what the spike finds.

## Why this is Tier 0

Capacity-fit (selector pipeline) is dishonest without it. Today's user
experience around "device fills mid-sync" is largely an estimation
problem.

## Notes for the eventual draft

- This sub-PRD shapes around the spike findings — what's broken, what's
  fixable, what's worth fixing.
- Pre-transcode cache may warrant its own sub-PRD if it grows beyond a
  caching tweak.
- Confidence interval UX touches the diagnostics vocabulary spec when
  that exists.
