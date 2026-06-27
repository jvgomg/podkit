---
title: "ADR-022: The Sync Tag Is the Sole Quality Truth"
description: Remove the DB-bitrate + tolerance fallback from audio quality detection. The sync tag is the only authoritative record of what podkit encoded; untagged tracks are opted out and adopted only via an explicit, destructive flag.
sidebar:
  order: 23
---

# ADR-022: The Sync Tag Is the Sole Quality Truth

## Status

**Accepted** (2026-06-27)

Supersedes the "percentage-based preset change detection" portion of
[ADR-010](/developers/adr/adr-010-quality-preset-redesign) for **audio**. The
device-aware preset model, the sync-tag format, and the source-bound machinery
introduced by ADR-010 all stand. What changes is the fallback: ADR-010 said an
**untagged** track falls back to comparing the iPod database bitrate against the
target within a 10–30% tolerance band. That fallback is removed.

Implements the "sync-tag is authoritative; there is no DB-bitrate fallback" and
"untagged tracks must be opted out" decisions of the doc-051 PRD.

## Context

ADR-010 introduced sync tags — a `[podkit:v1 quality=… encoding=… bitrate=… codec=…]`
block in the track's comment field recording exactly what podkit encoded. When a
matched track carried a sync tag, detection was an exact comparison against the
current config. When it did **not** (a track synced before sync tags existed, or
one a third-party tool wrote), ADR-010 fell back to comparing the iPod database's
stored bitrate against the target, slackened by a percentage tolerance (VBR 30%,
CBR 10%, overridable via `bitrateTolerance`).

That fallback existed **only** because the iPod database bitrate is an unreliable
proxy for what podkit actually encoded:

- libgpod exposes **no CBR/VBR signal at all**. `Itdb_Track` has no VBR member;
  the on-disk `mhit` bitrate is a bare integer. There is no way to reconstruct an
  untagged track's true encoding mode without re-transcoding it.
- VBR bitrates spread ~30% around the nominal target, so the comparison needs a
  wide tolerance just to avoid phantom re-encodes — and a wide tolerance also
  *misses* real changes. The tolerance band was a property of the unreliable
  fallback path, never of the exact sync-tag path.

The fallback also created a concrete hazard. A user upgrading to bidirectional
lossy cap enforcement, with a library of untagged tracks, would have every
untagged track measured against the new target and flagged for re-encoding — a
re-encode storm on first sync, with no opt-out.

## Decision

**The sync tag is the only authoritative record of what podkit encoded. There is
no DB-bitrate fallback.**

- A matched track **with** a sync tag is compared exactly against the config
  (unchanged from ADR-010).
- A matched track **without** a sync tag (or whose tag carries no recorded
  bitrate) is **opted out** of the bitrate/encoding bound entirely: the
  classifier returns `null` for it. The iPod database bitrate is never consulted
  to guess. Format-observable preconditions that do not need the tag (the
  lossless/lossy boundary, and the ALAC format check on an ALAC-capable device)
  are unaffected — only the bitrate guess is removed.
- The legacy `bitrateTolerance` config knob loses its DB-fallback role. Per the
  project's no-deprecation policy it is **reinterpreted**, not orphaned: it now
  acts as the symmetric default for the source-bound lossy tolerances
  (`toleranceUp` / `toleranceDown` win when set; otherwise `bitrateTolerance`
  applies to both). With no tolerance configured the source-bound comparison is
  exact.

### Adoption: `--force-sync-tags-transcode`

Because an untagged track cannot be measured without re-transcoding it, there is
exactly **one** path that establishes ground truth for untagged tracks, and it is
explicit and destructive:

- `--force-sync-tags` (existing) writes sync tags **without** re-encoding —
  tag-only, non-destructive. It cannot recover an unknown encoding mode; it backs
  up tags for tracks podkit already produced.
- `--force-sync-tags-transcode` (new) **re-encodes** untagged matched tracks to
  the resolved device quality, then writes the authoritative sync tag. This is
  the only place where a missing sync tag triggers an expensive, destructive
  re-encode, and it is never automatic. When both flags are passed, the transcode
  flag wins for untagged tracks (no double-processing).

Once adopted, a track carries a sync tag with a recorded bitrate, so the next
ordinary sync sees it as tagged and the normal classifier owns it — a re-sync is
a no-op.

## Consequences

### Positive

- **No re-encode storm on upgrade.** A library of untagged tracks is left
  completely alone by an ordinary sync. The feature is opt-in to adopt, opt-out
  by default.
- **Honest detection.** Every audio quality decision is now driven by a number
  podkit itself wrote, not by an unreliable proxy. The comparison is exact and
  deterministic, so the tolerance band is unnecessary by default.
- **One clear adoption path.** The single expensive, destructive operation is
  named, explicit, and idempotent.

### Negative

- **Untagged tracks are invisible to bitrate/encoding policy until adopted.** A
  user who wants their pre-feature library brought into line must run
  `--force-sync-tags-transcode` once (a deliberate, destructive choice).
- **No partial adoption.** Writing a tag from the observed codec/DB-bitrate
  *without* re-encoding (with `encoding: unknown`) was considered and rejected as
  not worth the `unknown`-mode branching. Untagged means fully opted out.

### Video unaffected

Video preset-change detection still compares the device bitrate against the
target with a tolerance (`detectBitratePresetMismatch`); video carries no sync
tags and has a reliable container bitrate. This ADR is about **audio** quality
detection only.

## Related Decisions

- [ADR-009](/developers/adr/adr-009-self-healing-sync) — self-healing sync.
- [ADR-010](/developers/adr/adr-010-quality-preset-redesign) — quality preset
  redesign and sync tags (preset-change-detection-for-audio portion superseded
  here).
- doc-051 — Bidirectional quality-change PRD (the umbrella for this work).
