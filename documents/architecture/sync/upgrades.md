---
title: 'sync: upgrades'
description: How podkit detects when a track already on the device should be re-transferred — the unified quality classifier, the three-bound model, and the bitrate baseline that keeps the device-bound precise.
sidebar:
  order: 23
---

How the sync engine decides that a track already on the device should be
re-transferred from the source — the unified quality classifier
(`classifyQualityChange`) and the bitrate baseline that the device-bound
depends on.

This doc covers detection only. See
[`planning.md`](./planning.md) for how the detected upgrade is turned
into an operation in the plan, and
[`error-handling.md`](./error-handling.md) for the channels through which
upgrade-time failures propagate.

---

## 1. The unified quality classifier

`classifyQualityChange` (and its two exported bounds `classifySourceBound` /
`classifyDeviceBound`) in
`packages/podkit-core/src/sync/engine/upgrades.ts` is the single entry-point
for all music quality decisions. It returns a `QualityChange` object or `null`
(in-sync / no action needed).

### Vocabulary (`QualityChangeReason`)

| Reason | Fires when | Direction |
|---|---|---|
| `lossless-boundary` | The track crosses the lossless/lossy boundary: source is lossless AND device copy is lossy (`up`, source bound), OR device copy is lossless AND the target is now a lossy preset (`down`, device bound). A precondition — re-encodes regardless of bitrate policy | `up` / `down` |
| `source-improved` | Same-family lossy source whose bitrate significantly exceeds the device copy (64 kbps absolute OR 1.5× relative) | `up` |
| `cap-up` | Device's recorded encoding sits below the effective target — re-encode up | `up` |
| `cap-down` | Device's recorded encoding sits above the cap AND the source can supply the cap — re-encode down | `down` |
| `source-down-suppressed` | Source has degraded below the cap — the device copy is better than the source can produce; by default keep it and report (`reEncodes: false`), unless `match-all` opts in to following it down | `down` |
| `encoding-mismatch` | Device's recorded encoding mode (CBR/VBR) differs from the target — a precondition that re-encodes for correctness regardless of bitrate policy. Fires on both the lossless sync-tag-exact path and the lossy cap path (the latter only for tracks podkit transcoded, which carry a recorded encoding) | `format-only` (pure flip) / `up` / `down` (when a tier move coincides) |
| `format-mismatch` | _(reserved — not yet produced)_ Codec correctness precondition | `format-only` |

The `QualityChange` object also carries: `direction`, `reEncodes` (whether the
change re-encodes the file — set by the **policy gate**, see §1a), `targetBitrate`,
and optional `encodedBitrate`, `sourceBitrate`, `fromLossless`, `toLossless`.

All of this feeds the `quality-change` update reason and the `qualityChanges[]`
JSON array in the sync output.

### The three-bound model

The classifier compares the device's **recorded encoded quality** against the
**target** and against the **source** as separate, independent bounds — never
collapsed to `min(source, target)`. Collapsing would make a source drop
indistinguishable from a cap drop, which must be treated oppositely (cap-down
re-encodes; source-down suppresses). The two bounds are:

**Bound 1 — source-vs-device (`classifySourceBound`):** Upgrade-only.
A much-improved source is followed up whether or not the user touched their cap.

**Bound 2 — device-vs-target (`classifyDeviceBound`):** The authoritative
`encoded` value is the device's sync tag, and nothing else. The sync tag is the
**sole quality truth** — the only record of what podkit actually encoded. A
track with no sync tag at all is **opted out**: this bound returns `null`. (A
sync tag that records the quality tier and encoding but omits the bitrate is
still authoritative on the lossless path — the exact comparison can detect an
encoding-mode flip from it; only the lossy bound additionally needs a recorded
bitrate and opts out without one.) There is no device-DB-bitrate fallback — the
DB bitrate is an unreliable proxy (libgpod exposes no CBR/VBR signal), so podkit
never guesses from it. Adopting an untagged track is an explicit, destructive
opt-in via `--force-sync-tags-transcode` (see §4). The format-observable
preconditions that do not need the tag (the lossless/lossy boundary and the ALAC
format check) still fire for untagged tracks; only the bitrate guess is gone.
See [ADR-022](../../../adr/adr-022-sync-tag-sole-quality-truth.md).

`classifyQualityChange` runs Bound 1 first; Bound 2 only fires when Bound 1
returns null.

---

## 1a. The policy gate

What a bound *detects* (the reason) is kept separate from whether the sync is
*allowed to act on it* (the policy). `applyBitrateSyncPolicy(direction, reason,
mode)` is a pure mapping from `(QualityChangeDirection, QualityChangeReason,
BitrateSyncMode)` to `'fire' | 'suppress-log'`, tested exhaustively in
`bitrate-sync-policy.test.ts`. Each bound computes its natural change, then
`gateChange` sets `reEncodes = applyBitrateSyncPolicy(...) === 'fire'`. A
suppressed change is still **returned** (so it can be reported and counted) —
only `reEncodes` flips to `false`.

The five `BitrateSyncMode` values map per direction:

| Mode | up (`cap-up` / `source-improved`) | down (`cap-down`) | source-down (`source-down-suppressed`) |
|---|---|---|---|
| `match-cap` (default) | fire | fire | suppress-log |
| `match-all` | fire | fire | **fire** (follow the source down) |
| `up-only` | fire | suppress-log | suppress-log |
| `down-only` | suppress-log | fire | suppress-log |
| `off` | suppress-log | suppress-log | suppress-log |

**Precondition classes bypass the gate and always fire:** `encoding-mismatch`,
`lossless-boundary`, and `format-mismatch` are correctness (codec / encoding mode
/ lossless boundary), not bitrate preference, so they re-encode even under `off`.

The policy is resolved per device (`[bitrate].sync`, default `match-cap`),
cascading device → global → default, and is overridable per run with
`--bitrate-sync`. It threads into `classifyQualityChange` / `classifyDeviceBound`
/ `classifySourceBound` as an optional `policy` field that defaults to
`match-cap`, so callers that omit it get the documented default behaviour.

### Policy ladder (master veto preserved)

```
skipUpgrades (additive-only)  → never replace a file, even for preconditions
bitrate.sync = off            → preconditions fire; no bitrate moves
bitrate.sync = match-cap/...  → + bitrate moves per direction policy
```

`skipUpgrades` sits **above** `bitrate.sync` and is enforced upstream of the gate
(in `detectUpdates` and the `postProcessPresetChanges` early-return): it filters
out every file-replacement reason, including preconditions. `bitrate.sync = off`
is the narrower veto that freezes bitrate moves while still letting
format/encoding corrections through.

### Precondition classes

Three reasons are **correctness** re-encodes, not bitrate preference, so they
bypass the policy gate and re-encode even under `bitrate.sync = off` (still vetoed
by `skipUpgrades`):

| Reason | Axis | Where detected | Direction |
|---|---|---|---|
| `lossless-boundary` | lossy/lossless boundary (observable from codec: device filetype + source) | source bound (`up`) and device bound (`down`) | `up` / `down` |
| `encoding-mismatch` | CBR/VBR encoding mode (sync-tag `encoding` only — libgpod exposes no VBR signal) | device bound, lossless and lossy paths | `format-only`, or `up`/`down` when a tier move coincides |
| `format-mismatch` | codec correctness | _reserved_ (codec changes are handled by the separate `postProcessCodecChanges` pass) | `format-only` |

Two design rules hold for all three:

- **The precondition takes the headline.** When an encoding flip coincides with a
  tier/bitrate move, a single re-encode satisfies both, so `encoding-mismatch` is
  the reason and the direction reflects the coincident move (else `format-only`).
- **Only podkit-written tracks are eligible.** `encoding-mismatch` reads the
  encoding mode podkit recorded; a direct copy clears `encoding`
  (`buildCopySyncTag`) and an untagged track has none, so neither is re-encoded on
  an encoding-mode change — re-encoding a faithful copy would be a lossy-to-lossy
  degradation. The lossless/lossy boundary is the exception: it is observable from
  the codec without a tag (filetype fallback), though the sync tag is still read
  first so a lossy transcode on a lossless-looking container is not misread.

### Source-bound tolerance

`QualityTarget.toleranceUp` / `toleranceDown` (default 0 = exact) widen the
in-sync band on the **lossy source-bound comparison only** — the effective target
in `classifyLossyDeviceBound` is derived from the ffprobe source bitrate, which
can wobble between syncs. The recorded `encoded` value is deterministic (podkit
wrote it), so it carries no tolerance. The legacy `bitrateTolerance` knob (whose
old role slackening the now-removed DB-bitrate fallback is gone) is reinterpreted
as the default for both directions: `qualityTargetFromConfig` resolves
`toleranceUp ?? bitrateTolerance` and `toleranceDown ?? bitrateTolerance`, so an
explicit per-direction value wins and an unset value stays exact.

---

## 2. How the update reason surfaces

`detectUpgrades(source, ipod)` in `upgrades.ts` covers the NON-quality axes
(artwork, normalization, metadata). The quality axis is owned by
`classifyQualityChange`.

The music handler (`handler.ts`) assembles reasons as:

1. Run `classifySourceBound` (with the device policy) in the match loop
   (`detectUpdates`). When it returns a change **that fires** (`reEncodes`), push
   `'quality-change'` as the primary reason and stash the `QualityChange` object
   in `DiffUpdateEntry.qualityChange`. A policy-suppressed source-bound change
   (e.g. `source-improved` under `down-only`/`off`) is left in `existing`.
2. Run `classifyDeviceBound` (with the device policy) in the post-process pass
   (`postProcessPresetChanges`). Same stash mechanism; a suppressed change takes
   the report-only channel below.

`DiffUpdateEntry.reasons[0] === 'quality-change'` is the signal consumers
(presenter, JSON output) use to branch on the quality axis. The specific
sub-reason (lossless-boundary, cap-up, etc.) is always on `qualityChange.reason`.

### The report-but-don't-execute path (suppressed changes)

Any change with `reEncodes: false` must be **visible but never acted on** —
whether the default `source-down-suppressed` or a bitrate move the policy gate
suppressed (e.g. a `cap-down` under `up-only`/`off`). Routing it through
`toUpdate` would create an operation and inflate `tracksToUpdate`, so it takes a
separate channel.

`UnifiedSyncDiff.reportOnlyQualityChanges` holds these entries
(`{ source, device, qualityChange }`). In `postProcessPresetChanges`, when either
the lossy or the lossless device-bound returns a change with
`reEncodes === false`, the handler pushes it onto `reportOnlyQualityChanges` and
returns `null` from the `partitionExisting` callback — so the track stays in
`existing` (no operation, no file work, never counted toward
`tracksToUpdate`/`tracksToUpgrade`).

The presenter (`music-presenter.ts`) reads this channel alongside `toUpdate`:

- JSON: each report-only entry is appended to the collection's `qualityChanges[]`
  and counted under `updateBreakdown["quality-change-suppressed"]` (shared with
  the `qualityChangeInfo` helper used for executed changes).
- Default text: a per-collection "Source-down suppressed" count; verbose lists
  each track with its device-vs-source bitrates.

Because no operation is produced, a suppressed track is a stable no-op: every
dry-run reports it, and a real sync does nothing to it (idempotent).

---

## 3. Why `lossless-boundary` is suppressed when transcoding is active

`MusicHandler.detectUpdates` strips `'quality-change'` (specifically the
`lossless-boundary` sub-reason) from the reasons list when the device track is
already in the AAC family. This was previously called `format-upgrade`
suppression (`handler.ts:285-290`):

```ts
if (reasons.includes('quality-change') && qualityChange?.reason === 'lossless-boundary') {
  const ipodFamily = getIpodFormatFamily(device);
  if (ipodFamily === 'aac') {
    reasons = reasons.filter((r) => r !== 'quality-change');
  }
}
```

This is **Working As Intended**. A FLAC source transcoded to AAC at `quality=high`
produces an AAC `.m4a` on the device. Without this filter the classifier would
see "source is lossless, device is lossy" and emit `lossless-boundary` on
every subsequent sync, re-transcoding forever.

The MP3-on-device case is NOT filtered — `getIpodFormatFamily` returns `'mp3'`,
not `'aac'`, so the `lossless-boundary` upgrade fires legitimately.

---

## 4. The device-bound and the bitrate baseline

`classifyDeviceBound` requires an authoritative `encoded` value on the device
side. Two paths:

**Lossless→lossy boundary (precondition, checked first):** Before any of the
paths below, the lossless-source device bound checks whether the device copy is
lossless while the target is now a lossy preset. The device copy's losslessness is
read tag-first (`isDeviceCopyLossless`: `quality=lossless` tag → lossless, an
explicit lossy transcode tag → lossy, `copy`/untagged → filetype), so a lossy
transcode on a lossless-looking container is not misread. When it crosses, the
result is `lossless-boundary` with direction `down` — re-encode down to the cap
regardless of bitrate policy. This is the mirror of the source bound's
lossy→lossless `up` crossing. (After the re-encode the device copy is lossy, so
the crossing does not re-fire — the next sync sees a lossy device tag and matches.)

**Sync-tag exact comparison (authoritative):** When the device carries a sync
tag AND `expectedSyncTag` is provided, `syncTagMatchesConfig` compares them
exactly. A match returns null. A mismatch is split: an encoding-mode (CBR/VBR)
flip produces `encoding-mismatch` (a precondition — see §1a); otherwise the
`qualityMoveDirection` of the tier/bitrate move yields `cap-up` or `cap-down`.

**Untagged → opted out:** When no exact comparison is possible and the ALAC
shortcut below does not apply, this bound returns `null`. There is **no**
DB-bitrate fallback: the sync tag is the sole quality truth, and a track podkit
never wrote is left alone rather than guessed from the unreliable device-database
bitrate (libgpod exposes no CBR/VBR signal). Adopting such a track is an explicit,
destructive opt-in — see "Adopting untagged tracks" in §4 and
[ADR-022](../../../adr/adr-022-sync-tag-sole-quality-truth.md).

**ALAC preset shortcut:** When `target.isAlacPreset` is true and no sync tag
is available, the comparison is format-based (not bitrate): if the device track
is already ALAC, return null; otherwise return `cap-up`. (This is observable from
the container, so it is not a DB-bitrate guess and applies to untagged tracks.)

The three paths above are the **lossless** ladder. Lossy sources branch off
earlier — see below.

### Lossy device-bound (`classifyLossyDeviceBound`, both directions)

When the source is lossy, `classifyDeviceBound` delegates to
`classifyLossyDeviceBound` instead of the lossless ladder. This path is
deliberately narrow:

- **`encoded` is the sync-tag bitrate and nothing else.** `encoded =
  device.syncTag?.bitrate`. A lossy copy records its effective bitrate in the
  copy tag (`buildCopySyncTag`); a re-encoded lossy track records its effective
  target in its audio tag (see below). The unreliable DB bitrate is **never**
  consulted for lossy — there is no tolerance fallback and no guessing. A lossy
  track with no recorded bitrate (an untagged track, or one added before
  sync-tag bitrate recording) is opted out (returns null). An explicit adoption
  path via `--force-sync-tags-transcode` is planned.
- **Encoding-mode (CBR/VBR) flip is a precondition here too.** After the
  `encoded`/cap/source guards, if the device's recorded `encoding` differs from
  the target encoding the path returns `encoding-mismatch` (a precondition —
  re-encodes under every policy mode). Only a track podkit transcoded carries a
  recorded `encoding`; a copy tag clears it, so a faithful copy is never
  re-encoded on a mode change. The re-encode targets `min(source, cap)` so the
  rewritten tag matches the next sync's comparison (idempotent), and a coincident
  cap move shares the single re-encode (direction reflects that move, else
  `format-only`).
- **Cap = `target.presetBitrate`.** The config resolver already folds
  `customBitrate` into `presetBitrate` (`getPresetBitrate(preset, customBitrate)`),
  so a custom cap is honoured for free. When there is no lossy cap (a lossless
  target preset, `presetBitrate === 0`) the path returns null.
- **Effective target = `min(source.bitrate, cap)`.** Both directions are bounded
  by what the source can supply — re-encoding to the full cap when the source only
  provides less would inflate the file with no quality gain. The source bitrate is
  required; without it (or without a recorded `encoded`) the path returns null
  (nothing to compare against, no DB-bitrate guessing).
- **Three-bound model.** The gap between `encoded` and `effectiveTarget =
  min(source, cap)` classifies the move:
  - `encoded < effectiveTarget` → `cap-up` (re-encode up from the source toward
    the effective ceiling).
  - `encoded > effectiveTarget`:
    - `source >= cap` → `cap-down` (re-encode down to the cap — the source can
      supply it).
    - `source < cap` → `source-down-suppressed` (`reEncodes: false`). The source
      has degraded below the cap, so the effective target follows the source and
      the device copy is already better than the source can produce. Re-encoding
      down would be a lossy-to-lossy downgrade of degraded audio, so the file is
      **kept and reported, not acted on**. This single branch covers both
      `source < encoded <= cap` and the edge where `encoded > cap` but the source
      has since dropped below the cap (e.g. recorded 320, source re-ripped to 100,
      cap 128) — a naive `encoded > cap` rule would wrongly fire cap-down there.
  - `encoded === effectiveTarget` → null (in sync).

  Suppression is the default (`match-cap`) for a degraded source. The `match-all`
  policy opts in to following the source down: the gate flips the
  `source-down-suppressed` change to `reEncodes: true` and the executor re-encodes
  to `targetBitrate` (the source bitrate). See §1a.

**Routing the re-encode.** A compatible/device-native lossy source would
normally be *copied* by the classifier. A bitrate move that fires must instead
*transcode* it, so `MusicHandler.planUpdate` overrides the routing
(`resolveUpgradeAction`): for a `cap-down`, `cap-up`, or a `match-all`
followed `source-down-suppressed` on a lossy source it builds a `transcode`
action at the resolved preset with `bitrateOverride = qualityChange.targetBitrate`
— the cap for cap-down, or `min(source, cap)` for cap-up / followed source-down. (The override comes from the
change, not the config-wide preset bitrate, because the cap-up target may be the
source bitrate when the source supplies less than the cap.) The re-encode reads
the **source** file via the existing `transferUpgradeToIpod` executor (run as an
`upgrade-transcode`), so the up direction genuinely recovers quality rather than
re-compressing the smaller on-device copy — no new executor code.

**Idempotency.** The re-encode records the effective target in the device's sync
tag (`buildSyncTagForPreset` passes the preset's `bitrateOverride` through to
`buildAudioSyncTag`, symmetric with `expectedSyncTagFromClassification`). The
next sync reads `encoded === min(source, cap)`, so neither `encoded > cap` nor
`encoded < min(source, cap)` holds and the track is left alone. This holds even
when the effective target was the **source** bitrate (cap-up bounded by a source
below the cap): the recorded bitrate equals the source, so the next sync is a
no-op. A second cap move (changing the cap again) re-fires correctly because the
recorded bitrate is the *previous* effective target. Verified on both an iPod
(sync tag in the iTunesDB comment) and a mass-storage device (sync tag in the
sidecar/comment) — no device database is required.

### Where the bitrate baseline comes from

For **new copies**, the executor writes `source.bitrate` to the device track
record at add time (`toDeviceTrackInput` in `transfer.ts`). The next sync's
`getTracks()` reads it back, and the device-bound comparison is populated.

For **upgrades**, `transferUpgradeToIpod` resolves the bitrate as
`prepared.bitrate ?? source.bitrate`. For direct-copy upgrades the preparer
doesn't re-encode, so `prepared.bitrate` is undefined and `source.bitrate`
wins. Without this fallback a quality upgrade replaces the file but leaves the
device bitrate at the old value, causing an infinite re-upgrade loop.

For **pre-existing tracks** (added before this guarantee, or by a third-party
tool), `bitrate = 0`. The `--force-sync-tags` backfill
(`postProcessBitrateBaseline`) catches these with an opt-in, idempotent
`update-metadata` pass. No file replacement. (Note: this populates the device's
record bitrate for the source bound; it does **not** synthesize a sync tag, so an
otherwise-untagged track stays opted out of the device bound — see below.)

### Adopting untagged tracks (`--force-sync-tags-transcode`)

Because the device bound treats an untagged track as opted out (the sync tag is
the sole quality truth; there is no DB-bitrate fallback), there is one explicit,
destructive path that establishes ground truth for such tracks:
`postProcessSyncTagsTranscode` (gated on `forceSyncTagsTranscode`). It runs as a
post-process pass **before** the tag-only `postProcessSyncTags`, so when both
flags are set it claims untagged tracks first (the transcode wins; no
double-processing).

For each matched track with **no** sync tag (`!syncTag` — a track podkit never
wrote), the pass routes it to a `quality-change` re-encode targeting the resolved
device quality. A track that carries any podkit sync tag is authoritative (its
quality tier and encoding mode are recorded; a plain transcode tag legitimately
omits the bitrate, which is implied by the preset) and is left to the classifier
— it is never re-encoded here. It reuses the
existing executor: a lossy source with a cap is re-encoded to `min(source, cap)`
(carried as the change's `targetBitrate`, which `resolveUpgradeAction` stamps as
the preset `bitrateOverride`); a lossless source is transcoded via the
classifier's routing. `transferUpgradeToIpod` then writes the authoritative sync
tag. After adoption the track carries a recorded bitrate, so the next ordinary
sync sees it as tagged and the adoption pass skips it — idempotent. A track that
already carries an authoritative tag is never touched here.

---

## 5. Vocabulary rename and current reachability

The unified quality classifier replaced four separate reason strings with a
single vocabulary. The four original reasons map directly to the old strings
(`source-down-suppressed` and `encoding-mismatch` are additionally reachable —
see §1a and §4):

| Old reason | `qualityChange.reason` | Update reason |
|---|---|---|
| `format-upgrade` | `lossless-boundary` | `quality-change` |
| `quality-upgrade` | `source-improved` | `quality-change` |
| `preset-upgrade` | `cap-up` | `quality-change` |
| `preset-downgrade` | `cap-down` | `quality-change` |

**Lossy cap enforcement (three-bound model).** `classifyDeviceBound` routes lossy
sources to `classifyLossyDeviceBound` (see §4), which compares the recorded
`encoded` against `min(source, cap)`: re-encode up toward the effective ceiling,
re-encode down to the cap when the source can supply it, or — when the source has
degraded below the cap — emit `source-down-suppressed` (`reEncodes: false`),
keeping the better device copy and reporting it via the report-only channel
(see §2). The lossless paths are unchanged.

> **Sync-tag merge leak fixed with lossy cap-down.** `buildCopySyncTag` now
> authoritatively emits `encoding: undefined` (mirroring `buildAudioSyncTag`'s
> authoritative `bitrate` clear). The device adapters merge tags with
> `{...existing, ...update}`, so a track transitioning transcode → copy would
> otherwise keep a stale `encoding=vbr` from the prior audio tag. `undefined`
> wins the merge and is dropped on serialization, keeping copy tags clean.

**Untagged tracks are opted out.** There is no DB-bitrate fallback in either the
lossless or lossy device bound: a track without an authoritative sync tag returns
`null` from `classifyDeviceBound` and is left alone. `detectBitratePresetMismatch`
survives only for **video** preset-change detection (video carries no sync tags
and has a reliable container bitrate). Adoption of untagged audio tracks is the
explicit `--force-sync-tags-transcode` path (see §4).

---

## 6. Interactions

### With `--skip-upgrades` and `bitrate.sync`

These are two rungs of the same ladder (see §1a). `MusicHandler.detectUpdates`
filters out **all** file-replacement upgrades when `skipUpgrades` is set — every
bound, including precondition reasons — for a purely additive device. The
bitrate baseline still backfills (it's metadata-only). `bitrate.sync = off` is the
narrower veto: it suppresses bitrate moves only, while format/encoding-mode
preconditions still re-encode for correctness.

### With `--force-transcode`

If the source is lossless and no file-replacement upgrade has been detected,
`MusicHandler.detectUpdates` injects `force-transcode` as the primary reason.
This bypasses the quality classifier entirely.

### With sync tags

A track with a `quality=copy` sync tag is recognized as in-sync by
`classifyDeviceBound`'s exact comparison, so preset changes don't re-encode it.

The source bound (`classifySourceBound`) runs independently of sync tags. A
copy-tagged track whose source bitrate later rises significantly still triggers
the `source-improved` upgrade.

---

## 7. Open work

- ~~**Untagged opt-out:** Drop the lossless DB-bitrate fallback.~~ Done: the
  sync tag is the sole quality truth, untagged audio tracks are opted out of the
  device bound, and `--force-sync-tags-transcode` is the explicit, destructive
  adoption path (see §4 and [ADR-022](../../../adr/adr-022-sync-tag-sole-quality-truth.md)).
- **Lossy encoding-mismatch eligibility:** the CBR/VBR precondition fires on the
  lossy cap path only for tracks podkit transcoded *with a recorded bitrate*
  (e.g. a prior cap move). A lossy transcode written without a bitrate override
  (no custom bitrate, no cap move — e.g. an OGG→AAC transcode at a bare preset)
  records `encoding` but no `bitrate`, so it is opted out by the `encoded`
  guard. Universal lossy bitrate recording would close this; tracked with the
  untagged opt-out above.
- **Source lossy → lossless detection:** re-rip MP3→FLAC at the same target
  bitrate re-encoding up — out of scope here; the sync tag already carries source
  codec to make it possible later.

---

## 8. References

- `packages/podkit-core/src/sync/engine/upgrades.ts` — `classifyQualityChange`,
  `classifySourceBound`, `classifyDeviceBound`, `detectUpgrades`, threshold constants
- `packages/podkit-core/src/sync/engine/upgrades.test.ts` — unit matrix for
  the unified classifier (incl. policy threading + tolerance)
- `packages/podkit-core/src/sync/engine/bitrate-sync-policy.test.ts` — exhaustive
  `applyBitrateSyncPolicy` gate matrix (every reason × every mode)
- `packages/podkit-cli/src/config/` — `[bitrate]` schema (`types.ts`),
  validation (`loader.ts`), and device → global → `match-cap` resolution
  (`resolve.ts`); `--bitrate-sync` override in `commands/sync.ts`
- `packages/podkit-core/src/sync/music/handler.ts` —
  `detectUpdates` (match loop), `postProcessPresetChanges` (post-process pass),
  `postProcessBitrateBaseline`, `postProcessSyncTags`
- `packages/podkit-core/src/sync/music/transfer.ts` —
  `toDeviceTrackInput` (initial-add bitrate), `transferUpgradeToIpod`
  (upgrade bitrate resolution)
- `test-packages/e2e-tests/src/features/upgrades.test.ts` — E2E pins for
  the quality-change upgrade path
- `backlog/docs/doc-051` — PRD for the bidirectional quality change feature
