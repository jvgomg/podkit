---
title: 'principles: library safety'
description: The codec-agnostic promises podkit makes about how it treats a user's files and data — never silently degrade, settings are ceilings, no surprise re-encodes, destructive actions are explicit, visible-not-silent, idempotent, the source is truth.
sidebar:
  order: 1
---

The promises podkit makes about how it treats your library — independent of
any codec, device, or transfer mode. Each is a constraint on every feature:
if a change would break one of these, the change is wrong, not the principle.

---

## 1. Never silently degrade; never grow a file

podkit does not perform a **cosmetic** lossy→lossy re-encode. Every re-encode
of an already-lossy file either **shrinks** it (a deliberate, opted-in
reduction) or is a **forced necessity** (the device cannot play the source
codec at all). A re-encode that would leave the file the same size, or larger,
for no quality gain, is never performed.

*Requires:* a reduction must land strictly below a source that exceeds the cap
(see [transcoding](./transcoding.md)); a CBR↔VBR mode flip never re-encodes a
lossy-source track (it could grow the file and stacks loss). *Enforced by*
[ADR-023](../../adr/adr-023-lossy-reduction-down-only.md).

## 2. Your settings are ceilings and mean what they say

A quality preset is an upper bound that podkit never silently exceeds. `quality=low`
caps quality even when another setting (e.g. a fidelity-leaning transfer mode)
would otherwise push higher. The user who wants higher quality raises the
setting; podkit does not second-guess it upward.

*Enforced by* [ADR-023](../../adr/adr-023-lossy-reduction-down-only.md) (the
cap bounds every target, including a `preserve` forced transcode).

## 3. Honor the original where the device can play it

The default for a source the device plays natively is to **copy it untouched** —
original codec, original bitrate, original bytes. podkit re-encodes a
playable file only when the user explicitly opts in (a reduction) or when the
device leaves no choice (an incompatible codec).

*Enforced by* [ADR-010](../../adr/adr-010-quality-preset-redesign.md) (compatible
lossy → copy) and [ADR-023](../../adr/adr-023-lossy-reduction-down-only.md)
(`preserve` is the default in `fast`/`portable`).

## 4. No surprise re-encodes

podkit never re-encodes a lossy track **up** in bitrate, and never crosses
codecs, without the user asking. Quality moves are **down-only**; a louder,
bigger, or differently-encoded file never appears because podkit decided it
should.

*Enforced by* [ADR-023](../../adr/adr-023-lossy-reduction-down-only.md).

## 5. Expensive or destructive actions are explicit, named, and never automatic

Any operation that re-encodes audio (lossy reduction), or that overwrites
ground truth podkit cannot recover, is reached through a named opt-in — a
config value the user set or a `--force-*` flag — never as a silent side
effect of an ordinary sync.

*Enforced by* [ADR-022](../../adr/adr-022-sync-tag-sole-quality-truth.md)
(`--force-sync-tags-transcode` adoption) and
[ADR-023](../../adr/adr-023-lossy-reduction-down-only.md) (`[bitrate].reduce`,
`--force-transcode`).

## 6. Visible, not silent: report what we will not do for you

When podkit declines to act — because a policy suppresses it, or because the
safe choice is to leave a file alone — it **reports** the situation rather than
hiding it. The user always sees the gap between what is on the device and what
the config would imply, and is told the explicit path to close it.

*Examples:* a source that has degraded below the device copy is reported, not
re-encoded down; a track sitting below a *raised* cap is reported with
`--force-transcode` as the lift. *Enforced via* the report-only channel
(`documents/architecture/sync/upgrades.md`).

## 7. Idempotent: syncing twice changes nothing

Running sync again with no source change produces no work on the second run.
Every decision is computed from deterministic inputs (the source file, the
recorded sync tag) so the same inputs always yield the same plan — no churn,
no oscillation, no re-encode chase.

*Enforced by* [ADR-010](../../adr/adr-010-quality-preset-redesign.md) (sync
tags) and the shared add/re-sync decision seam in
[ADR-023](../../adr/adr-023-lossy-reduction-down-only.md).

## 8. The source file is truth; podkit does not guess from the device

podkit's record of what it encoded is its own **sync tag**, written into the
track. It does not infer quality from the device database's bitrate, which is
an unreliable proxy (no CBR/VBR signal). A track podkit never wrote is **opted
out** of quality policy until the user explicitly adopts it — podkit never
guesses and acts.

*Enforced by* [ADR-022](../../adr/adr-022-sync-tag-sole-quality-truth.md).

## 9. Defaults follow evident intent

Where a setting has a natural lean, its default is derived from the user's
evident goal rather than a neutral constant. Choosing a space-optimising
transfer mode, for instance, defaults the reduction axis toward shrinking;
choosing a fidelity-leaning mode defaults it toward preservation. The user can
always override; the default just starts where intent points.

*Enforced by* [ADR-023](../../adr/adr-023-lossy-reduction-down-only.md)
(`[bitrate].reduce = auto` follows the transfer mode) — see
[transfer-modes](./transfer-modes.md).

## 10. Config is powerful but layered and clean-breaking

Configuration cascades global → per-device → CLI, with sensible defaults and
explicit overrides at every level. When a knob's meaning changes, podkit makes
a **clean break** (a renamed/replaced option, a minor version bump) rather than
running a deprecation cycle — the surface stays honest about what it does
today.
