---
title: 'sync: upgrades'
description: How podkit detects when a track already on the device should be re-transferred — the format-upgrade vs quality-upgrade gates, why format-upgrade is suppressed during transcoding, and how the bitrate baseline gets backfilled.
sidebar:
  order: 23
---

How the sync engine decides that a track already on the device should
be re-transferred from the source — the file-replacement upgrade gates
(format-upgrade, quality-upgrade) and the bitrate baseline that one of
them depends on.

This doc covers detection only. See
[`planning.md`](./planning.md) for how the detected upgrade is turned
into an operation in the plan, and
[`error-handling.md`](./error-handling.md) for the channels through which
upgrade-time failures propagate.

---

## 1. The two file-replacement upgrade gates

`detectUpgrades(source, ipod)` in
`packages/podkit-core/src/sync/engine/upgrades.ts` walks an `existing`
match and emits zero or more `UpgradeReason`s. Two of those reasons are
**file-replacement** — they cause the audio file on the device to be
swapped out:

| Reason | Fires when | Operation produced |
|---|---|---|
| `format-upgrade` | Source is lossless AND iPod track is lossy (different format family) | `upgrade-transcode` / `upgrade-direct-copy` / `upgrade-optimized-copy` per classifier action |
| `quality-upgrade` | Same format family on both sides, source bitrate significantly higher than iPod bitrate | Same as above |

Both gates rely on signals the iPod track carries through libgpod:
`ipod.filetype` for format-upgrade, `ipod.bitrate` for quality-upgrade.
If those fields are missing or zero, the gate silently no-ops.

The thresholds for quality-upgrade are:

- `MIN_BITRATE_INCREASE_KBPS` = 64 (absolute delta), OR
- `MIN_BITRATE_MULTIPLIER` = 1.5 (relative ratio).

Either passing fires the upgrade — so a 96 → 256 kbps source bump
qualifies (delta 160, ratio 2.67), but 256 → 280 does not.

---

## 2. Why format-upgrade is suppressed when transcoding is active

`MusicHandler.detectUpdates` strips `format-upgrade` from the reasons
list when the iPod track is already in the AAC family
(`handler.ts:285-290`):

```ts
if (reasons.includes('format-upgrade')) {
  const ipodFamily = getIpodFormatFamily(device);
  if (ipodFamily === 'aac') {
    reasons = reasons.filter((r) => r !== 'format-upgrade');
  }
}
```

This is **Working As Intended**. Rationale:

A user with `quality=high` (or any non-lossless preset) and a FLAC source
gets the transcode pipeline. The classifier routes the lossless source
through `add-transcode` and produces an AAC `.m4a` on the device. The
iPod track's filetype is then AAC, not FLAC. `detectUpgrades` would,
without this filter, see "source is lossless, iPod is lossy" and emit
`format-upgrade` on every subsequent sync — re-transcoding the same FLAC
into the same AAC bytes forever.

The MP3-on-iPod case (a compatible-lossy that was never transcoded)
still fires `format-upgrade` legitimately because `getIpodFormatFamily`
returns `'mp3'`, not `'aac'`. That triggers the re-transcode the user
expects: replace the MP3 with the AAC that quality=high would now have
chosen.

Boundary: the filter does NOT consult the active preset; it consults the
**iPod side**'s observed format. So switching from `quality=lossless` to
`quality=high` does not silently leave existing ALAC tracks alone — that
transition is owned by `postProcessPresetChanges` and the codec-change
detector, which read the iPod track's stored sync tag rather than the
filetype family.

---

## 3. Quality-upgrade and the bitrate baseline

`quality-upgrade` requires BOTH sides of `source.bitrate && ipod.bitrate`
to be truthy:

```ts
if (
  sourceFamily === ipodFamily &&
  sourceFamily !== 'unknown' &&
  source.bitrate &&
  ipod.bitrate
) {
  // threshold check…
}
```

The iPod side comes from `IpodTrackImpl.bitrate`, which is `number`
(not `number | undefined`) and defaults to `0` when libgpod has no
stored value. So a zero on the iPod side silently disables the gate.

### Where the iPod side comes from

For NEW copies (going forward), the executor writes `source.bitrate` to
the iPod track record at add time. The path is
`packages/podkit-core/src/sync/music/transfer.ts`'s
`toDeviceTrackInput`, which passes `bitrate: track.bitrate` through to
`DeviceAdapter.addTrack`. The iPod adapter forwards that to libgpod's
`track->bitrate` field. The next sync's `getTracks()` reads it back, and
both sides of the gate are populated.

For UPGRADES (a previously-copied track replaced by a higher-bitrate
source), `transferUpgradeToIpod` resolves the bitrate as `prepared.bitrate
?? source.bitrate`. For `upgrade-direct-copy` the preparer doesn't
re-encode, so `prepared.bitrate` is undefined and `source.bitrate` wins.
Without this fallback a quality-upgrade replaces the file but leaves the
iPod's bitrate field at the old value, causing the next sync to
re-detect the same quality-upgrade in an infinite loop.

### Where the iPod side does NOT come from automatically

A track that was added BEFORE this guarantee landed (or by a third-party
tool that omitted the field, or by a libgpod version that didn't persist
it) carries `bitrate = 0` and stays inert through the gate.

The `--force-sync-tags` backfill (`handler.postProcessBitrateBaseline`)
catches these. Gated identically to the artwork-hash baseline backfill:

- Opt-in: an already-set-up iPod must not silently re-tag its entire
  library after a podkit upgrade.
- Idempotent: fires only when `ipod.bitrate === 0` and the source has
  a bitrate to lend.
- Mechanism: emits a `update-metadata` operation carrying the source
  bitrate. `executeUpdateMetadata` propagates the field via
  `updateTrack`. No file replacement.

Symmetry with the artwork-hash baseline backfill in
`postProcessSyncTags` is deliberate — both fields are "supplementary
metadata the next sync's detectUpgrades needs to compare against", both
are written on copy going forward, and both need an opt-in escape hatch
for pre-existing tracks.

---

## 4. Interactions

### With `--skip-upgrades`

`MusicHandler.detectUpdates` filters out all file-replacement upgrades
when `skipUpgrades` is set. Quality-upgrade and format-upgrade are both
filtered. The bitrate baseline still backfills (it's metadata-only).

### With `--force-transcode`

If the source is lossless and no file-replacement upgrade has been
detected, `MusicHandler.detectUpdates` injects `force-transcode` as the
primary reason. This routes through `createUpgrade` with the classifier
action.

`force-transcode` does not interact with bitrate — it always re-transcodes,
so the bitrate-write happens at execute time via
`transferUpgradeToIpod`'s normal `prepared.bitrate ?? source.bitrate`
resolution.

### With sync tags

A track with a `quality=copy` sync tag is recognized as in-sync by
`postProcessPresetChanges` even when the configured quality preset would
otherwise transcode — the track is copyable, the user already opted in,
so no re-encoding sweeps.

The quality-upgrade gate runs INDEPENDENTLY of sync tags. A copy-tagged
track whose source bitrate later rises significantly still triggers the
file-replacement upgrade. Sync tags govern preset routing, not source-vs-
device quality comparison.

---

## 5. Open work

- Cap-lowering as a downgrade: today's classifier always routes
  compatible-lossy sources as direct-copy regardless of the configured
  bitrate cap. A user who lowers `quality` from `high` to `low` does not
  see their existing 256 kbps MP3 copies re-transcoded down — the
  source still carries 256 kbps, and the cap doesn't enter the upgrade
  decision. Not addressed by this doc's gates. See backlog for a future
  task that extends `detectPresetChange` to consider lossy sources.

- Bitrate fidelity across VBR: the iPod stores a single integer.
  Round-trip FLAC → AAC VBR → iPod loses the VBR distribution, so a
  re-encode at the same nominal quality may shift the stored bitrate by
  a few kbps. The 64 kbps absolute threshold absorbs this.

---

## 6. References

- `packages/podkit-core/src/sync/engine/upgrades.ts` — `detectUpgrades`
  + threshold constants
- `packages/podkit-core/src/sync/music/handler.ts:285-290` —
  format-upgrade transcoding-active filter
- `packages/podkit-core/src/sync/music/handler.ts` —
  `postProcessBitrateBaseline` + `postProcessSyncTags`
- `packages/podkit-core/src/sync/music/transfer.ts` —
  `toDeviceTrackInput` (initial-add bitrate), `transferUpgradeToIpod`
  (upgrade bitrate resolution)
- `test-packages/e2e-tests/src/features/upgrades.test.ts` — E2E pins
  for format-upgrade and quality-upgrade
