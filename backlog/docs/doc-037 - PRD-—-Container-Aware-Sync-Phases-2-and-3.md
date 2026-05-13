---
id: doc-037
title: PRD — Container-Aware Sync (Phases 2 and 3)
type: specification
created_date: '2026-05-13 15:23'
updated_date: '2026-05-13 15:26'
tags:
  - prd
  - codec
  - container
  - sync-planner
  - rebox
  - doctor
---
# PRD — Container-Aware Sync (Phases 2 and 3)

## Status

Proposed. Builds on Phase 1 (codec/container disambiguation) shipped May 2026 — see [Codec and Container Design Principles](doc-036).

## Background

Phase 1 split codec and container as concepts in the type system but stopped short of enforcing the distinction at sync time. After Phase 1:

- `AudioCodec` names the audio stream codec.
- `AudioContainer` and `CODEC_CANONICAL_CONTAINER` are declared but unread.
- `DeviceCapabilities.containerConstraints?` is parsed but not consulted by the planner.
- Source files are correctly identified as Vorbis vs Opus, but the planner's compatibility check still ignores the container axis.

Sync today therefore still has these gaps:

- A `.ogg` file containing Opus on a device whose preset declares `'opus'` (in its codec list) is now correctly classified — but a file containing FLAC inside an OGG container (OGG-FLAC) gets the file extension `.ogg`, probes as codec `'flac'`, and matches a device that declares `'flac'` in its codec list. The device probably won't play that combination (most FLAC-supporting devices expect FLAC in the native FLAC container). podkit will pass the file through unchanged and the device will silently skip it.
- A `.opus` file on a Rockbox device that supports opus is correctly classified, but if the user re-encoded the file with `.ogg` extension by hand, podkit treats it as opus-codec-in-ogg-container and the device may or may not accept it depending on firmware. There's no way to declare in a preset "this device accepts opus only in `.opus` extension, not bare `.ogg`."
- The user has no way to tell podkit "I've tested my device with FLAC-in-OGG, just accept it."

Phase 2 closes these gaps by wiring `containerConstraints` into the planner and adding a rebox transform. Phase 3 layers on observability (doctor pre-flight) and an evidence-driven preset improvement loop.

## Goals

1. The planner classifies passthrough eligibility on `(codec, container)` pairs, not just codec.
2. Non-canonical containers in non-portable transfer modes are silently reboxed into the canonical container at zero quality cost (audio stream copy).
3. Non-canonical containers in portable mode trigger an actionable refusal — see [PRD — Portable Transfer Mode](doc-038).
4. Users can opt their device into accepting non-canonical containers via `containerConstraints` overrides.
5. `podkit doctor` surfaces non-canonical containers in the library before sync, with per-device impact.

## Non-goals

- Adding Vorbis as a transcode output target. Opus already covers the open lossy slot.
- Modelling container-only codec edge cases (Speex, OGG-Theora). These are out of scope until a real device profile needs them.

## Design

### 2.1 Source container detection

`CollectionTrack` gains an explicit `container?: AudioContainer` field. Adapter responsibility:

- **DirectoryAdapter**: derive container from `fileType` (extension) using `EXTENSION_TO_CONTAINER`. No new IO cost. For files where the container is determined by stream codec inside the OGG family (`.ogg` extension always maps to OGG container regardless of stream codec), the field reflects the on-disk packaging.
- **SubsonicAdapter**: derive container from `suffix` using the same map. See [3.x — Subsonic stream-header probing (deferred)](#3x-subsonic-stream-header-probing-deferred) for the codec-disambiguation work that lives behind the same adapter boundary.

Mapper:

```ts
const EXTENSION_TO_CONTAINER: Record<AudioFileType, AudioContainer> = {
  mp3:  'mp3',
  flac: 'flac',
  m4a:  'mp4',
  aac:  'mp4',
  alac: 'mp4',
  ogg:  'ogg',
  opus: 'ogg',
  wav:  'wav',
  aiff: 'aiff',
};
```

### 2.2 Planner: codec + container compatibility

`isDeviceCompatible(track, capabilities)` checks both axes:

```ts
function isDeviceCompatible(track, capabilities): boolean {
  const codec = fileTypeToAudioCodec(track.fileType, track.codec);
  if (!codec) return false;
  if (!capabilities.supportedAudioCodecs.includes(codec)) return false;
  const acceptedContainers = resolveAcceptedContainers(codec, capabilities);
  return acceptedContainers.includes(track.container);
}

function resolveAcceptedContainers(codec, capabilities): AudioContainer[] {
  return capabilities.containerConstraints?.[codec]
    ?? [CODEC_CANONICAL_CONTAINER[codec]];
}
```

`categorizeSource(track, capabilities)` follows the same rule for `compatible-lossy` / `compatible-lossless`.

### 2.3 Rebox path

A new `buildReboxArgs(input, output, codec, container)` in `packages/podkit-core/src/transcode/ffmpeg.ts` produces stream-copy ffmpeg args that:

- Decode no audio (`-c:a copy`).
- Apply the same metadata, artwork, and ReplayGain handling as `buildOptimizedCopyArgs` (which it can compose with).
- Set the appropriate ffmpeg muxer for the canonical container.

Reboxing cost: dominated by file IO; on local SSD, ~50 ms per file. No quality loss — bit-identical audio stream.

### 2.4 Sync engine integration

Music handler dispatch when source codec is supported but container is not:

| Mode | Behavior |
|------|----------|
| fast | Rebox silently into canonical container. No warning. |
| optimized | Rebox silently. |
| default | Rebox silently. |
| portable | Refuse. See [Portable PRD](doc-038). |

Output file extension matches canonical container — `.ogg` source containing FLAC reboxes to `.flac`; `.ogg` source containing Opus reboxes to `.opus`; etc.

### 2.5 Doctor pre-flight

New diagnostic check `non-canonical-containers` in `packages/podkit-core/src/diagnostics/checks/`:

- Scans every configured collection for files whose `(codec, container)` pair is non-canonical.
- Reports per-device impact: which devices would silently rebox, which would refuse (in portable mode), which would accept (containerConstraints override).
- Output: per-collection counts + per-device verdict. Repairable only via user action; not auto-repairable.

Status: `pass` (no non-canonical files) / `warn` (non-canonical files present, default mode would rebox them) / `fail` (portable mode configured, non-canonical files would refuse to sync).

### 2.6 Preset evolution

Phase 3 adds `containerConstraints` to specific built-in presets only when firsthand-confirmed:

- **Rockbox**: builds vary. If firsthand testing confirms a build accepts FLAC-in-OGG (some do, some don't), declare `{ flac: ['flac', 'ogg'] }`.
- **Future devices**: documented in their `devices/<name>.md` profile first, mirrored in the preset.

Auto-recommendation (Phase 3, deferred unless useful): when doctor finds a non-canonical container pattern AND every other device in the user's library accepts it, suggest extending `containerConstraints` on the holdout.

### 3.x — Subsonic stream-header probing (deferred)

**Status:** deferred. Not part of the Phase 2 deliverable. Listed here so the limitation is documented and the future work has a known shape.

**Problem.** The Phase 1 Subsonic adapter (`packages/podkit-core/src/adapters/subsonic.ts`) uses the Subsonic API's `suffix` and `contentType` fields to infer codec. For `.ogg`/`.oga` files it checks whether `contentType` contains `"opus"`, treating that as the discriminator between Vorbis-in-OGG and Opus-in-OGG.

This check is incomplete. Navidrome and most Subsonic implementations set `contentType` from the **file's container MIME type** (`audio/ogg`), not from the audio stream codec inside the container. An Opus stream stored with `.ogg` extension on Navidrome therefore returns `contentType = "audio/ogg"` — the substring check does not fire, the codec resolves to `'vorbis'`, and the planner misclassifies the file. The Phase 1 code documents this limitation inline.

The local-file equivalent of this work (probing the OGG page headers to identify the codec) costs essentially zero — `music-metadata` already reads the first 4–8 KB of every local file during scan, including the OGG codec ID. For Subsonic sources there is no equivalent free signal: the file lives on a remote server, and reading its header requires a per-track HTTP round-trip.

**Proposed mechanism (when shipped).**

- At scan time, for each Subsonic track whose `suffix` resolves to a codec-ambiguous container (`.ogg`/`.oga`, possibly also `.m4a` when `contentType` does not disambiguate AAC vs ALAC), perform a `Range: bytes=0-4095` GET against the Subsonic `stream.view` endpoint.
- Parse the first OGG page set (or MP4 `ftyp` + `moov` atom for `.m4a`) to read the codec ID. Same machinery `music-metadata` uses locally; the OGG page parser in `node_modules/music-metadata/lib/ogg/` is reusable directly if we keep `music-metadata` as a dependency.
- Cache the result on the `CollectionTrack` so the planner has a definitive codec for ambiguous files.

**Cost.** Per-track round-trip latency dominates: ~50–200 ms per file against a remote Subsonic server, depending on bandwidth and server response time. For a 5,000-track library where 100 tracks are `.ogg`, that adds 5–20 s to scan time — only on `.ogg` files, run once per scan, cached. Sync time is unaffected.

**Trigger criteria for shipping this work.**

Any one of:

1. A user reports an Opus-in-`.ogg` Subsonic library being misclassified on a device with asymmetric Vorbis/Opus support (Echo Mini is the canonical example).
2. A Subsonic server implementation gains traction that routinely stores Opus inside `.ogg` (none known today; documented for future reference).
3. We add a Subsonic-like remote adapter (Plex, Jellyfin, custom HTTP) whose API gives even less codec-axis information.

Until then: the inline limitation comment in `subsonic.ts:getCodec` is the user-discovery surface. If a user reports the issue, the fix follows the mechanism above.

**Why deferred.**

- The misclassification only triggers under a narrow combination: Subsonic source + `.ogg` extension + Opus stream + device with vorbis-XOR-opus support. We have no evidence of this combination occurring in real user libraries.
- The default classification (`vorbis`) is the dominant case by ~99% on Subsonic libraries that podkit has seen in firsthand testing.
- Shipping speculative per-track HTTP probes risks degrading scan performance for the 99% case to fix a hypothetical 1% case.

**Acceptance criteria for the deferred work (when triggered).**

- [ ] Subsonic adapter performs a range-GET codec probe on `.ogg`/`.oga` (and any other configured ambiguous container) at scan time.
- [ ] Probe result cached per-track for the lifetime of the adapter session.
- [ ] Probe failures degrade gracefully — fall back to the Phase 1 suffix-and-contentType heuristic.
- [ ] Probe is configurable (per-collection `subsonic.probeAmbiguousContainers = false` opt-out for users on slow connections who accept the misclassification risk).
- [ ] Inline limitation comment in `subsonic.ts:getCodec` is removed or updated to reference this shipped behavior.

## Migration

No config migration needed — `containerConstraints` is an additive optional field. Users with non-canonical files will see silent reboxing in their next sync; the doctor check surfaces the change.

## Acceptance criteria

- [ ] `CollectionTrack.container` populated by both adapters.
- [ ] `isDeviceCompatible` consults `containerConstraints` with canonical fallback.
- [ ] `buildReboxArgs` produces correct ffmpeg invocations for each `(codec, container)` pair under test.
- [ ] Music handler dispatches to rebox for non-canonical containers in fast / optimized / default modes.
- [ ] Music handler refuses non-canonical containers in portable mode (per Portable PRD).
- [ ] `non-canonical-containers` doctor check produces correct verdicts for the integration test fixtures.
- [ ] Unit tests cover: OGG-FLAC source on FLAC-supporting device (reboxes to `.flac`); opus-in-`.ogg` source on opus-supporting device (reboxes to `.opus`); same files on a device with explicit `containerConstraints` (passes through unchanged).
- [ ] No regressions in existing planner / classifier / sync engine tests.

## Open questions

1. **Should `containerConstraints` accept "any" as a value?** e.g. `{ flac: 'any' }` for "accept FLAC in whatever container you give me." Useful for permissive Rockbox builds. Lean towards no — explicit list is clearer and forces device profile documentation.
2. **Doctor scope.** Should the non-canonical-container check run on every `podkit sync` automatically, or only on `podkit doctor`? Lean towards `doctor` only — sync paths are already crowded with classifier output.
3. **Sidecar concerns.** OGG-family files can have `.lrc` sidecar lyrics that share filename. Rebox renames the file extension; should the sidecar be renamed too? Out of scope for Phase 2 — flag in Phase 3 if lyrics sync ever lands.
4. **iPod containers.** iPod's codec model already constrains AAC and ALAC to `.m4a`. No new work needed for iPod under this PRD.

## Related documents

- [Codec and Container Design Principles](doc-036) — the principles this PRD operationalises.
- [PRD — Portable Transfer Mode (Strict Manual UX)](doc-038) — adjacent UX work using the same enforcement surface.
- `docs/reference/codec-support.md` — user-facing reference.

## Risk and rollback

- **Performance:** rebox is ~50 ms per non-canonical file on SSD. Library-wide impact is bounded by the count of non-canonical files, typically < 1% of any real library. No reason to expect noticeable sync-time regression.
- **Behavioral change for fast mode:** files that were silently passing through (and silently failing on device) will now silently rebox (and play correctly). This is strictly an improvement, but flag in release notes.
- **Rollback:** Phase 2 logic is gated entirely behind the planner integration in `isDeviceCompatible`. Reverting the planner change restores Phase 1 behavior.
