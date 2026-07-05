---
title: 'sync: upgrades'
description: How podkit detects when a track already on the device should be re-transferred — the unified quality classifier, the two-axis lossy-reduction model, and the bitrate baseline that keeps the device-bound precise.
sidebar:
  order: 23
---

How the sync engine decides that a track already on the device should be
re-transferred from the source — the unified quality classifier
(`classifyQualityChange`) and the `resolveLossyReduction` seam that
governs every lossy bitrate decision across add, re-sync, and adoption.

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

| Reason | Fires when | Direction | Re-encodes? |
|---|---|---|---|
| `lossless-boundary` | Source crosses the lossless/lossy boundary: lossless source replacing a lossy device copy (`up`), or lossless device copy where the target is now a lossy preset (`down`). A correctness precondition — always re-encodes, independent of `skipUpgrades` exclusion. | `up` / `down` | Yes |
| `cap-up` | **Lossless-source only.** Device's recorded encoding sits below the effective target tier (a higher preset, or the ALAC upgrade path). Re-encoding a lossy source up cannot recover discarded information (ADR-023), so this reason is never produced for lossy tracks. | `up` | Yes |
| `cap-down` | Device's recorded encoding sits above the cap. Produced by both the lossless device-bound (lower preset) and the down-only lossy reduction (see §4). | `down` | Yes |
| `encoding-mismatch` | **Lossless-source only.** Device's recorded CBR/VBR mode differs from the target — a precondition that re-encodes for correctness. A CBR/VBR flip never re-encodes a lossy source (a lossy→lossy degradation that can grow the file — ADR-023 §6). | `format-only` / `up` / `down` | Yes |
| `format-mismatch` | _(reserved — not yet produced)_ Codec correctness precondition. | `format-only` | Yes |
| `source-down-suppressed` | Source was re-ripped/replaced with a copy whose bitrate dropped meaningfully below the device's recorded (sync-tag) bitrate. Re-encoding the good device copy down to the worse source would destroy quality, so it is **kept and reported, not acted on**. (`reEncodes: false`) | `down` | No |
| `below-cap` | A previously-REDUCED track (sync tag carries a lossy preset quality: `low`, `medium`, or `high`) now sits below a RAISED cap. Down-only reduction never re-lifts it automatically; it is reported so the user can `--force-transcode` to lift it. (`reEncodes: false`) | `up` | No |

The `QualityChange` object also carries: `direction`, `reEncodes` (whether the
change re-encodes the file), `targetBitrate`, and optional `encodedBitrate`,
`sourceBitrate`, `fromLossless`, `toLossless`.

All of this feeds the `quality-change` update reason and the `qualityChanges[]`
JSON array in the sync output.

### The three-bound model

The classifier compares the device's **recorded encoded quality** against the
**target** and against the **source** as separate, independent bounds — never
collapsed to `min(source, target)`. Collapsing would make a source drop
indistinguishable from a cap drop, which must be treated oppositely (cap-down
re-encodes; source-down suppresses). The two bounds are:

**Bound 1 — source-vs-device (`classifySourceBound`):** Covers `lossless-boundary`
(up — a lossless source replacing a lossy device copy, a correctness precondition) and
`source-down-suppressed` (down — a lossy source that has degraded below the device's
recorded bitrate, kept and reported). A lossy source that improved is **not** a
source-bound quality change: re-encoding a lossy track up cannot recover discarded
information (ADR-023). A genuinely changed/re-ripped source folds into ordinary
content-change detection (self-healing).

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
preconditions that do not need the tag (the lossless/lossy boundary check) still
fire for untagged tracks; only the bitrate-based comparison is absent.
See [ADR-022](../../../adr/adr-022-sync-tag-sole-quality-truth.md).

`classifyQualityChange` runs Bound 1 first; Bound 2 only fires when Bound 1
returns null.

---

## 1a. The `resolveLossyReduction` seam

`resolveLossyReduction` in
`packages/podkit-core/src/sync/engine/lossy-reduction.ts` is the single owner
of the ADR-023 lossy target-bitrate table. It is the **single decision function**
shared by the add path, the re-sync (device-bound) path, and the adoption path —
the anti-regression guarantee that a lossy track is never decided one way on add
and a different way on re-sync.

### Inputs

The key inputs are:

| Field | Role |
|---|---|
| `sourceCodec` | Source codec name — used only by the preserve-necessity efficiency path |
| `sourceBitrate` | Source bitrate in kbps (the ffprobe value on add; the **recorded sync-tag bitrate** on re-sync) |
| `deviceNative` | Whether the device plays the source codec natively (`true` = copy path) |
| `targetCodec` | Resolved transcode target codec |
| `cap` | Quality-preset bitrate — the hard ceiling on every target |
| `axis` | Resolved reduction axis: `convert` or `preserve` (from `resolveReductionAxis`) |
| `tolerance` | Source-proximity fraction — reduce only when `source > cap × (1 + tolerance)` |
| `deviceMax?` | Optional device maximum audio bitrate (kbps); clamps the preserve-necessity row |

### The target-bitrate table

| Case | Target |
|---|---|
| device-native + preserve | copy (original codec + bitrate) |
| device-native + convert | reduce iff `source > cap × (1 + tolerance)` → cap; else copy |
| incompatible (necessity) + preserve | `min(round(source × eff[target] / eff[source]), cap, deviceMax)` |
| incompatible (necessity) + convert | `min(source, cap)` |

Every transcode target is bounded by the cap (the hard ceiling). The device-native
rows are down-only bounded by the source; the preserve-necessity row may target
above the source bitrate when the target codec is less efficient — preserving the
source's *quality* in a forced cross-codec transcode — but is still capped by
the ceiling. Codec efficiency (`CODEC_EFFICIENCY`: aac 1.0, opus 0.75, vorbis
0.9, mp3 1.3) is used in exactly this one row and nowhere else.

### The reduction axis

`resolveReductionAxis(reduce, transferMode)` maps the user's `[bitrate].reduce`
setting to a `ReductionAxis` value:

- `always` → `convert` (always reduce over-cap device-native sources)
- `never` → `preserve` (always copy device-native sources untouched)
- `auto` (default) → follows the transfer mode: `optimized` → `convert`;
  `fast`/`portable` → `preserve`

The `preserve` axis only prevents down-direction reduction for device-native
sources. It does **not** override the hard ceiling: an incompatible codec (one
the device cannot play) must be transcoded regardless; the cap still applies.
See [Transfer Modes](../../../documents/principles/transfer-modes.md) and
[ADR-023](../../../adr/adr-023-lossy-reduction-down-only.md).

---

## 2. How the update reason surfaces

`detectUpgrades(source, ipod)` in `upgrades.ts` covers the NON-quality axes
(artwork, normalization, metadata). The quality axis is owned by
`classifyQualityChange`.

The music handler (`handler.ts`) assembles reasons as:

1. Run `classifySourceBound` in the match loop (`detectUpdates`). When it returns
   `lossless-boundary` (a precondition — always fires), push `'quality-change'`
   as the primary reason and stash the `QualityChange` in
   `DiffUpdateEntry.qualityChange`. A `source-down-suppressed` result goes to the
   report-only channel (see below), not to `toUpdate`.
2. Run `classifyDeviceBound` (lossless and lossy paths) in the post-process pass
   (`postProcessPresetChanges`). Same stash mechanism; `below-cap` and any
   non-re-encoding result take the report-only channel.

`DiffUpdateEntry.reasons[0] === 'quality-change'` is the signal consumers
(presenter, JSON output) use to branch on the quality axis. The specific
sub-reason is always on `qualityChange.reason`.

### The report-but-don't-execute path (suppressed / report-only changes)

Any change with `reEncodes: false` must be **visible but never acted on** —
`source-down-suppressed` (source re-ripped lower than the device copy; the good
copy is kept) or `below-cap` (a previously-reduced track that now sits below a
raised cap; re-lifting is an explicit user action via `--force-transcode`).

Routing these through `toUpdate` would create operations and inflate
`tracksToUpdate`, so they take a separate channel:
`UnifiedSyncDiff.reportOnlyQualityChanges` holds these entries
(`{ source, device, qualityChange }`). In `postProcessPresetChanges`, when the
lossy or lossless device-bound returns a change with `reEncodes === false`, the
handler pushes it onto `reportOnlyQualityChanges` and returns `null` from the
`partitionExisting` callback — so the track stays in `existing` (no operation,
no file work, never counted toward `tracksToUpdate`/`tracksToUpgrade`).

The presenter (`music-presenter.ts`) reads this channel alongside `toUpdate`:

- JSON: each report-only entry is appended to the collection's `qualityChanges[]`
  and counted under `updateBreakdown["quality-change-suppressed"]`.
- Default text: a per-collection "Source-down suppressed" count; verbose lists
  each track with device-vs-source bitrates. Tracks with `below-cap` are listed
  with a "N tracks below your quality target; re-sync with `--force-transcode` to
  lift them" prompt.

Because no operation is produced, a suppressed or report-only track is a stable
no-op: every dry-run reports it, and a real sync does nothing to it (idempotent).

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
result is `lossless-boundary` with direction `down` — re-encode down to the cap.
This is the mirror of the source bound's lossy→lossless `up` crossing. (After the
re-encode the device copy is lossy, so the crossing does not re-fire.)

**Sync-tag exact comparison (authoritative):** When the device carries a sync
tag AND `expectedSyncTag` is provided, `syncTagMatchesConfig` compares them
exactly. A match returns null. A mismatch is split: an encoding-mode (CBR/VBR)
flip on a **lossless-source** produces `encoding-mismatch` (a precondition —
see below); otherwise the `qualityMoveDirection` of the tier/bitrate move yields
`cap-up` (lossless) or `cap-down`.

**Untagged → opted out:** When no exact comparison is possible and the ALAC
shortcut below does not apply, this bound returns `null`. There is **no**
DB-bitrate fallback: the sync tag is the sole quality truth, and a track podkit
never wrote is left alone rather than guessed from the unreliable device-database
bitrate. See [ADR-022](../../../adr/adr-022-sync-tag-sole-quality-truth.md).

**ALAC preset shortcut:** When `target.isAlacPreset` is true and no sync tag
is available, the comparison is format-based (not bitrate): if the device track
is already ALAC, return null; otherwise return `cap-up`. (This is observable from
the container, so it applies to untagged tracks.)

The paths above are the **lossless** ladder. Lossy sources branch off earlier.

### Encoding-mismatch on the lossless path

`encoding-mismatch` is produced only by the lossless sync-tag-exact path. It is a
correctness precondition — a CBR/VBR flip re-encodes for correctness regardless of
other settings (still vetoed by `--skip-upgrades`). Two design rules hold:

- **The precondition takes the headline.** When an encoding flip coincides with a
  tier/bitrate move, a single re-encode satisfies both, so `encoding-mismatch` is
  the reason and the direction reflects the coincident move (else `format-only`).
- **Only podkit-written tracks are eligible.** A direct copy clears `encoding`
  (`buildCopySyncTag`) and an untagged track has none, so neither is re-encoded on
  an encoding-mode change.

A CBR/VBR flip on a **lossy** source is deliberately excluded (ADR-023 §6):
re-encoding a lossy track for an encoding-mode change is a lossy→lossy degradation
that can grow the file with no quality benefit. The mode change simply applies to
future lossy transcodes.

### Lossy device-bound (`classifyLossyDeviceBound`, down-only)

When the source is lossy, `classifyDeviceBound` delegates to
`classifyLossyDeviceBound` instead of the lossless ladder. This path reuses
the shared `resolveLossyReduction` seam and is deliberately narrow:

- **`sourceBitrate` is the device's RECORDED sync-tag bitrate, not the source
  file's ffprobe bitrate.** The DB bitrate is an unreliable proxy and is never
  consulted. A track with no recorded bitrate (no sync tag, or a zero recorded
  value) is opted out — returns null.
- **`tolerance: 0` — EXACT.** The recorded-vs-cap comparison is deterministic
  (podkit wrote the number, no ffprobe wobble to damp), so a cap you lowered
  applies fully on the next sync, and a converted track (recorded == cap) re-syncs
  to `copy` (a no-op — the idempotency guarantee). The source-side ffprobe
  tolerance is the add path's concern, not this one.
- **`deviceNative: true`.** The device already holds and plays this encoding.
  `preserve` keeps it untouched; `convert` reduces only when the recorded bitrate
  exceeds the cap.
- **Result:**
  - `{ action: 'transcode', bitrate }` → `cap-down` (re-encode down to the cap;
    the handler turns this into a `bitrateOverride` preset).
  - `{ action: 'copy' }` with `isBelowRaisedCap` → `below-cap` (report-only: a
    previously-reduced track — sync tag carries `low`, `medium`, or `high`
    quality, not `copy` — now sits below a raised cap; never auto-lifted).
  - `{ action: 'copy' }` otherwise → null (in sync).

`cap-up` is **never produced for lossy tracks.** A lossy track sitting below the
raised cap is `below-cap` (report-only), not `cap-up`. Re-encoding a lossy
source up cannot recover discarded information; the user can opt in via
`--force-transcode`.

**Routing the re-encode.** A `cap-down` result that fires must transcode a
normally-copied source, so `MusicHandler.planUpdate` overrides the routing
(`resolveUpgradeAction`): it builds a `transcode` action at the resolved preset
with `bitrateOverride = qualityChange.targetBitrate` (the resolved cap). The
re-encode reads the **source** file via `transferUpgradeToIpod` (run as an
`upgrade-transcode`).

**Idempotency.** The re-encode records the effective target in the device's sync
tag (`buildSyncTagForPreset`). The next sync reads `encoded === cap`, so the
track is left alone. Verified on both iPod (sync tag in the iTunesDB comment) and
mass-storage (sync tag in the sidecar/comment).

### Cap enforcement on the add path

The cap is not only a device-bound concern: the **add** path enforces it too,
via `MusicTrackClassifier` (`sync/music/classifier.ts`). When the source
bitrate is known and the axis resolves to `convert`, `resolveLossyReduction` is
called with the **ffprobe source bitrate** and the configured `[bitrate].tolerance`
(default 0.25). If the result is `{ action: 'transcode' }`, the classifier returns
a `transcode` action with `bitrateOverride = cap` — the same action a later
`cap-down` would produce. The written sync tag and the device-bound's expected
comparison both record that bitrate, so the next sync is a no-op (idempotent).

The add-cap is bypassed when the axis is `preserve` (device-native lossy sources
on `fast`/`portable` transfer modes, or when `[bitrate].reduce = never`), when
the source bitrate is unknown, and when there is no lossy cap (lossless target).

The single shared seam (`resolveLossyReduction`) means the add path and the re-sync
path use identical target-bitrate logic — a track is never decided one way on first
add and a different way on re-sync.

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

Because the device bound treats an untagged track as opted out, there is one
explicit, destructive path that establishes ground truth for such tracks:
`postProcessSyncTagsTranscode` (gated on `forceSyncTagsTranscode`). It runs as a
post-process pass **before** the tag-only `postProcessSyncTags`, so when both
flags are set it claims untagged tracks first (the transcode wins; no
double-processing).

For each matched track with **no** sync tag (`!syncTag` — a track podkit never
wrote), the pass routes it to a `quality-change` re-encode targeting the resolved
device quality. A track that carries any podkit sync tag is authoritative and is
left to the classifier. It reuses the existing executor: a lossy source with a cap
is re-encoded to `cap` via `resolveLossyReduction` (the same path as the add-time
cap); a lossless source is transcoded via the classifier's routing.
`transferUpgradeToIpod` then writes the authoritative sync tag. After adoption the
track carries a recorded bitrate, so the next ordinary sync sees it as tagged and
the adoption pass skips it — idempotent.

---

## 5. Vocabulary rename and current reachability

The unified quality classifier replaced four separate reason strings with a single
vocabulary. The four original reasons map directly to the old strings
(`source-down-suppressed` and `below-cap` are additionally reachable — see §1 and
§4):

| Old reason | `qualityChange.reason` | Update reason |
|---|---|---|
| `format-upgrade` | `lossless-boundary` | `quality-change` |
| `preset-upgrade` | `cap-up` (lossless only) | `quality-change` |
| `preset-downgrade` | `cap-down` | `quality-change` |
| _(new, report-only)_ | `source-down-suppressed` | _(report-only channel)_ |
| _(new, report-only)_ | `below-cap` | _(report-only channel)_ |

`source-improved` (the former "quality-upgrade" for a significantly higher-bitrate
lossy source) is removed in ADR-023: the source bound no longer produces upward
moves for lossy tracks — a changed/re-ripped source folds into content-change
detection (self-healing), and re-encoding a lossy track up cannot recover discarded
information.

**Untagged tracks are opted out.** There is no DB-bitrate fallback in either the
lossless or lossy device bound: a track without an authoritative sync tag returns
`null` from `classifyDeviceBound` and is left alone. `detectBitratePresetMismatch`
survives only for **video** preset-change detection (video carries no sync tags
and has a reliable container bitrate). Adoption of untagged audio tracks is the
explicit `--force-sync-tags-transcode` path (see §4).

---

## 6. Interactions

### With `--skip-upgrades`

`MusicHandler.detectUpdates` filters out **all** file-replacement upgrades when
`skipUpgrades` is set — every bound, including precondition reasons — for a purely
additive device. The bitrate baseline still backfills (it's metadata-only). This
is the master additive-only veto, which freezes all file replacement including
format and encoding-mode corrections.

### With `--force-transcode`

If the source is lossless and no file-replacement upgrade has been detected,
`MusicHandler.detectUpdates` injects `force-transcode` as the primary reason.
This bypasses the quality classifier entirely. For lossy sources, `--force-transcode`
also lifts any `below-cap` tracks — tracks that previously sat below a raised cap
and were only reported (not re-encoded) are force-transcoded to the current cap.

### With sync tags

A track with a `quality=copy` sync tag is recognized as in-sync by
`classifyDeviceBound`'s exact comparison. A track that podkit reduced (sync tag
carries `low`, `medium`, or `high`) and sits below a raised cap gets the
`below-cap` signal; a track copied as-is (`quality=copy`) that sits below the cap
does not — it was never reduced, so it is in sync.

---

## 7. Open work

- ~~**Untagged opt-out:** Drop the lossless DB-bitrate fallback.~~ Done: the
  sync tag is the sole quality truth, untagged audio tracks are opted out of the
  device bound, and `--force-sync-tags-transcode` is the explicit, destructive
  adoption path (see §4 and [ADR-022](../../../adr/adr-022-sync-tag-sole-quality-truth.md)).
- **Lossy encoding-mismatch eligibility:** A CBR/VBR flip deliberately does not
  re-encode lossy sources (ADR-023 §6 — a lossy→lossy degradation that can grow
  the file). If you change the encoding mode, future adds use the new mode; existing
  lossy copies stay at their recorded mode. Use `--force-transcode` to explicitly
  re-encode if needed.
- **Source lossy → lossless detection:** re-rip MP3→FLAC at the same target
  bitrate re-encoding up — out of scope here; the sync tag already carries source
  codec to make it possible later.

---

## 8. References

- `packages/podkit-core/src/sync/engine/upgrades.ts` — `classifyQualityChange`,
  `classifySourceBound`, `classifyDeviceBound`, `detectUpgrades`, `isBelowRaisedCap`,
  `DEFAULT_SOURCE_DOWN_TOLERANCE`
- `packages/podkit-core/src/sync/engine/lossy-reduction.ts` — `resolveLossyReduction`,
  `resolveReductionAxis`, `ReductionMode`, `ReductionAxis`, `CODEC_EFFICIENCY`
- `packages/podkit-core/src/sync/engine/upgrades.test.ts` — unit matrix for
  the unified classifier (incl. source-down tolerance + below-cap)
- `packages/podkit-cli/src/config/` — `[bitrate]` schema (`types.ts`),
  validation (`loader.ts`, rejects removed `sync`/`toleranceUp`/`toleranceDown`),
  and device → global → `auto`/`0.25` resolution (`resolve.ts`);
  `--bitrate-reduce`/`--bitrate-tolerance` in `commands/sync.ts`
- `packages/podkit-core/src/sync/music/handler.ts` —
  `detectUpdates` (match loop), `postProcessPresetChanges` (post-process pass),
  `postProcessBitrateBaseline`, `postProcessSyncTags`
- `packages/podkit-core/src/sync/music/transfer.ts` —
  `toDeviceTrackInput` (initial-add bitrate), `transferUpgradeToIpod`
  (upgrade bitrate resolution)
- `test-packages/e2e-tests/src/features/upgrades.test.ts` — E2E pins for
  the quality-change upgrade path
- `adr/adr-023-lossy-reduction-down-only.md` — ADR for the two-axis model
- `adr/adr-022-sync-tag-sole-quality-truth.md` — ADR for the sync-tag-as-truth decision
- `documents/principles/transcoding.md` — seven principles governing the lossy decision
- `documents/principles/transfer-modes.md` — transfer mode as the default for the reduction axis
