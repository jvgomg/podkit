---
id: doc-019
title: 'Design Exploration: Agent-Guided Clean Artists Configuration'
type: other
created_date: '2026-03-23 18:37'
---
# Design Exploration: Agent-Guided Clean Artists Configuration

## Purpose

This document captures the design thinking behind an agent workflow for helping users configure podkit's `[cleanArtists]` transform. It is intended to help a documentation writer understand everything that needs to be considered, identify unknowns that need resolution, and ultimately produce an agent guide that enables effective, repeatable sessions.

The document is based on a real session where an agent helped a user analyse and improve their clean artists configuration against a 2,821-track Navidrome collection.

---

## 1. What Is the Clean Artists Transform?

The clean artists transform moves "featuring" artist credits from the Artist field to the Title field during sync. This keeps the iPod's artist list clean — instead of seeing "CHVRCHES & Hayley Williams" and "CHVRCHES feat. Robert Smith" as separate artists, the user sees just "CHVRCHES" with the featuring credit in the song title.

### How it works (two-stage matching)

1. **Explicit match** — splits on `feat.`, `ft.`, `featuring`. High confidence. These are unambiguous featuring tokens.
2. **Ambiguous match** — splits on `&`, `and`, `with`, `vs.`, `vs`, `con`. Lower confidence. These tokens can be part of band names (e.g. "Coheed and Cambria", "Simon & Garfunkel").

The `ignore` list prevents ambiguous splits for specific artist names. Explicit `feat.`/`ft.` matches still work for ignored artists.

### Config shape

```toml
[cleanArtists]
enabled = true          # default: false
drop = false            # true = discard feat info entirely, false = move to title
format = "feat. {}"     # format string for title insertion
ignore = ["Coheed and Cambria"]  # artists to protect from ambiguous splitting
```

---

## 2. Session Goal

The user should end the session with a clean artists config where:

- Every transform applied is **intentional** — no false positives the user would be surprised by
- Every artist that **should** be split is being split — no missed opportunities
- The **ignore list** is complete and correct for their collection
- The user understands the **trade-offs** in ambiguous cases and has made informed decisions
- Any issues identified as **source data problems** (bad tagging) are clearly separated from config problems

---

## 3. Prerequisites

### 3.1 Required

- **A working collection source.** The agent needs to query tracks. Any configured source works (local path, subsonic server, etc.).
- **The current config.** The agent reads `~/.config/podkit/config.toml` (or the config path) to understand what's already configured.
- **Transform preview capability.** The agent needs to see what the transform *would* do without syncing. This uses `podkit collection music --tracks --apply-transforms --format json --quiet` (see CLI notes below).

### 3.2 Not required

- **A connected iPod or device.** The analysis is purely source-side. The agent does not need a device to do this work.
- **Prior knowledge of the user's music taste.** The agent discovers this from the collection data.

### 3.3 CLI usage notes for agents

> **These notes reflect improvements that are being implemented. Update this section once the CLI changes land.**

- **Always use `--quiet` with `--format json`** to suppress spinner output that would corrupt JSON parsing.
- **Redirect to a file** rather than piping directly to a parser, to avoid stream truncation: `podkit collection music -c <name> --tracks --format json --quiet > /tmp/tracks.json`
- **Use `--apply-transforms`** on collection output to get both original and transformed fields.
- **CSV format** is useful for quick grep-based lookups but breaks on fields containing commas. Use JSON for programmatic analysis.
- **`albumArtist`** field is important for reasoning about primary artists — ensure the collection output includes it.

---

## 4. Session Phases

### Phase 1: Baseline Assessment

**What the agent does:** Runs the transform against the collection and produces a structured summary.

**What the user does:** Nothing yet — this is the agent presenting the landscape.

**Output should include:**
- Total tracks in collection
- Total tracks affected by the transform
- Breakdown by match type (explicit vs ambiguous)
- List of unique affected artist strings, grouped by original artist, with track counts
- The current ignore list and what it's protecting

**Presentation guidance:**
- Explicit matches (high confidence) should be reported as a **count by artist**, not enumerated track-by-track. Example: "12 Limp Bizkit tracks with explicit feat. credits — all correctly split."
- Ambiguous matches should be listed individually since each one may need review.
- The summary should give the user a feel for the *scale* of the transform's impact before diving into details.

**Open question:** What is the right threshold for "this collection is too large to enumerate"? In the real session, 132 affected tracks across 2,821 was very manageable. At what point should the agent sample rather than exhaustively review? Likely somewhere around 500+ affected tracks, but this needs testing.

### Phase 2: Issue Identification and Triage

**What the agent does:** Reviews the transform results for problems and presents them categorised by severity/type.

**What the user does:** Makes decisions on ambiguous cases and confirms the agent's assessment of problems.

#### Categories of findings (in presentation order)

**Category A: Clearly correct (report, don't review)**
- Explicit `feat.`/`ft.`/`featuring` matches where the artist field cleanly splits into a main artist and guest(s)
- Present as: "99 tracks matched on explicit featuring tokens. These are high-confidence and all appear correct."
- Only enumerate if there are fewer than ~10

**Category B: Ambiguous but well-supported (present for confirmation)**
- `&`/`and`/`with` splits where collection presence data strongly supports the split (main artist has many tracks, featured artist has none or very few)
- Present grouped by artist with the collection presence evidence
- Example: "ATRIP & various (5 tracks) — ATRIP has 23 tracks as primary artist, the collaborators have 0. The split looks correct."

**Category C: Potential problems (present individually)**

Each problem should be presented using a consistent format (see Section 5). Problem types discovered in the real session:

1. **`vs.` treated as featuring** — semantically different from feat. (collaboration vs guest appearance). Example: Crystal Castles vs. HEALTH.

2. **Remix credits treated as featuring** — when the artist field encodes "original artist & remixer" and the title/album already credit the remixer. Example: Babsy & 1-800 GIRLS.

3. **Reversed artist importance** — when the ambiguous split puts the less-important artist first. Detectable via collection presence: if Artist B has 26 tracks and Artist A has 0, the split direction may be wrong. Example: Babsy & 1-800 GIRLS (1-800 GIRLS is the artist the user cares about).

4. **Unparseable compound artists** — artist strings with `/` delimiters encoding multiple featuring credits. Example: "Limp Bizkit feat. Matt Pinfield / Limp Bizkit feat. Les Claypool". The regex produces garbled featured text.

5. **Self-featuring** — artist credited as featuring themselves (bad source metadata). Example: "Rustie feat. Rustie". The transform works but the source data should be fixed.

6. **Comma + ampersand chains** — multi-artist credits like "The Wonder Years, Little Kruta & Shortly" where the split point is inconsistent. Only the last `&` is matched, leaving the comma-separated artist in the main artist field.

7. **Title already contains featuring info** — the transform correctly avoids double-adding, but the agent should still note these since the artist field gets cleaned while the title is untouched. The user should verify the existing title credit is acceptable.

**Category D: Source data problems (flag separately)**
- Issues that cannot be fixed with config (bad tagging, non-standard conventions)
- The agent should clearly label these as "source data issue — config cannot fix this" and suggest what the correct tagging would look like
- Examples: Rustie feat. Rustie, the Limp Bizkit double-feature medley

#### Key analytical techniques

The agent should use these techniques during triage. They emerged as the most valuable during the real session:

**Collection presence analysis.** For every ambiguous split `A & B`, count how many tracks A and B each have as primary artists in the collection. This turns most ambiguous cases into clear ones:
- A has many tracks, B has none → split is probably correct (A is main, B is guest)
- B has many tracks, A has none → split may be reversed (B might be the artist the user cares about)
- Neither has tracks → genuinely ambiguous, needs user input
- Both have many tracks → likely a genuine collaboration, may not warrant splitting

**Remix detection.** When the title or album contains "remix" and the artist contains `&`, the `&` may encode "original artist & remixer" rather than "main artist & featured artist". The agent should flag these.

**Album context.** Is the track on a single-track album (a single/remix release) or part of a full album? Singles with `&` in the artist are more likely to be remix credits or one-off collaborations. Full album tracks with `&` are more likely to be genuine featured guests.

**Album artist comparison.** When available, comparing the `artist` field to the `albumArtist` field reveals the intended primary artist. If `albumArtist` is "1-800 GIRLS" but `artist` is "Babsy & 1-800 GIRLS", the album artist tells you who the track "belongs to."

### Phase 3: Config Refinement

**What the agent does:** Proposes specific config changes based on the user's decisions in Phase 2.

**What the user does:** Approves, modifies, or rejects proposed changes.

**Types of proposals:**

1. **Additions to ignore list** — for artists where the ambiguous split is wrong. The agent should explain what the ignore entry protects and confirm that explicit feat matches for that artist still work correctly.

2. **No config change needed, source data fix recommended** — the agent should describe what the correct tagging would look like. This is advisory, not actionable within podkit.

3. **No action recommended** — for edge cases that are technically imperfect but not worth adding complexity for (e.g. a single track with a slightly redundant title).

**The agent should not:**
- Make config changes without user approval
- Suggest code changes to podkit — that's developer feedback, not user config
- Over-optimise for edge cases at the expense of simplicity (a 50-entry ignore list is a smell)

---

## 5. Presentation Format for Individual Issues

When presenting a problem case to the user, the agent should use a consistent structure. This format was refined during the real session and worked well for decision-making:

### Structure

**1. Source Data** — what the track looks like in the collection (artist, title, album, and any relevant context like album track count or album artist)

**2. Current Behaviour** — what the transform currently produces, shown as an artist/title pair that would appear on the iPod. If the track is already on the device, show the actual device state.

**3. Ideal Outcome** — the agent's recommendation for what the iPod should show. If there are multiple reasonable options, present them as alternatives with trade-offs.

**4. Commentary** — explanation of *why* this is a problem, what caused it (config limitation, source data issue, semantic mismatch), and what the fix options are (config change, source data fix, no action).

### Example

> **Source Data**
> | Field | Value |
> |-------|-------|
> | Artist | `Crystal Castles vs. HEALTH` |
> | Title | `Crimewave` |
> | Album | `Crystal Castles` (18 tracks) |
>
> **Current Behaviour (on iPod)**
> | Artist | Title |
> |--------|-------|
> | Crystal Castles | Crimewave (feat. HEALTH) |
>
> **Ideal Outcome**
> | Artist | Title |
> |--------|-------|
> | Crystal Castles | Crimewave (vs. HEALTH) |
>
> **Commentary:** The `vs.` token indicates a co-equal collaboration, not a guest appearance. Adding `"Crystal Castles"` to the ignore list prevents this ambiguous split while preserving the explicit `feat. Robert Smith` match on "Not in Love".

---

## 6. Session Variants

### 6.1 First-time setup vs iterative refinement

**First-time setup** — the user has `enabled = false` or no `[cleanArtists]` section at all.

- The agent should explain what the transform does and what trade-offs exist (enabled vs disabled, drop vs move-to-title, format options)
- Phase 1 should run with `enabled = true` to show what *would* happen
- The initial ignore list will likely need several entries — the agent should be prepared for a longer Phase 2
- The agent should frame this as "let's see what your collection looks like and build up the config together"

**Iterative refinement** — the user already has a working config and either added new music, changed their config, or is troubleshooting a specific issue.

- Phase 1 can be shorter — focus on what's changed since last review (new tracks, new artists)
- The agent should check if existing ignore entries are still necessary (has the user removed the artist from their collection?)
- If the user has a specific complaint ("this artist is showing up wrong"), the agent can skip straight to investigating that case

**Open question:** How does the agent know which variant to use? Checking `[cleanArtists].enabled` and the size of the ignore list is a good heuristic. If `enabled = false`, it's first-time setup. If enabled with an ignore list, it's refinement. But the user might also explicitly say "I just added a bunch of new music" — the agent should be responsive to that framing.

### 6.2 Very large collections

For collections with 10,000+ tracks and hundreds of affected tracks, the agent cannot enumerate every case. Strategies:

- **Focus on ambiguous matches only.** Explicit matches are almost always correct — report them as a count and move on.
- **Focus on new/changed tracks.** If the user has synced before, the agent could diff the current collection against what's on the device to find only new tracks that need review.
- **Sample by artist.** Instead of reviewing every track, review every unique *artist string* that's being split. 200 affected tracks might only be 30 unique artist strings.
- **Sort by collection presence imbalance.** The most likely problems are where the split produces a main artist with 0 collection presence, or where Artist B has far more presence than Artist A. Sort by this signal and review the top N.

**Open question:** Should the agent set an explicit threshold ("your collection has 15,000 tracks, I'll focus on ambiguous matches and likely problems only") or should it always start with the full summary and let the user decide how deep to go?

### 6.3 Multiple collections

A user may have multiple configured sources (e.g. local library + Navidrome). The clean artists config applies globally. The agent should:

- Analyse each collection separately (different collections may have different tagging conventions)
- Present a unified ignore list that works across all collections
- Flag conflicts where the same artist name needs different treatment in different collections (unlikely but possible)

**Open question:** Should the agent analyse all collections in Phase 1, or ask the user which one to focus on? Analysing all is more thorough but slower.

---

## 7. What the Agent Needs to Be Good At

### 7.1 Collection-level reasoning

The most valuable analysis isn't track-level — it's reasoning about the collection as a dataset. How many tracks does each artist have? What's the album context? Is this a single or a deep cut from a full album? The agent must think statistically, not just apply regex patterns.

### 7.2 Appropriate granularity

- 99 explicit matches → report as a count
- 33 ambiguous matches → group by pattern, present groups
- 3 genuine problems → deep dive on each with the full presentation format

The agent must calibrate how much detail to show. Too little and the user can't make decisions. Too much and the user drowns in data.

### 7.3 Having opinions, not just presenting data

When the agent identifies a problem, it should propose an ideal outcome and explain why, not just say "this might be wrong, what do you think?" The user is looking for expert guidance, not a data dump. The agent should be opinionated but transparent about its reasoning so the user can disagree.

### 7.4 Distinguishing config problems from source data problems

This distinction matters because the remediation is completely different. The agent should clearly label each issue:

- **Config fix** — "add X to ignore list" or "change format to Y" — actionable within the session
- **Source data fix** — "re-tag this track in Navidrome/your tagger as..." — actionable by the user outside the session
- **Potential code improvement** — "podkit could handle this better if..." — feedback for developers, not actionable by the user

### 7.5 Knowing when to stop

The session should end when:
- All ambiguous matches have been reviewed or consciously deferred
- The ignore list is updated
- Any source data issues are documented for the user
- The user is satisfied with the before/after preview of their full collection

The session should NOT become an exhaustive review of every track in the collection. The 80/20 rule applies — most value comes from catching the handful of genuine problems, not from confirming that 99 explicit matches are correct.

---

## 8. Open Questions and Areas Needing More Thought

### 8.1 How should the agent handle the `format` option?

The default `"feat. {}"` works for most cases, but the real session revealed that different separator types have different semantics (`vs.` ≠ `feat.`). If/when podkit supports separator-aware formatting, the agent guidance needs to cover how to configure this.

### 8.2 Should the agent recommend `drop: true` in any cases?

`drop: true` discards featuring info entirely rather than moving it to the title. This is a valid choice for users who don't care about featuring credits at all, but it loses information. The agent guidance should describe when this makes sense (e.g. very small iPod screens where title length matters).

### 8.3 How does this interact with the sync differ?

The transform affects how tracks are matched between source and device. If a user changes their clean artists config, previously-synced tracks may appear as "needs update" on the next sync because the transformed metadata has changed. The agent should warn the user about this if they make significant config changes.

### 8.4 Should there be a "save and revert" workflow?

If the user makes config changes during the session, should the agent offer to save the previous config as a backup? This reduces the risk of the user making changes they later regret.

### 8.5 Recurring analysis

Should the agent proactively suggest re-running this analysis when new music is added? If so, what's the trigger — a time interval, a track count delta, or user-initiated only?

### 8.6 What about artists in the ignore list who are no longer in the collection?

Stale ignore entries are harmless but add noise. Should the agent clean these up, or leave them in case the user re-adds the artist later?

### 8.7 Integration with the broader config session

Clean artists is one part of the sync config. How does this session relate to quality settings, artwork config, collection management, etc.? Is it a standalone workflow or a chapter in a larger "configure my sync" session?

---

## 9. Appendix: Findings from the Real Session

These concrete findings from the initial session provide reference data for the guide writer.

### Collection profile
- 2,821 tracks from a Navidrome subsonic source
- 132 tracks affected (4.7%)
- 99 explicit matches, 33 ambiguous matches
- 1 ignore entry: "Coheed and Cambria"

### Issues discovered

| # | Type | Artist | Problem | Resolution |
|---|------|--------|---------|------------|
| 1 | `vs.` semantics | Crystal Castles vs. HEALTH | `vs.` treated as feat — wrong collaboration style | Config fix (ignore) or code improvement (separator-aware format) |
| 2 | Remix credit | Babsy & 1-800 GIRLS | Remix artist split as feat, creating redundant title; reversed artist importance | Source data fix preferred; collection presence heuristic could detect |
| 3 | Compound artist | Limp Bizkit feat. Matt Pinfield / Limp Bizkit feat. Les Claypool | `/`-delimited double-feature produces garbled feat text | Source data fix preferred; `/` pre-split could handle in code |
| 4 | Self-featuring | Rustie feat. Rustie | Bad source metadata, transform works but input is wrong | Source data fix |
| 5 | Comma chain | The Wonder Years, Little Kruta & Shortly | Only last `&` matched, comma-separated artist left in main | Inherent limitation of regex approach |

### Heuristics that proved valuable
- **Collection presence** — counting tracks per artist as primary was the single most useful analytical technique
- **Album track count** — single-track albums suggest remix singles or one-offs
- **Remix detection** — title/album containing "remix" combined with `&` in artist signals a remix credit
- **Album artist comparison** — reveals intended primary artist (when field is available)
