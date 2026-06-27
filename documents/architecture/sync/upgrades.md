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
| `lossless-boundary` | Source is lossless AND device copy is lossy | `up` |
| `source-improved` | Same-family lossy source whose bitrate significantly exceeds the device copy (64 kbps absolute OR 1.5× relative) | `up` |
| `cap-up` | Device's recorded encoding sits below the configured target — re-encode up | `up` |
| `cap-down` | Device's recorded encoding sits above the configured target — re-encode down | `down` |
| `format-mismatch` | _(reserved — not yet produced)_ Codec correctness precondition | `format-only` |
| `encoding-mismatch` | _(reserved — not yet produced)_ CBR/VBR flip | `format-only` |
| `source-down-suppressed` | _(reserved — not yet produced)_ Worse source the user opted NOT to follow down | — |

The `QualityChange` object also carries: `direction`, `reEncodes` (false only
for `source-down-suppressed`), `targetBitrate`, and optional
`encodedBitrate`, `sourceBitrate`, `fromLossless`, `toLossless`.

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
`encoded` value is the device's sync tag. When the sync tag is absent the
classifier falls back to the device DB bitrate + tolerance
(`detectBitratePresetMismatch`). This fallback will be removed once lossy sync
tags are written for pre-existing libraries.

`classifyQualityChange` runs Bound 1 first; Bound 2 only fires when Bound 1
returns null.

---

## 2. How the update reason surfaces

`detectUpgrades(source, ipod)` in `upgrades.ts` covers the NON-quality axes
(artwork, normalization, metadata). The quality axis is owned by
`classifyQualityChange`.

The music handler (`handler.ts`) assembles reasons as:

1. Run `classifySourceBound` in the match loop (`detectUpdates`). When it
   returns non-null, push `'quality-change'` as the primary reason and stash
   the `QualityChange` object in `DiffUpdateEntry.qualityChange`.
2. Run `classifyDeviceBound` in the post-process pass
   (`postProcessPresetChanges`). Same stash mechanism.

`DiffUpdateEntry.reasons[0] === 'quality-change'` is the signal consumers
(presenter, JSON output) use to branch on the quality axis. The specific
sub-reason (lossless-boundary, cap-up, etc.) is always on `qualityChange.reason`.

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

**Sync-tag exact comparison (authoritative):** When the device carries a sync
tag AND `expectedSyncTag` is provided, `syncTagMatchesConfig` compares them
exactly. A match returns null; a mismatch produces `cap-up` or `cap-down` via
`syncTagDirection`.

**Untagged fallback:** When no exact comparison is possible, the fallback is
`detectBitratePresetMismatch(device.bitrate, target.presetBitrate, tolerance)`.
This uses the device DB bitrate + a percentage tolerance (30% VBR, 10% CBR).
The fallback will be removed once lossy sync tags are written for pre-existing
libraries.

**ALAC preset shortcut:** When `target.isAlacPreset` is true and no sync tag
is available, the comparison is format-based (not bitrate): if the device track
is already ALAC, return null; otherwise return `cap-up`.

The three paths above are the **lossless** ladder. Lossy sources branch off
earlier — see below.

### Lossy device-bound (`classifyLossyDeviceBound`, cap-down only)

When the source is lossy, `classifyDeviceBound` delegates to
`classifyLossyDeviceBound` instead of the lossless ladder. This path is
deliberately narrow:

- **`encoded` is the sync-tag bitrate and nothing else.** `encoded =
  device.syncTag?.bitrate`. A lossy copy records its effective bitrate in the
  copy tag (`buildCopySyncTag`); a re-encoded lossy track records the cap in its
  audio tag (see below). The unreliable DB bitrate is **never** consulted for
  lossy — there is no tolerance fallback and no guessing. A lossy track with no
  recorded bitrate (an untagged track, or one added before sync-tag bitrate
  recording) is opted out (returns null). An explicit adoption path via
  `--force-sync-tags-transcode` is planned.
- **Cap = `target.presetBitrate`.** The config resolver already folds
  `customBitrate` into `presetBitrate` (`getPresetBitrate(preset, customBitrate)`),
  so a custom cap is honoured for free. When there is no lossy cap (a lossless
  target preset, `presetBitrate === 0`) the path returns null.
- **Direction: DOWN only.** `encoded > cap` → `cap-down`. `encoded <= cap`
  (at or below the cap) → null; raising an under-cap lossy track is reserved for
  forthcoming bitrate-policy work.

**Routing the re-encode.** A compatible/device-native lossy source would
normally be *copied* by the classifier. A cap-down must instead *transcode it
down*, so `MusicHandler.planUpdate` overrides the routing
(`resolveUpgradeAction`): for a `cap-down` on a lossy source it builds a
`transcode` action at the resolved preset with `bitrateOverride = presetBitrate`
(the cap). The existing `transferUpgradeToIpod` executor runs it as an
`upgrade-transcode` — no new executor code.

**Idempotency.** The cap-down re-encode records the cap in the device's sync tag
(`buildSyncTagForPreset` now passes the preset's `bitrateOverride` through to
`buildAudioSyncTag`, symmetric with `expectedSyncTagFromClassification`). The
next sync reads `encoded === cap`, so `encoded > cap` is false and the track is
left alone. A second cap-down (lowering the cap again) re-fires correctly
because the recorded bitrate is the *previous* cap, still above the *new* one.
Verified on both an iPod (sync tag in the iTunesDB comment) and a mass-storage
device (sync tag in the sidecar/comment) — no device database is required.

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
`update-metadata` pass. No file replacement.

---

## 5. Vocabulary rename and current reachability

The unified quality classifier replaced four separate reason strings with a
single vocabulary. The four currently reachable reasons map directly to the old
strings:

| Old reason | `qualityChange.reason` | Update reason |
|---|---|---|
| `format-upgrade` | `lossless-boundary` | `quality-change` |
| `quality-upgrade` | `source-improved` | `quality-change` |
| `preset-upgrade` | `cap-up` | `quality-change` |
| `preset-downgrade` | `cap-down` | `quality-change` |

**Lossy cap enforcement (cap-down).** `classifyDeviceBound` routes lossy sources
to `classifyLossyDeviceBound` (see §4), which re-encodes an over-cap lossy track
down to the cap. Raising an under-cap lossy track is not yet enabled. The
lossless paths are unchanged.

> **Sync-tag merge leak fixed with lossy cap-down.** `buildCopySyncTag` now
> authoritatively emits `encoding: undefined` (mirroring `buildAudioSyncTag`'s
> authoritative `bitrate` clear). The device adapters merge tags with
> `{...existing, ...update}`, so a track transitioning transcode → copy would
> otherwise keep a stale `encoding=vbr` from the prior audio tag. `undefined`
> wins the merge and is dropped on serialization, keeping copy tags clean.

**Untagged DB-bitrate fallback (lossless only).** The tolerance-based
`detectBitratePresetMismatch` path remains active for lossless tracks without a
sync tag. It will be removed once lossy sync tags are written for pre-existing
libraries.

---

## 6. Interactions

### With `--skip-upgrades`

`MusicHandler.detectUpdates` filters out all file-replacement upgrades when
`skipUpgrades` is set. Both bounds of `classifyQualityChange` are suppressed.
The bitrate baseline still backfills (it's metadata-only).

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

- **Lossy cap-up:** `classifyLossyDeviceBound` returns null at/below the cap.
  The forthcoming direction will raise an under-cap lossy track toward the cap as
  far as the source allows. (Cap-down is already active.)
- **Encoding-mismatch:** CBR/VBR flip fires regardless of bitrate — will be
  wired before the bitrate compare in the sync-tag path.
- **Source-down suppression:** A worse source under a "match-cap" flag will
  produce `source-down-suppressed` with `reEncodes: false` instead of
  re-encoding down.
- **Untagged opt-out:** Drop the DB-bitrate fallback once lossy sync tags are
  written for pre-existing libraries.

---

## 8. References

- `packages/podkit-core/src/sync/engine/upgrades.ts` — `classifyQualityChange`,
  `classifySourceBound`, `classifyDeviceBound`, `detectUpgrades`, threshold constants
- `packages/podkit-core/src/sync/engine/upgrades.test.ts` — unit matrix for
  the unified classifier
- `packages/podkit-core/src/sync/music/handler.ts` —
  `detectUpdates` (match loop), `postProcessPresetChanges` (post-process pass),
  `postProcessBitrateBaseline`, `postProcessSyncTags`
- `packages/podkit-core/src/sync/music/transfer.ts` —
  `toDeviceTrackInput` (initial-add bitrate), `transferUpgradeToIpod`
  (upgrade bitrate resolution)
- `test-packages/e2e-tests/src/features/upgrades.test.ts` — E2E pins for
  the quality-change upgrade path
- `backlog/docs/doc-051` — PRD for the bidirectional quality change feature
