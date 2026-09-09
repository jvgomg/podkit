---
id: TASK-502
title: >-
  Re-validate the AAC bitrate caps against real music, across encoders and
  machines
status: To Do
assignee: []
created_date: '2026-09-09 19:22'
updated_date: '2026-09-09 21:15'
labels:
  - transcoding
  - testing
  - correctness
  - human-in-the-loop
dependencies:
  - TASK-499
references:
  - docs/adr/adr-023-lossy-reduction-down-only.md
  - docs/adr/adr-010-quality-preset-redesign.md
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/transcode/ffmpeg.integration.test.ts
  - packages/docs-site/src/content/docs/reference/quality-presets.md
priority: high
type: task
ordinal: 281000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Needs a human in the loop.** task-499 fixed the quality-preset ceiling on native `aac` and `libfdk_aac`, but the evidence underneath it is thinner than the fix deserves, and one of the calibrations exists only to make a test pass. Before anyone treats "the preset is a ceiling" as settled, it should be re-derived against real music on real machines.

## What is actually unverified

**The `aac_at` allowance was chosen to make the test pass.** `ffmpeg.integration.test.ts`'s `ceilingFor()` grants non-native encoders 15% headroom over the cap. That number was not measured — it was picked as "enough to cover `aac_at`'s known overshoot", because `aac_at` maps a target bitrate onto a coarse quality index and `medium` lands near 200 kbps against a 192 cap. So on macOS the preset is a target, not a ceiling, and the size of the miss is guessed.

**Every calibration in the tree comes from a handful of files.** `aacAtQualityFromBitrate`'s nine-point scale is documented as measured on "CHVRCHES, Foals, Mk.gee". `libfdkVbrFromBitrate` uses FFmpeg's published per-channel bands, not anything we measured. task-499's own native-`aac` numbers came from two fixtures plus synthetic pink noise — and the calibration it *replaced* was wrong precisely because it had been measured on a single mono fixture nobody noticed was mono.

**Pink noise is a worst case, not a representative one.** The ceiling suite encodes incompressible noise so the encoder spends every bit its rate control allows. That is the right shape for "does the cap hold", and the wrong shape for "what does a user's library actually come out at". Both questions matter and only one is covered.

**Nothing tests across machines.** ADR-022 makes the sync tag the sole quality truth and it records the preset *name*, so a library synced from a macOS laptop (`aac_at`) and later from a Linux desktop (native `aac`) sees no reason to re-encode anything — even though the two encoders produce materially different files at the same preset. Whether that is correct, tolerable, or a silent quality inconsistency has never been decided, let alone tested.

**Nothing pins an FFmpeg version.** task-500 already flagged this: `checkFfmpeg` is a bare `ffmpeg -version` probe. An encoder's rate control can change between FFmpeg releases and no test would notice.

## Shape worth considering (not settled)

- **A royalty-free corpus spanning genres** — something dense and loud, something sparse and quiet, something with heavy transients, something near-silent, mono and stereo, and at least one already-lossy source. CC0 / CC-BY sources exist; licensing and repo size both need a decision, and a large binary corpus probably does not belong in git.
- **Golden masters contributed per system.** Encode the corpus on each machine/encoder/FFmpeg combination we care about and record the measured bitrates as a checked-in baseline — a table of numbers, not the audio. A contributor on macOS with `aac_at`, someone with a `libfdk_aac` build, and CI's conda FFmpeg would each contribute a column. Drift then shows up as a diff rather than as a mystery.
- **A cross-machine incremental-sync test.** Sync a library as encoder A, then re-sync as encoder B against the same device, and assert what should happen — which is the part that needs deciding before it can be written.
- **Documented caveats per encoder and version**, so `quality-presets.md` stops implying uniform behaviour across a surface that is not uniform.

## Why a human

The corpus choice, the licensing, whether the cross-machine inconsistency is a bug or an accepted trade-off, and how much quality to sacrifice on `aac_at` to make its cap real — none of these are decidable from measurements alone. The measuring can be automated; the judgement cannot.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A royalty-free, genre-spanning audio corpus is selected, its licensing recorded, and a decision made on where it lives (in-repo, fetched on demand, or generated)
- [ ] #2 Measured bitrate-vs-cap is re-derived per preset per encoder against that corpus, not against pink noise or a single fixture, and the numbers are recorded
- [ ] #3 The 15% `ceilingFor` allowance in ffmpeg.integration.test.ts is replaced by a measured figure, or `aac_at`'s mapping is changed so the cap actually holds and the allowance drops
- [ ] #4 A golden-master baseline format exists that contributors on different systems can add a column to (measured numbers, not audio), and drift against it fails a test
- [ ] #5 A decision is recorded on what should happen when a library is synced from two machines with different AAC encoders, and a test pins it
- [ ] #6 The FFmpeg/encoder version an assertion assumes is declared by that assertion rather than left implicit (closes the gap task-500 AC #4 raises)
- [ ] #7 quality-presets.md documents the per-encoder and per-version caveats, replacing any wording that implies uniform behaviour
- [ ] #8 A human has reviewed and signed off the corpus, the measured caps, and the cross-machine decision
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: Claude Opus 5
created: 2026-09-09 21:15
---
Findings from task-500 that belong here rather than there.

**The 15% allowance now has two copies.** task-500 added `aacCeilingKbps(cap, encoder)` to `test-packages/e2e-shared/src/audio-probe.ts` so the e2e suite can bound a measured bitrate per encoder instead of hard-coding `< 170` against a 128 kbps cap. It deliberately mirrors `ceilingFor()` in `ffmpeg.integration.test.ts`, including the unmeasured `cap * 1.15` for `aac_at`/`libfdk_aac`. AC #3 must replace **both**; they are documented as deliberate duplicates (core cannot depend on a test package).

**Native `aac` ABR overshoots `-b:a` on mono, and that is not in the record anywhere.** Measured on the mise-pinned conda FFmpeg 9.0.1, pink noise decoded from a 320 kbps MP3, ffprobe stream bitrate:

| `-b:a` | mono | stereo |
|---|---|---|
| 96 | 97 | 95 |
| 128 | 125 | 128 |
| 160 | 160 | 159 |
| 192 | **210** | 192 |
| 200 | **215** | 199 |
| 256 | 228 | 233 |

So mono can land ~10% over the request while stereo tracks it to within 1%. task-500 dealt with this by making every e2e fixture stereo, which is right for the e2e suite but means the `cap + 1` native-`aac` ceiling is only established for stereo. Real music is stereo, but a user's mono rip is not, and nothing warns them. Worth a row in the corpus per AC #1 and a decision on whether mono needs its own ceiling.

**libopus undershoots `-b:a` on synthetic noise badly enough to distort a test's premise.** `lossy-preserve-efficiency.test.ts` generates a '128 kbps' Opus source; podkit probes it at ~69 kbps, so both the preserve and convert targets come out about half their nominal values. The *ratio* survives (measured 93/69 = 1.35 against the efficiency table's 1.33), which is all that test asserts, but any absolute number taken off that fixture is meaningless. Another argument for AC #1's real corpus.

**One e2e cap assertion still does not bind.** `lossy-preserve-efficiency.test.ts` asserts the efficiency-lifted preserve target stays under the `high` cap, but on this fixture the lifted target never reaches 256, so the clamp never fires and the assertion cannot fail. Making it bind needs a source whose lifted target crosses the cap, which on synthetic noise depends entirely on how libopus rate-controls it — i.e. it needs the real corpus. The clamp itself is covered at the unit level in `lossy-reduction.test.ts`; this is about the e2e path.

**AC #6 cross-reference.** task-500 settled the encoder half of that question — see `docs/architecture/conventions.md` §6a, which now requires an encoder-calibrated assertion to derive its bound from the resolved encoder. The FFmpeg *version* half is untouched and remains this task's.
---
<!-- COMMENTS:END -->
