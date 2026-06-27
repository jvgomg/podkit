---
id: doc-051
title: >-
  Bidirectional quality-change: extend cap enforcement to lossy + unify the
  quality classifier
type: specification
created_date: '2026-06-25 22:25'
tags:
  - sync
  - transcoding
  - quality
  - prd
---
# PRD: Bidirectional quality-change

> Supersedes the premise of TASK-419. The original task assumed "only the upgrade
> direction fires today." Codebase reality (ADR-010): bidirectional, sync-tag-authoritative
> quality detection **already exists for lossless sources**. This PRD reframes the work as
> (a) extending that machinery to **lossy** sources, (b) **unifying** the three detection
> paths into one classifier, and (c) adding **per-direction policy** + dropping the
> DB-bitrate tolerance fallback.

## Problem Statement

A user sets a target audio quality for their device (a quality preset, or a custom
bitrate, plus a CBR/VBR encoding mode). They expect the tracks on the device to match
that target, and to keep matching it when they change their mind.

Today that promise only holds for **lossless** source files. When the source is **lossy**
(MP3, AAC, etc.), podkit copies it to the device as-is and never re-encodes it to fit the
device's quality target. So:

- A user who **lowers** their device bitrate cap sees their lossy tracks stay large and
  high-bitrate — the setting silently does nothing for most of their library.
- A user who **re-rips** a source at a different quality, or changes their encoding mode
  (CBR↔VBR), gets no corresponding change on the device for lossy tracks.
- The only thing that ever happens to a lossy track is a one-directional "upgrade" when
  the *source* bitrate happens to climb well above the device copy.

Separately, even where bidirectional detection does work (lossless), the system leans on a
**bitrate-tolerance fallback** (comparing the iPod database's reported bitrate against a
target, with a 10–30% slack band) whenever a track has no sync-tag. That fallback exists
only because the iPod database's stored bitrate is an unreliable proxy for what podkit
actually encoded — especially for VBR. It is a guess, and it can both miss real changes
and fire on phantom ones.

## Solution

Make "the device matches my target quality" true **in both directions for every source
type**, driven by what podkit actually recorded it encoded — not by re-probing or guessing.

From the user's perspective:

1. **It just works out of the box.** Change the device's quality target (preset, custom
   bitrate, or encoding mode) and the next sync brings existing tracks into line —
   lossy and lossless alike. Lower the cap → tracks shrink. Raise it → tracks are
   re-encoded up to the new target (bounded by what the source can supply).

2. **No quality-destroying surprises.** If the *source* got worse (re-ripped lower) but
   the user's target is unchanged, podkit does **not** re-encode the device track down to
   the worse source by default. It reports the situation and leaves the good copy alone.
   The user can opt in to following the source down.

3. **Power users get knobs.** A per-device policy chooses which directions are allowed
   (both / up-only / down-only / off), and optional tolerances damp churn on the
   source-bound comparison. Defaults require no configuration and apply zero tolerance —
   exact match against the recorded target.

4. **Honest about what it can and can't know.** A track podkit didn't write (no sync-tag)
   is opted out of bitrate/encoding re-checks — there is no reliable way to know its true
   encoding without re-transcoding it. A single explicit flag,
   `--force-sync-tags-transcode`, re-encodes such tracks to establish ground truth. This
   is the only place missing data triggers an expensive, destructive operation, and it is
   never automatic.

## User Stories

1. As a user with a lossy music library, I want lowering my device bitrate cap to actually
   shrink the tracks already on the device, so that the setting does what it says.
2. As a user, I want raising my device bitrate cap to re-encode existing lossy tracks up to
   the new target (as far as the source allows), so that my device reflects my current
   quality preference.
3. As a user with FLAC sources, I want changing my quality preset to re-transcode existing
   tracks to the new preset, so that lossless and lossy behave consistently (this already
   works for lossless; the story is that it keeps working after unification).
4. As a user, I want switching my device encoding mode from VBR to CBR (or vice versa) to
   re-encode existing tracks to the new mode, so that the encoding on the device matches my
   chosen mode.
5. As a user, I want switching my device target between lossy and lossless to re-encode
   accordingly (lossy→lossless re-transcodes up; lossless→lossy transcodes down to the
   cap), so that the lossy/lossless boundary is respected as a quality decision.
6. As a user who re-ripped an album at a lower bitrate, I want podkit to **not** silently
   re-encode my good device copies down to the worse source, so that I don't lose quality
   by accident.
7. As a user, I want to see — in the sync summary and in JSON output — when a source-down
   situation was detected and skipped, so that I understand why nothing changed.
8. As a power user, I want to opt in to following the source down (`match-all`), so that my
   device tracks the source exactly even when that means lower bitrate.
9. As a power user, I want to restrict re-encoding to a single direction (`up-only` /
   `down-only`), so that I control whether syncs ever grow or ever shrink my tracks.
10. As a power user, I want to turn bitrate-driven re-encoding off entirely (`off`) while
    still letting format/encoding/lossless corrections happen, so that I keep bitrates
    frozen but stay format-correct.
11. As a power user, I want to set a bitrate tolerance so that trivial source-side bitrate
    drift doesn't trigger churn, so that I avoid pointless re-encodes.
12. As a curated-device user, I want a master switch (`skipUpgrades`) that prevents podkit
    from ever replacing an existing file for any quality reason, so that my device is
    purely additive.
13. As a user, I want a track that podkit never wrote (no sync-tag) to be left alone by the
    bitrate/encoding checks, so that an upgrade to this feature doesn't trigger a surprise
    re-encode storm.
14. As a user, I want one explicit, clearly-named flag (`--force-sync-tags-transcode`) to
    re-encode untagged tracks and establish quality ground truth, so that I can opt in to
    the one expensive, destructive adoption path deliberately.
15. As a user, I want `--bitrate-sync=<mode>` on the sync command to override the device
    policy for a single run, so that I can do a one-off direction change without editing
    config.
16. As a user reading default text output, I want a one-line per-direction summary
    ("3 quality-change ↓, 1 ↑, 2 source-down suppressed"), so that I get the gist quickly.
17. As a user reading verbose output, I want each affected track listed with its reason and
    direction, so that I can audit exactly what changed and why.
18. As a tool integrator consuming `sync --json`, I want a `qualityChanges[]` array per
    collection including suppressed entries, so that external tooling can surface the full
    picture.
19. As a developer, I want a single quality classifier I can unit-test exhaustively in
    isolation, so that the matrix of (transition × policy × source type) is provably
    covered without spinning up a sync.
20. As a mass-storage device user, I want the same target-matching behaviour as iPod users,
    so that quality policy is consistent across device types (the sync-tag carries the
    truth; no device database is required).
21. As a user, I want an idempotent re-sync (nothing changed) to do nothing, so that syncs
    are fast and don't churn on VBR bitrate noise.

## Implementation Decisions

### The deep module: a single unified quality classifier

Today the quality decision is spread across three functions in `engine/upgrades.ts` and the
handler:

- `detectUpgrades(source, ipod)` — source-vs-device, **up-only**, lossy + lossless, with a
  64 kbps / 1.5× threshold.
- `detectPresetChange(source, ipod, presetBitrate, options)` — device-vs-target,
  bidirectional, **lossless-only**, DB-bitrate + tolerance fallback.
- `determineSyncTagDirection(syncTag, expectedSyncTag)` — device-vs-target, bidirectional,
  exact, used when a sync-tag is present.

These collapse into **one pure classifier**. Conceptual signature:

```
classifyQualityChange(input: {
  source:   { lossless: boolean; bitrate?: number; codec?: string };
  encoded:  SyncTagData | undefined;     // device-side TRUTH (sync-tag); undefined = untagged
  target:   { quality preset; encoding: 'cbr' | 'vbr'; customBitrate?; resolvedCodec; ... };
  policy:   BitrateSyncMode;             // off | match-cap | match-all | up-only | down-only
  tolerance?: { up?: number; down?: number };  // opt-in, default 0
}) => QualityChange | null
```

Where:

```
QualityChange = {
  reason: 'format-mismatch' | 'encoding-mismatch' | 'lossless-boundary'
        | 'cap-down' | 'cap-up' | 'source-improved' | 'source-down-suppressed';
  direction: 'up' | 'down' | 'format-only';
  // descriptive fields for events / JSON: from/to bitrate, encoding, codec, cap, sourceBitrate
}
```

Design rules baked into the classifier:

- **Three separate bounds, never collapsed to `min()`.** Compare the device's recorded
  encoding against the **target** and against the **source** independently. Collapsing to
  `min(source, cap)` would make a *source drop* indistinguishable from a *cap drop*, which
  must be treated oppositely (cap-down re-encodes; source-down suppresses).
  - `encoded.bitrate > target.bitrate` → **cap-down** (down, policy-gated).
  - `encoded.bitrate < min(source, target)` and source can supply more → **cap-up /
    source-improved** (up, policy-gated).
  - `encoded.bitrate ≤ target` but `encoded.bitrate > source.bitrate` →
    **source-down-suppressed** (no-op by default; opt-in via `match-all`).
- **Sync-tag is authoritative; there is no DB-bitrate fallback.** `encoded` comes from the
  sync-tag, which records what podkit actually encoded. If absent → classifier returns
  `null` (the track is opted out). The old `detectBitratePresetMismatch` /
  DB-bitrate-vs-tolerance path is **removed**, not generalized.
- **Encoding mode (CBR/VBR) and the lossy/lossless boundary are precondition classes.**
  They re-encode regardless of bitrate policy (they fire even when `bitrate.sync = off`),
  because they are correctness, not bitrate preference. Direction still tags the result for
  gating display. CBR/VBR comes from the sync-tag (`encoding`); libgpod cannot express it.
  The lossless/lossy axis is observable from codec (DB `filetype` + source probe), so it
  does **not** need the sync-tag — but storing source codec in the tag is cheap and unlocks
  the out-of-scope lossy→lossless source-improvement trigger later.
- **Tolerance applies only to the source-bound comparison, and only when opted in.** Exact
  comparison against the recorded target needs no tolerance (it is deterministic — podkit
  wrote it). The only place real-world drift exists is `source.bitrate` from ffprobe on the
  lossy source-bound path; a per-direction tolerance damps that. Default 0.

### Policy gate

A small pure mapping from `(direction, reason, BitrateSyncMode)` → `fire | suppress-log`.
Kept as a distinct, independently-tested concern from "what changed":

| Mode | Up triggers | Down triggers | Source-down |
|------|-------------|---------------|-------------|
| `match-cap` (default) | fire | fire | suppress-log |
| `match-all` | fire | fire | fire |
| `up-only` | fire | suppress-log | suppress-log |
| `down-only` | suppress-log | fire | suppress-log |
| `off` | suppress-log | suppress-log | suppress-log |

Precondition classes (`encoding-mismatch`, `lossless-boundary`, `format-mismatch`) bypass
the gate (always fire) **unless** vetoed by the master switch below. Precedence when
multiple reasons hold: precondition reasons take the headline; a single re-encode satisfies
both the precondition and any concurrent bitrate move.

### Policy ladder (master veto preserved)

```
skipUpgrades (additive-only)  → never replace a file, even for precondition classes
bitrate.sync = off            → precondition classes fire; no bitrate moves
bitrate.sync = match-cap/...  → + bitrate moves per direction policy
```

`skipUpgrades` is **kept** (it has distinct value: the curated, purely-additive device).
It sits above `bitrate.sync` and vetoes everything including preconditions.

### Config schema

Per device, under the existing device-config block:

```toml
[devices.<name>.bitrate]
sync = "match-cap"          # off | match-cap | match-all | up-only | down-only  (default match-cap)
# optional power-user tolerances on the source-bound comparison (default 0):
toleranceUp = 0.0
toleranceDown = 0.0
```

The existing `encoding`, `customBitrate`, and `bitrateTolerance` device settings remain;
`bitrateTolerance` is reinterpreted as the source-bound tolerance (or split into
up/down) — its old role as the DB-fallback slack disappears with that path. Invalid
`sync` values fail config validation with a clear error.

### CLI

- `--bitrate-sync=<mode>` — overrides the device `bitrate.sync` for one run, via the
  existing config-override pattern (a value flag, not a new dedicated boolean; guard the
  unset-vs-explicit distinction through the option-source check, consistent with how other
  overrides avoid Commander default synthesis).
- `--force-sync-tags-transcode` — sibling of the existing `--force-sync-tags`. Where
  `--force-sync-tags` writes tags **without** re-encoding, this **re-transcodes** untagged
  (or all matched) tracks to establish true bitrate + encoding ground truth. The only
  destructive op triggered by missing sync-tag data; always explicit.

### Sync-tag

The sync-tag (`SyncTagData`) already carries `quality`, `encoding`, `bitrate`, `codec`.
Required change: **always write `encoding` + effective `bitrate` for lossy transfers too**
(today the preset/encoding tag work centres on transcoded/lossless tracks). The tag remains
the single device-side truth across iPod (libgpod) and mass-storage devices.

### Events / output surface

- New unified event `quality-change` with payload `{ direction, reason, from, to }`.
- Per the project's no-deprecation-cycle policy, **rename cleanly with a minor bump** —
  do **not** run a parallel `quality-upgrade`/`quality-change` emission window. The existing
  `preset-upgrade` / `preset-downgrade` / `quality-upgrade` reason vocabulary folds into
  `quality-change`.
- Text default: one-line per-direction summary including suppressed counts. Verbose: per
  track + reason. `sync --json`: `qualityChanges[]` per collection, including
  `source-down-suppressed` entries.

### Modules touched (no file paths in scope; conceptual)

- **Quality classifier** (deepened `engine/upgrades.ts`) — the one pure deep module;
  absorbs `detectUpgrades`, `detectPresetChange`, `detectBitratePresetMismatch`,
  `determineSyncTagDirection`. Old exports removed (no deprecation shims).
- **Policy gate** — pure mapping, new small module or co-located pure function.
- **Music sync handler** — `postProcessPresetChanges` generalized to
  `postProcessQualityChanges`; the `if (!isSourceLossless) return null` exclusion removed so
  lossy flows through; routes classifier output to the existing `transferUpgradeToIpod`
  re-encode executor (no new executor code).
- **Config schema + loader** — `bitrate.sync` enum, tolerance fields, validation.
- **CLI sync command** — `--bitrate-sync`, `--force-sync-tags-transcode`.
- **Sync-tag writer** — ensure lossy transfers always record `encoding` + `bitrate`.
- **Event/JSON presenters** — `quality-change` rendering + `qualityChanges[]`.

### Reuse, not greenfield

The re-encode **execution** path (`transferUpgradeToIpod`), the
`expectedSyncTagFromClassification` machinery, `syncTagMatchesConfig`, the codec-change
detector (`postProcessCodecChanges`), and the partition/diff plumbing are all reused
unchanged. This PRD changes **which conditions invoke** re-encoding and **consolidates the
decision**, not how the re-encode runs.

## Testing Decisions

Good tests here assert **observable behaviour** — "given this source, this recorded
encoding, this target, and this policy, the classifier says re-encode down / up / no-op /
suppressed" and "after a sync with a lowered cap, the device track is smaller." They do not
assert internal call sequences or private intermediate shapes. The classifier being pure
makes the exhaustive matrix cheap to cover without a sync.

Modules to test (all four confirmed in scope):

1. **Classifier unit tests (exhaustive).** Every transition × every `bitrate.sync` mode ×
   {lossy, lossless, encoding-flip, lossless-boundary, untagged}. Cases: cap-down, cap-up,
   source-improved, source-down-suppressed, encoding-mismatch (CBR↔VBR), lossless-boundary
   (both directions), untagged → null, precondition-bypasses-off. Prior art: the existing
   `upgrades.test.ts` unit suite around `detectUpgrades` / `detectPresetChange` /
   `detectBitratePresetMismatch` — extend/replace it.
2. **E2E per transition** (in the existing `upgrades.test.ts` e2e harness): cap-down shrinks
   a **lossy** track; cap-up + sufficient source re-encodes up; source-down under
   `match-cap` leaves the track alone; source-down under `match-all` re-encodes; `off`
   blocks bitrate moves but an encoding-flip / lossless-boundary still fires;
   `--force-sync-tags-transcode` adopts an untagged track. Prior art: the current
   preset-change e2e tests.
3. **Config schema validation tests.** `bitrate.sync` accepts the five values, defaults to
   `match-cap` when unset, rejects invalid values with a clear error; `--bitrate-sync`
   override resolves correctly and only when explicitly passed. Prior art: existing config
   `resolve.test.ts` / `writer.test.ts`.
4. **Sync-tag round-trip tests.** A lossy transfer always writes `encoding` + `bitrate`;
   reading it back yields an authoritative `encoded`; an untagged track is opted out until
   `--force-sync-tags-transcode` adopts it. Prior art: existing sync-tag parser/writer
   tests.

## Out of Scope

- **Source lossy → lossless detection** (re-rip MP3→FLAC at the same target bitrate
  re-encoding up): requires comparing source format/lossless across syncs. Storing source
  codec in the sync-tag here makes it *possible later*, but the trigger itself is a
  follow-up.
- **Per-collection bitrate policy** — this is per-device only.
- **Partial adoption of untagged tracks** (writing a tag from observed codec/DB-bitrate with
  `encoding: unknown` without re-encoding): rejected as not worth the `unknown`-mode
  branching. Untagged = fully opted out; `--force-sync-tags-transcode` is the only adoption
  path.
- **Removing `skipUpgrades`** — kept deliberately as the master additive-only veto.
- **Video** — preset-change for video already exists separately; this PRD is audio quality.

## Further Notes

- **Why the tolerance disappears by default and that's correct.** ADR-010's 10–30%
  tolerance bands exist solely because the *iPod database* bitrate is an unreliable proxy
  (VBR spreads ~30%). They were always a property of the DB-bitrate fallback path. Once the
  sync-tag is the sole truth, the comparison is exact and deterministic (podkit wrote the
  number), so tolerance is unnecessary — it survives only as an opt-in damper on the
  ffprobe-driven source-bound lossy comparison.
- **Why untagged tracks must be opted out.** libgpod exposes no CBR/VBR signal at all
  (verified: neither `gpod_converters.cc` reads it nor `track_operations.cc` writes it;
  `Itdb_Track` has no VBR member; the on-disk `mhit` bitrate is a bare uint). There is no
  reliable way to reconstruct true encoding without re-transcoding. Hence opt-out +
  explicit `--force-sync-tags-transcode`.
- **Why this supersedes TASK-419's text.** 419 was written against the assumption that only
  the upgrade direction exists. ADR-010's preset-change subsystem already provides
  bidirectional, sync-tag-exact detection for lossless. The real, narrower gap is lossy cap
  enforcement plus unification and policy — which this PRD targets directly. The acceptance
  criteria on TASK-419 should be reconciled against this document (several are already
  satisfied for lossless).
- Update `documents/architecture/sync/upgrades.md` in the same change to describe the
  unified classifier, the three-bound model, the policy ladder, the sync-tag-as-truth
  decision, and the removal of the DB-bitrate fallback. Consider a short ADR (or extend
  ADR-010) recording the "sync-tag is the sole quality truth; no DB-bitrate fallback"
  decision.
