---
status: open
last-updated: 2026-05-11
importance: medium
links:
  - ../principles/track-identity-foundation.md
  - ../features/README.md
  - ../spikes/README.md
---

# How aggressive should default tag normalisation be?

> **The question.** Track-identity matching uses normalised tags as a
> fallback when MBIDs aren't available. How aggressive should normalisation
> be by default? Loose normalisation has more false positives (matching
> wrong tracks); strict normalisation has more false negatives (failing to
> match tracks that should match).

## Why this matters

Normalisation is the load-bearing detail of the track-identity matcher.
Real-world tag data is dirty:

- "The Beatles" vs "Beatles, The"
- "Track (Remastered 2009)" vs "Track"
- "Artist feat. Other" vs "Artist (feat. Other)" vs "Artist"
- Smart quotes vs straight quotes
- Trailing whitespace
- Case variations

Each normalisation rule is a small judgement call. Together they add up to
a default behaviour that determines how many user reports will say "podkit
matched the wrong track" vs "podkit failed to match a track that was
clearly the same."

## What needs deciding

For each normalisation candidate:

| Rule | Default? | Trade-off |
|------|----------|-----------|
| Unicode NFKC + casefold | likely yes | Standard practice; very low false-positive risk. |
| Strip leading "The " from artist | maybe | Very common rename; small risk of legit "The The" / "The The The" weirdness. |
| Collapse whitespace | yes | Almost no downside. |
| Strip parenthetical "(Remastered YYYY)" / "(Remix)" | risky | "Track" vs "Track (Live)" are arguably different recordings. |
| Normalise "feat." / "ft." / "featuring" | maybe | Common on hip-hop; some artists genuinely have "feat" in their name. |
| Strip leading/trailing punctuation | yes | Low risk. |
| Strip "&" vs "and" differences | risky | Changes meaning in band names ("Hall & Oates"). |
| Smart quote → straight quote | yes | Pure cosmetic. |

Each of these is a per-rule decision. We probably want a layered approach:
*always-safe* normalisations on by default, *risky* ones opt-in.

## What would resolve this

Two routes, both probably needed:

1. **A spike** to test the matcher against real-world libraries (mine and
   any volunteer corpora), measuring false-positive and false-negative
   rates per rule. See planned (not-yet-created) spike on track-identity
   matching evaluation.
2. **Config knobs** that let users override per-rule. Default settings
   driven by spike findings; users can dial up/down per their library
   quality.

## Related

- Connects to track-identity-foundation principle (the matcher).
- Connects to runtime-mismatches-not-config-errors principle (warnings on
  ambiguity rather than silent picks).
- A future track-identity sub-PRD will need to address this concretely.
