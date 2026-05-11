---
status: proposed
last-updated: 2026-05-11
links:
  - ../features/README.md
  - ../roadmap.md
  - ../user-stories.md
---

# Spike: file-size estimation accuracy

> **Question.** How accurate is podkit's current file-size estimation for
> transcoded outputs (FLAC → AAC, video transcodes), and how much can we
> improve it with reasonable effort?

## Why this matters

Capacity-fit selection is impossible without reliable estimates. Today's
estimation appears to systematically misjudge the size of transcoded files,
which contributes to:

- Sync overruns: device fills before the sync set is exhausted.
- Surprise failures mid-sync when the projected available space turns out
  to be wrong.
- User mistrust: estimates shown in `podkit sync --dry-run` don't match
  reality.

This is a Tier 0 (foundation) gate — without good estimates the selector
pipeline's "best-effort fit" mode can't be honest with the user.

## Specific sub-questions

1. **What is the current accuracy?** For a representative library, what is
   the distribution of actual_size / estimated_size across:
   - FLAC → AAC transcoding at common quality settings
   - WAV / ALAC → AAC
   - MP3 passthrough
   - Video transcoding (H.264/M4V) at common settings
2. **Where does the inaccuracy come from?** Which of these dominate:
   - Bitrate-only estimation ignoring container overhead
   - Constant-bitrate assumption when encoder uses VBR
   - Embedded artwork size variation
   - Ignored metadata (lyrics, etc.)
   - Over-conservative or over-aggressive defaults
3. **What's the cost/benefit of better estimates?** Options to evaluate:
   - Tuned bitrate × duration formula with corrections per source format
   - First-pass encode for a sample of files to calibrate
   - Pre-transcode cache (transcode once, hash, reuse) — eliminates
     estimation for cached items entirely
   - Confidence intervals exposed in the UX rather than point estimates
4. **What is "good enough"?** Define an accuracy target (e.g., 90% of files
   within ±10% of actual size; 95th percentile within ±25%) that the
   selector can rely on.

## Approach

1. Build a measurement harness: take a corpus of source files, transcode
   each at podkit's default settings, measure actual size, compare to
   what podkit's current estimator would have predicted.
2. Bucket the results by source format, container, bitrate, and any other
   plausibly-relevant factor. Identify dominant error sources.
3. Prototype 1–2 of the most promising mitigations from sub-question (3).
   Measure improvement.
4. Write up: what's broken, what works, what to recommend.

## Corpus

- The author's personal library (mixed FLAC, ALAC, MP3) as primary corpus.
- Test fixtures from `packages/test-fixtures/` for reproducibility.
- Optionally: synthetic edge cases (very short tracks, very long tracks,
  tracks with large embedded artwork, multichannel sources).

## Time-box

Target: ≤ 2 days of focused work.

If the accuracy gap turns out to be large enough that fixing it is itself a
project, the spike concludes with that *finding* and a recommendation to
open a backlog task — not by trying to solve everything in the spike.

## Findings

*(To be filled in when the spike runs.)*

## Actions

*(To be filled in when the spike concludes. Likely candidates: a
`features/estimation-accuracy.md` sub-PRD, possibly a separate sub-PRD for
the pre-transcode cache, possibly an ADR on the chosen estimation
approach.)*

## Related

- Selector pipeline (relies on estimates).
- Pinned-set-exceeds-capacity open question (estimation error can also
  trigger this case).
- US-18 (capacity-aware sync).
- US-19 (estimation transparency).
