---
id: doc-039
title: E2E Sync Matrix Testing Strategy
type: specification
created_date: '2026-05-28 07:51'
updated_date: '2026-05-28 21:00'
tags:
  - testing
  - e2e
  - matrix
  - sync
  - strategy
---
## Purpose

podkit's sync behaviour is the cross-product of many variables: source adapter, audio format, artwork placement, device, codec preference, quality preset, transfer mode, and the `--check-artwork` flag. The `art-matrix*` test files proved a powerful pattern for one slice of this space (artwork). This document defines how to generalise that pattern into a coherent, scalable e2e matrix-testing strategy — what the axes are, how to control the combinatorial explosion, what we assert, and how to organise it in the codebase.

This is a living strategy doc. The axis catalogue and reference model grow as podkit grows. Code is the source of truth for *what* is tested; this doc explains *why* and *how to extend*.

Related: [[doc-012]] (Transfer Mode Behavior Matrix), [[doc-014]] (Operation Types & Sync Tags), [[doc-036]] (Codec & Container Design Principles).

## The matrix pattern (what we already have)

`test-packages/e2e-tests/src/features/art-matrix*.test.ts` established a **rule-based prediction vs observation** harness:

1. A `predict(cell) → Expected` function encodes podkit's *believed* behaviour for every cell of an axis cross-product. Each cell carries a `reason` string documenting *why* the outcome is what it is.
2. A pass runner performs a real sync (and a second idempotency sync), then reads the device state and the dry-run operations to produce `Observed`.
3. The test asserts `predict === observe` cell-by-cell, emitting a precise diff on mismatch.

The key property: **the matrix is a frozen snapshot of current behaviour, and `predict()` is the assertion.** When a code change flips a cell, the test fails and forces the maintainer to either accept the change (update the rule) or revert the regression. There is no `expectedBroken` flag — bugs are encoded as current behaviour with a `reason` that says "bug", which doubles as a living regression catalogue (this is exactly how TASK-355's subtasks were filed and closed).

## Current-state audit

| Variable | Where exercised today | Matrix form? |
|---|---|---|
| artwork scenario × format × `--check-artwork` | `art-matrix.test.ts`, `art-matrix.docker.test.ts`, `art-matrix-change.test.ts` | ✅ yes |
| source adapter (directory / subsonic) | split across `*.test.ts` (host) and `*.docker.test.ts` | partial — duplicated rules across two files |
| codec preference | `codec-preference.test.ts` | ❌ imperative |
| quality preset | `preset-change.test.ts`, `mass-storage-sync.test.ts` | ❌ imperative |
| transfer mode | `mass-storage-sync.test.ts` | ❌ imperative |
| device model (iPod) | `models/model-tests.test.ts` (DB-init + capability report only, no sync) | ❌ not sync |
| mass-storage device (echo-mini / generic) | `mass-storage-sync.test.ts`, `codec-preference.test.ts` (bespoke TOML per file) | ❌ imperative, not an axis |

Two abstractions exist but the matrices don't use them: `TestSource` (`e2e-shared/src/test-source.ts`) and `IpodTarget` (`e2e-tests/src/targets/`). `IpodTarget` is iPod-only and hardwired to model `MA147`; `TargetOptions` carries only `name`. **Device is therefore not an axis anywhere in the sync matrices.**

Duplication: `art-matrix.test.ts` and `art-matrix.docker.test.ts` independently re-declare `FORMATS`, `FORMAT_TITLE`, `SCENARIO_ARTIST`, the two-sync idempotency loop, the op-classification sets, and the "Cell X/Y mismatched" diff formatter. The change matrix duplicates a third time.

> **Audit note (post-P4):** the rows above describe the pre-strategy state and are kept for historical context. As of P4 the device axis is live (codec + artwork concerns), codec preference and transfer mode are matrix axes, and the `art-matrix*` duplication is gone (shared `matrix/` machinery). See "Implementation status" below.

## The transcode-path reframe (a controlled axis, not an accident)

The artwork matrix's `format` axis secretly conflates two independent things: the container's embed mechanism **and** whether the track is copied or transcoded. Under the default `quality=high` on a 5G iPod, lossless formats transcode to AAC, mp3/aac direct-copy, ogg/opus transcode — so "embedded art survives" tests a *different code path per format*, invisibly. A transcode-only regression could hide behind a copy-path pass (or vice versa).

**Resolution: make transcode-vs-copy an explicit, controlled axis via rigid codec config.** Two pinned configurations expose both paths uniformly:

- **Copy-everything**: `quality=max`, lossless stack `['source']`, device that natively supports every source codec → every format direct-copies → asserts "art survives a byte-for-byte copy".
- **Transcode-everything**: `quality=high`, lossy `['aac']` → lossless + incompatible formats transcode to AAC → asserts "art survives FFmpeg re-embed".

This cleanly separates the **source-side question** (does the adapter *read* the embedded art?) from the **device-side question** (does the executor *preserve / re-embed* it through the chosen action?). The same reframe applies to any outcome that depends on the action taken, not just artwork.

## Two assertion dimensions

The matrix should assert two distinct kinds of thing. Today only the first exists.

### 1. Outcome assertions (have today)

"Did the right bytes/metadata land on the device?" — track present, `deviceHasArtwork`, idempotent second sync, codec on device, file extension, sync-tag fields. Observed by reading device state (`getTracks()`) and dry-run operations.

### 2. Decision assertions (partially realised in P4)

"Did podkit *make the right decision* given the inputs?" — e.g. *"with device D and codec config C and no explicit transfer mode, did podkit auto-select transfer mode M?"*, or *"did it choose direct-copy vs transcode for format F on device D?"*. This is about the **reasoning**, not just the artifact.

The codec concern (`matrix/codec-rules.ts`, landed in P4) realises a first slice of this from the **existing** JSON: it asserts the dry-run `operations[].type` (copy sub-type vs transcode) and the sync-wide resolved lossy codec (`json.codec`) — i.e. the codec podkit *chose*, read entirely from the plan with no transfer. Remaining decision surface still needs podkit changes:

- **Parse `--json` sync output.** The dry-run already emits `operations[]` with `type` and `reason`, and `codec`/`codecPreference`/`transferMode` at top level. Surfacing the *full* resolved config (per-track classification, auto-selected transfer mode) would let the matrix assert every decision directly.
- **Inspect sync tags on the synced output.** The `[podkit:v1 …]` comment tag records `quality`, `codec`, `transfer` (see [[doc-014]]). A test-side reader could assert the decision was persisted.
- **A dedicated `podkit sync --explain` / plan-dump mode.** Cleanest long-term machine-readable decision trace; largest podkit change.

The first slice of TASK-357 has landed: the dry-run `--json` now carries a top-level `decisions: { transferMode: {value, source}, lossyCodec, losslessCodec, quality, checkArtwork, ... }` block (provenance attribution via `'cli' | 'device' | 'global' | 'global-quality' | 'device-quality' | 'default'` `source`), and each `operations[]` entry carries `inputCodec` / `outputCodec`. The matrix `diffCell` already diffs object-valued fields structurally, so consumers compose the decisions block directly into the cell's `Expected` shape with no harness change. See [[doc-040]] for the PRD. Remaining work tracked under TASK-357 follow-ups: `'auto'` source attribution for planner-driven choices, sync-tag inspection helper, and a dedicated `--explain` mode.

## The reference model (capability composition, not name branches)

`predict()` must not grow a forest of `if (format === 'wav')` / `if (device === 'echo-mini')` branches — that explodes combinatorially as axes are added. Instead, express the rules as composition of small capability functions that mirror podkit's real semantics:

- `sourceEmbedsArt(scenario, format)` — does the source *file* carry embedded art? (a fixture property)
- `effectiveSupportedCodecs(capabilities, kind)` — the codecs the planner treats as device-native output (mass-storage drops wav/aiff; iPod exempt)
- `deviceAction(format, capabilities, pipeline, kind)` / `codecOutcome(...)` — `copy | transcode` + output codec/extension (a reference mirror of the real classifier)
- `copyOpKind(capabilities, transferMode)` — `direct-copy | optimized-copy` (embedded-art devices + `optimized` mode route through FFmpeg)
- `artworkReaches(sourceHadArt, capabilities)` — does art reach the device given its storage model?

`predict()` becomes a thin composition of these. This *is* a reference model of podkit's sync semantics; the matrix's whole job is to assert the real system matches the reference model. When the two disagree, exactly one of them is wrong — and the `reason` string says which we currently believe.

## Combinatorial control

The full cross-product is large: ~8 formats × 4 artwork scenarios × 2 adapters × 3+ devices × 3 quality × 3 transfer × 2 check-artwork ≈ 3,500 cells. We do not run all of it. Two mechanisms keep it tractable:

- **`skip(cell) → SkipDecision | null`** alongside `predict()` (landed in P4 on `MatrixDef`; skipped cells become `it.skip` and `runPass` consults the same predicate to avoid syncing them). The decision carries a **`kind`** that separates *permanent* prunings from *deferred work*:
  - `skipRedundant` / `skipImpossible` / `skipEnvGated` (`kind` = `redundant`/`impossible`/`env`) — **structural**. The cell is not meaningful to assert, ever; these never become work.
    - *Impossible*: sidecar-only artwork on an adapter that can't read sidecars.
    - *Redundant*: transfer mode only changes the copy op-type on database-artwork devices; don't cross it elsewhere.
    - *Env-gated*: subsonic needs Docker; real device needs hardware.
  - `skipBug(reason, ref)` (`kind` = `bug`) — **deferred work**. The cell could be asserted but podkit is currently broken for it, so it's fenced rather than failing the suite. Bug skips render as `[BUG] <ref>` in the runner and are greppable as `skipBug(` in the source, so deferred work is always present, counted, and documented — never a silent gap. A green run whose skips are *all* structural means nothing is hidden behind a pass.
- **Concern-scoped axis subsets.** Each matrix file fixes most axes and varies only the few relevant to its concern. The full product is never materialised — each concern picks its slice.

## Device axis: a generalised SyncTarget

The prerequisite for device-as-an-axis is replacing the iPod-specific `IpodTarget` with a `SyncTarget` that covers both iPod and mass-storage devices:

- `kind: 'ipod' | 'mass-storage'`, `model?`, and a `capabilities` snapshot (supported codecs, artwork storage model, max artwork resolution, video support).
- A normalised `getTracks(): TrackInfo[]` that works for both backends — iPod via `@podkit/gpod-testing`, mass-storage via filesystem walk + ffprobe.
- Construction from the existing capability sources: `@podkit/devices-ipod` generation tables for iPod, `@podkit/devices-mass-storage` `BUILT_IN_PRESETS` for mass-storage.

This landed in P3 (`targets/sync-target.ts` + `targets/mass-storage.ts`). P4 surfaces it as a matrix axis (`matrix/devices.ts`): `predict()` keys off `target.capabilities` rather than a hardcoded model.

## Proposed code organisation

Split by **concern, not by adapter**. Extract the shared machinery so rules live exactly once. As-built after P4:

```
test-packages/e2e-tests/src/matrix/
  axes.ts             # typed axis enums (Scenario, Format) + cartesian helpers
  devices.ts          # device axis: DeviceSpec (id + raw caps + fresh-target factory) + deviceAddressing
  harness.ts          # defineArtworkMatrix(): per-pass beforeAll, op-classify, diff-report, typed skip()
  reference-model.ts  # capability fns: sourceEmbedsArt, effectiveSupportedCodecs, deviceAction, codecOutcome, copyOpKind, artworkReaches
  README.md           # philosophy, axis meanings, skip taxonomy, how to add an axis
  artwork-rules.ts    # artwork concern: predictDirectory (device-swept) / predictSubsonic / predictChange + skipArtworkCell — imported by host + docker files
  codec-rules.ts      # codec concern (decision matrix): predictCodec + observeCodecMatrix + skipCodecCell
features/
  art-matrix.test.ts        # host directory artwork, device axis [ipod, echo-mini, generic]
  art-matrix.docker.test.ts # subsonic artwork (Navidrome)
  art-matrix-change.test.ts # artwork change-detection
  codec.test.ts             # codec decision matrix (device × format × codec-config × transfer-mode)
```

`skip()` lives on `MatrixDef` (no separate `skip.ts` was needed). Transcode-fidelity remains future work.

Two structural notes:

- **The docker filename gate is a hard constraint.** The test runner splits on the `*.docker.test.ts` suffix (`--exclude` for host, `--pattern` for docker). Subsonic cells therefore *cannot* share a file with host cells. Keep host/docker as two thin test files that import the same `-rules.ts` — this removes rule duplication while respecting the runner.
- **`harness.ts` owns the duplicated machinery**: the cartesian walk, the fresh-sync sequence, the op-classification sets, and the `Cell X/Y mismatched expectations` formatter.

## Concrete test gaps to close (with existing variables)

Independent of the reorg, these are real missing cells:

1. **Transfer mode × artwork** — `optimized` strips embedded art on DB-artwork devices; `portable` preserves it. ✅ done (P5, `art-matrix-transfer.test.ts`). The strip is in the *file*, not the iTunesDB, so it needed a new device-file reader (`matrix/device-artwork.ts`): the matrix asserts `dbHasArtwork` stays true while `fileHasArt` follows the strip rule (`fileArtworkSurvives`).
2. **Copy-path vs transcode-path × artwork** — the rigid-codec reframe above. ✅ done (P2 `pipeline` axis).
3. **`artwork-removed` transition** — the change matrix covers added/updated but never source-loses-art. ✅ done (P5, `transition` axis in `art-matrix-change.test.ts`). Finding: removal fires `artwork-removed` **hash-free** on both passes — `hasArtwork` is a metadata field the self-healing diff compares (ADR-009) — whereas an *update* (same presence, changed bytes) still needs `--check-artwork`. The matrix also applies the change for real and re-runs: every transition **converges** (a third dry-run is clean — no churn loop).
4. **Artwork resize** — embedded-art devices resize; iPod has `artworkMaxResolution`. ✅ done (P5, `art-matrix-resize.test.ts`, hires 1024px fixture, swept across **all three transfer modes**). Embedded device (`generic`, max 500) downscales the file cover to 500 in every mode; iPod leaves the *file* at source where it survives (portable / fast direct copy) and resizes only the iTunesDB thumbnail (read back via `@podkit/ipod-db`, bounded by its 320 max in every mode — empirically 200/100). Confirms transfer mode does not change the resize *size*.
5. **Compilation / album-artist × album-cache** — the album cache keys on `(artist, album)`; various-artist compilations are a collision/split risk. ✅ done (P5, `art-matrix-compilation.test.ts`). Finding: it's a **split, not a collision** — each differing-artist track forms its own single-element candidate group, so a bare track inherits no sibling cover (anchors get art, bare WAV/OGG/Opus do not). No-collision is **proven by bytes, not inferred**: each anchor carries a distinct cover colour and the matrix decodes its iTunesDB thumbnail (`@podkit/ipod-db`) and classifies the sampled colour back to that track's own cover — a coarser key that bled art across artists would flip the cell. (File-level hashing would not work: the file cover comes straight from the source, bypassing the cache; the iTunesDB thumbnail is the cache's actual output.) Pins the deliberate `(artist, album)` keying from TASK-355.03.

## Mass-storage sync gaps (discovered during P4)

Adding the device axis to real-sync matrices surfaced reproducible podkit execution/convergence bugs on mass-storage devices. They are **not** test bugs — the artwork matrix keeps the affected cells *present* but fences them with typed `skipBug` cells (rendered `[BUG]` in the runner, counted, never silently dropped); the codec concern stays on the dry-run plan and so never hits them.

> One issue found during P4 turned out to be a **test-helper bug, not a podkit bug**, and was fixed rather than skipped: `MassStorageTarget.getTracks` read ffprobe tag keys case-sensitively, so FLAC files copied by FFmpeg — which writes Vorbis comment fields upper-case (`TITLE`/`ARTIST`) — matched nothing on the device. The helper now lower-cases tag keys (Vorbis field names are case-insensitive by spec).

1. ~~**OGG optimized-copy aborts on embedded-artwork mass-storage devices.**~~ **Closed by TASK-358.01.** `OptimizedCopyFormat` now covers `'vorbis'` (routes OGG sources to FFmpeg `-f ogg` instead of falling through to `-f ipod`), and per-track failures no longer abort the rest of the sync. echo-mini's full artwork product is now asserted (no `ms-echo-mini` skipBug fences remain). The TASK-380 save-failure matrix re-surfaced this against a stale May-26 VM binary (filed as TASK-394, closed obsolete after the VM-build-staleness fix shipped — TASK-358.01's repair was already on `main`).

2. **OGG/Opus → AAC never converges on mass-storage.** On `generic`, OGG and Opus sources transcode to AAC and then re-fire `add-transcode` on **every** subsequent sync (confirmed across 4 syncs). The incompatible-lossy → AAC output is not matched back to its source on re-scan. The artwork matrix `skipBug`s OGG/Opus on mass-storage.

3. **`prefer-copy` (quality=max) does not converge on mass-storage.** The second sync re-fires `preset-upgrade` for several tracks. This is a quality/preset-convergence defect, **not** an artwork one: the artwork matrix asserts `prefer-copy` on mass-storage and passes (it does not assert preset idempotency), so it is *not* skipped there. The loop is currently uncaught by any matrix — a dedicated preset-convergence check (or a mass-storage arm of `preset-change.test.ts`, which is iPod-only today) would catch it.

## Migration plan (phased, de-risked)

1. **Strategy doc + backlog** (this doc + tasks). Align before code. ✅
2. **Extract `harness.ts` + `reference-model.ts` against the EXISTING artwork matrix.** Prove cell-for-cell parity. ✅ (TASK-356.01)
3. **Add the rigid-codec transcode-vs-copy axis** to the artwork concern. ✅ (TASK-356.02)
4. **Generalise `SyncTarget`** (iPod + mass-storage, capability-carrying). ✅ (TASK-356.03)
5. **Add device + transfer-mode axes**; migrate `codec-preference` into a concern matrix. ✅ (TASK-356.04 — see "Implementation status").
6. **Close concrete artwork gaps** (transfer×artwork, artwork-removed, resize, compilation). ✅ TASK-356.05.
7. **Future: decision assertions** — partially realised (codec `json.codec`); rest gated on richer `--json` / plan-dump. ◻ TASK-357.

## Implementation status (P4 landed)

- **Device axis** (`matrix/devices.ts`): `DeviceSpec` over `[ipod-MA147, ms-echo-mini, ms-generic, ms-rockbox]`, each carrying raw `capabilities` and a fresh-target factory; `deviceAddressing()` resolves `--device <path>` (iPod) vs `--device <name>` + `[devices.*]` stanza (mass-storage).
- **Codec concern** (`matrix/codec-rules.ts`, `features/codec.test.ts`): a **decision matrix** over device × format × codec-config (`opus-first`/`aac-first`) × transfer-mode. Reads the dry-run plan only — asserts the `add-*` op type and resolved lossy codec (`json.codec`). 80 cells asserted, 112 pruned (all structural `skipRedundant`). Subsumes `codec-preference.test.ts` at the decision level (opus selection on rockbox, aac fallback elsewhere).
- **Transfer-mode axis**: `fast | optimized | portable`, asserted via `copyOpKind` (direct vs optimized copy). Pruned to the device where it differs (database-artwork iPod) via `skipRedundant` to avoid redundant syncs.
- **Typed `skip()`**: `MatrixDef.skip` returns a `SkipDecision` with a `kind`. `redundant`/`impossible`/`env` are *structural* (permanent, never work); `bug` (via `skipBug(reason, ref)`) is *deferred work*. The runner tags them `[skip:kind]` vs `[BUG] <ref>`; the source is greppable for `skipBug(`. This is the dividing line that lets a developer see, at a glance, that a green run with only structural skips hides nothing.
- **Artwork matrix device axis**: `art-matrix.test.ts` sweeps `[ipod-MA147, ms-echo-mini, ms-generic]` (224 cells asserted, 160 `[BUG]`-skipped). `predictDirectory` keys off `target.capabilities`. echo-mini stays *in* the axis with all its cells `skipBug`-fenced (the OGG abort makes the whole sync unobservable) rather than being dropped, so the deferred coverage is visible. generic's OGG/Opus cells are `skipBug` (#2); `prefer-copy` is asserted (its bug is out of artwork's concern). `observeStaticArtwork`/`createPipelineConfig` were generalised for mass-storage addressing; the subsonic docker matrix was re-verified green.
- **`codec-preference.test.ts`** reduced to a physical-output smoke (real `.opus` transcode to disk + codec-change re-sync) — the part the decision matrix can't assert from a plan. **`mass-storage-sync.test.ts`** kept as structural/execution smoke (relocation, pathTemplate, delete, orphan repair, compilation, portable tags) — it was never a codec/artwork matrix in disguise.
- **`effectiveSupportedCodecs`**: the mass-storage WAV/AIFF-output exception (`MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS`) is mirrored in the reference model; iPod is exempt.
- **Test-helper fix**: `MassStorageTarget.getTracks` now reads ffprobe tag keys case-insensitively (FFmpeg writes FLAC Vorbis tags upper-case). This was a harness bug masquerading as a missing-track failure; fixed, not skipped.

## Implementation status (P5 landed)

P5 (TASK-356.05) closed the four concrete artwork gaps. Two of them needed a
**new observation dimension** — the bytes of the *file written to the device* —
because the relevant behaviour is invisible to both the dry-run plan and
`TrackInfo.hasArtwork`:

- **Device-file artwork reader** (`matrix/device-artwork.ts`): `probeFileArtwork`
  ffprobes a device's audio files for attached-picture presence + pixel
  dimensions (works on iPod and mass-storage alike — podkit writes the title/
  artist tags into the file, so tag-matching needs no knowledge of libgpod's
  hashed filenames); `probeIpodDbArtwork` reads the iTunesDB ArtworkDB thumbnail
  *sizes* and `probeIpodDbArtworkColor` decodes the thumbnail and samples its
  centre *colour*, both via `@podkit/ipod-db`. All independent of podkit's write
  path (the same anti-mutual-masking rationale as `MassStorageTarget.getTracks`):
  podkit writes via libgpod (C), these read back via ffprobe / a separate TS
  parser. `SyncTarget` gained `musicRoot()` to point the reader at the files.
- **#1 transfer-mode × artwork** (`art-matrix-transfer.test.ts`, iPod): asserts
  the gap between the two artwork signals — the iTunesDB always keeps the cover
  (`dbHasArtwork`), while the *file* is stripped per mode (`fileArtworkSurvives`:
  `portable` keeps, `optimized` strips everywhere, `fast` keeps copies / strips
  transcodes — doc-012).
- **#2 artwork-removed** (`art-matrix-change.test.ts`, `transition` axis):
  removal fires `artwork-removed` hash-free on both passes (metadata `hasArtwork`
  comparison, ADR-009); an update needs `--check-artwork`. The change is then
  applied for real and a third dry-run confirms it **converges** (no churn loop).
- **#3 resize** (`art-matrix-resize.test.ts`, hires 1024px fixture, all three
  transfer modes): embedded device downscales the file cover to
  `artworkMaxResolution` in every mode (`expectedFileArtworkSize`); iPod leaves
  the file at source where it survives and resizes only the iTunesDB thumbnail
  (asserted ≤ its max via `probeIpodDbArtwork`, in every mode).
- **#4 compilation** (`art-matrix-compilation.test.ts`, iPod): the album cache's
  `(artist, album)` key makes various-artist compilations *split* (no
  cross-artist cover sharing), not collide — bare tracks are orphaned. No
  collision is proven by decoding each anchor's iTunesDB thumbnail and matching
  its sampled colour back to that track's own distinct cover
  (`probeIpodDbArtworkColor`). Pins the deliberate TASK-355.03 keying.
- **Fixtures added**: `multi-format-embedded-stripped` (embedded tags, no art),
  `multi-format-compilation` (distinct per-track artist, shared album/
  album_artist/compilation, art only in the embed-capable anchors), and
  `multi-format-embedded-hires` (1024px cover). The generator gained per-track
  `artistFor`, shared-`album`/`albumArtist`/`compilation`, per-track `embedTrack`,
  and `coverSize` options.

Known limitation surfaced (not yet a task): a compilation track that carries no
embedded art of its own gets no cover, because the `(artist, album)` key denies
it a differing-artist sibling's cover. The all-anchor-embed fixture makes this
visible (bare WAV/OGG/Opus cells); whether compilations *should* share art
across artists is a product decision, not pinned as a bug.

## Implementation status (TASK-142 landed: adapter artwork fallback)

TASK-142 closed the **source-side** sidecar gap that the existing matrices documented but couldn't yet exercise:

- **`CollectionAdapter.getArtwork(item): Promise<Buffer | null>`** — new optional seam on the adapter interface. The executor's `pipeline.transferArtwork` consults it after the album-level embedded extraction returns null. Positive results are promoted to the same `AlbumArtworkCache` entry so siblings on the same album share a single fetch.
- **DirectoryAdapter** detects peer `{cover,folder,front,album}.{jpg,jpeg,png}` (case-insensitive, memoised per album dir). `parseFile` flips `hasArtwork=true` when a sidecar is found with no embed; `getArtwork(track)` returns the sidecar bytes. Under `--check-artwork` the sidecar bytes are hashed too.
- **SubsonicAdapter** stores a per-track `coverArtId` map during `mapSongToTrack`; `getArtwork(track)` calls `getCoverArt`, filters the Navidrome placeholder, and caches bytes per cover. The placeholder probe moved out of the `--check-artwork` gate and into every `connect()` so fast-mode syncs cannot leak the placeholder via the new fallback path.

**Reference-model branches (`reference-model.ts`):**

- `artworkPrimary(capabilities)` returns `'embedded' | 'sidecar' | 'database'` from `artworkSources[0]`. Throws on unrecognised values rather than silently defaulting.
- `fileArtworkSurvives` now has explicit branches for embedded, sidecar (mirrors database — observational per the JSDoc caveat), and database.
- `expectedSidecarSize(sourceSize, capabilities)` consumed by the resize-matrix's sidecar predictions (TASK-370 landed).

## Implementation status (TASK-372/371/370 landed: device-side write dispatch)

The TASK-142 source-side adapter fallback exposed three device-side gaps that landed sequentially in three commits:

**TASK-372 (commit 50a6247f) — `DeviceTrack.artworkSink` primitive.** `DeviceTrack` gains `readonly artworkSink: 'database' | 'embedded' | 'sidecar' | 'noop'`. IpodTrack hardcodes `'database'`; MassStorageTrack derives from `capabilities.artworkSources[0]`. `MusicPipeline.transferArtwork` switches on the sink — no extension-based branching, `isOggExtension` guard removed from the executor (still exported for matrix predicate reuse). The 'noop' branch returns undefined; callers suppress `syncTag.artworkHash` so the documented churn loop (doc-041 §3.6) breaks at its root. Sonnet review caught + deleted three dead methods (`executeOperation`/`executeTranscode`/`executeCopy`) that would have silently re-introduced the churn loop if re-wired.

**TASK-371 (commit fa8f33f2) — embed write unified via the 'embedded' sink.** Closed as side-effect of TASK-372. The taglib-sharp `writePicture` path handles every container (FLAC/MP3/M4A/AIFF/WAV/OGG/Opus); the OGG-only carve-out in `pipeline.transferArtwork` is gone. `MassStorageTrack.setArtworkFromData` remains a no-op on the interface but is unreachable from the live pipeline.

**TASK-370 (commit 9465faf9) — 'sidecar' sink wired through MassStorageAdapter.** `writeSidecar(track, imageData)` queues per-album-dir into `pendingSidecarWrites`; `save()` Stage 4 flushes via `Promise.allSettled` + typed `SidecarWriteError` (collect-and-aggregate — per-album failures don't black-hole the rest of the library). Atomic writes via tmp + fsync + rename (doc-041 §7.2). `ms-rockbox` added to `art-matrix-transfer` (24 → 48 cells) and `art-matrix-resize` (45 → 60 cells); both assert new `sidecarPresent` + `sidecarSize` signals probed via new `probeSidecarArtwork(musicRoot, albumDir)` helper.

**Matrix predictions after this sequence:**

- `predictDirectory` collapsed to a single branch: `deviceHasArt = artworkReaches(albumHasArt, caps)`. The old iPod-vs-mass-storage / OGG-carve-out tree is gone; the artworkSink dispatch makes every embed-capable / database / sidecar device a peer.
- `predictSubsonic`'s JSDoc still notes the iPod-only assumption — `ScenarioFormatCell` has no device axis. TASK-373 closed obsolete on arrival; the predictor would need the same single-branch logic if a future docker matrix sweeps mass-storage Subsonic.
- `skipArtworkCell` returns null for every currently-swept cell. The TASK-370 fence has been fully retired (was 28 → 0). Function signature retained for future regressions.

**Follow-ups anchored to doc-041:** TASK-374 (device-profile sidecar filename preset), TASK-375 (podkit doctor orphan sidecar cleanup), TASK-376 (atomic on-file writes for picture writes — sidecars got the treatment, picture writes still need it), TASK-377 (normalise picture-write flush to match the sidecar collect-and-aggregate shape), TASK-378–381 (free-space probe / device lock / save-failure matrix / IpodAdapter typed result).

## Tradeoffs & risks

- This refactors working, green tests. Payoff: adding an axis becomes declarative instead of a new bespoke file. Risk: churn on passing tests + an abstraction that over-fits if axes are guessed wrong. **Mitigation: build the harness against the existing artwork matrix first (phase 2) and prove cell-for-cell parity before adding anything.**
- The reference model is a second implementation of podkit's classifier logic. If it drifts from the real classifier it produces false failures. **Mitigation: keep it minimal and capability-driven; where feasible, have the reference model and the real code share the same capability tables (`@podkit/device-types`, `@podkit/devices-*`).**
- Combinatorial blow-up if `skip()` is under-specified. **Mitigation: concern-scoped subsets; never materialise the global product.**
- The codec concern asserts decisions from the **dry-run plan**, not the executed transfer. This is deliberate (fast, immune to unrelated execution bugs like the OGG abort), but means physical-output coverage must come from the smoke tests (`codec-preference.test.ts`, `mass-storage-sync.test.ts`). Keep both dimensions in mind when adding cells.
- **A green suite is not by itself "no bugs."** Known bugs live as `[BUG]`/`skipBug` cells, by design. The honest signal is: suite green **and** zero `[BUG]` skips **and** all remaining skips structural. Read the skip kinds, not just the pass count.

## Open questions

- Decision-assertion mechanism: richer `--json` vs sync-tag inspection vs `--explain` plan-dump — which does podkit adopt? (TASK-357; likely the JSON route is cheapest first.)
- Should the reference model live in `e2e-tests` or be promoted to a shared package so unit tests can reuse it?
- Real-hardware (`IPOD_TARGET=real`) and VM (`e2e-vm-tests`) targets — do they participate in the same matrix harness, or stay separate smoke suites?
- Should the mass-storage sync gaps above get dedicated bug tasks, and should the OGG/vorbis optimized-copy path be a follow-up to TASK-198?
