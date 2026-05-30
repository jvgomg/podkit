---
id: TASK-366
title: '--check-artwork UX: flip default or surface required-flag status'
status: Done
assignee: []
created_date: '2026-05-30 19:46'
updated_date: '2026-05-30 21:29'
labels:
  - sync
  - ux
  - artwork
  - cli
dependencies: []
priority: medium
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Surfaced by

TASK-355.02 fix + the broader artwork-matrix work. Without `--check-artwork`, the Subsonic adapter cannot honestly report `hasArtwork` (Navidrome serves placeholder coverArt for every album), so the adapter now sets `hasArtwork = undefined`. detectUpgrades' strict `=== true` check then short-circuits both `artwork-added` and `artwork-removed` rules — meaning **artwork-change detection silently doesn't fire for Subsonic sources without the flag**.

Directory sources have a related, smaller issue: without `--check-artwork`, no `artworkHash` is computed, so the `artwork-updated` rule (which compares hashes via syncTag) can never fire. Initial artwork extraction still works on the add path (executor reads file bytes regardless of the flag), but change detection on subsequent syncs requires the flag.

## Why this is a UX problem

The flag is off by default but the user-visible artwork-change feature only works when it's on. A user who never reads the docs deeply will have:

- Subsonic syncs that look idempotent but silently miss real artwork changes.
- Directory syncs that detect artwork-added / -removed (via the `hasArtwork` boolean comparison) but miss artwork-updated (where bytes change but presence stays true).

## Options

1. **Flip the default to `--check-artwork`-on** (with `--no-check-artwork` as an opt-out for users sensitive to the HTTP-per-album cost).
2. **Auto-enable for sources that require it.** The Subsonic adapter knows it can't honestly report artwork without the flag; it could either warn loudly on connect or auto-enable. Directory adapter could stay opt-in (the cost difference matters more for filesystem traversal).
3. **Docs prominence pass.** Add a top-level note in sync docs + the `sync --help` output making it clear that artwork-change detection requires the flag.
4. **Surface a warning in dry-run output / JSON** when `--check-artwork` is off and the source can't honestly report artwork without it. Cheaper than flipping the default, more discoverable than docs, and complementary to all three options above. Adds a `planWarnings` entry (or similar) so users hit it on their next dry-run instead of silently missing artwork changes for months.

Option 1 is the cleanest user experience; option 2 splits the difference (cost only paid where needed); option 4 is the cheapest discovery path; option 3 is fallback if implementation cost is a blocker.

## What to investigate

- HTTP cost of `--check-artwork` per album for typical Subsonic libraries (Navidrome benchmark).
- Existing user config field `checkArtwork` (`packages/podkit-core/src/sync/music/config.ts`) — is the default already overridable from config? If so, option 1 is mostly a flag-default change in the CLI layer.
- Are there users currently relying on the no-fetch fast path for performance reasons?

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Design decision recorded (which of the 3 options, with rationale).
- [ ] #2 If flipping default: CLI flag default updated, `--no-check-artwork` opt-out added, integration tests updated for the new default.
- [ ] #3 If docs prominence: `sync --help` text mentions the flag's role in change detection; the artwork-related docs page calls it out near the top.
- [ ] #4 The matrix predictor in `test-packages/e2e-tests/src/matrix/artwork-rules.ts` reflects the new default if changed.
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude / Opus 4.7): Landed in commit `3b53dd8b` — option 4 ("Surface a warning in dry-run output / JSON when --check-artwork is off and the source can't honestly report artwork without it").

**Why option 4**: cheapest of the four with the best discoverability. No runtime cost change (fast mode stays fast for users who don't care). User sees the trade-off on every plan, can opt in if they care. Doesn't impose per-album HTTP cost on cost-conscious users (option 1) or create asymmetric per-source defaults (option 2).

**Implementation**

- New `SyncWarningType: 'artwork-detection-disabled'`.
- New optional `CollectionAdapter.getPlanWarnings(): SyncWarning[]`. Adapters opt in. Called synchronously during plan construction (must not perform I/O — JSDoc'd).
- `SubsonicAdapter.getPlanWarnings()` returns the warning when `checkArtwork === false`, none when true. Triggers on default config too (default is false in the adapter).
- `MusicHandler.collectPlanWarnings` forwards adapter warnings.
- `music-presenter.ts` warning display switch simplified: `lossy-to-lossy` keeps its custom format; every other type falls through to a generic message-as-written form. Side effect: `space-constraint` warnings (previously silently swallowed by the specific-cases switch) are now printed. No test asserted the prior silence; called out in commit.
- JSON output: existing serializer handles it generically (`PlanWarningInfo` shape unchanged).

**Coverage**

- `SubsonicAdapter.getPlanWarnings`: warning fires when `checkArtwork: false`, warning empty when `checkArtwork: true`, warns by default (omitted = false).
- `MusicHandler.collectPlanWarnings`: forwards adapter warnings into the plan; tolerates adapters without `getPlanWarnings`.
- Existing Subsonic + handler tests still green.

**Sonnet review changes**

- Test fake adapter was cast `as never` — replaced with `satisfies MusicAdapter` so future interface signature changes break the fake.
- Added JSDoc to `getPlanWarnings` noting it's called pre-getItems and must not perform I/O.

**Out of scope**

- Directory adapter: deliberately not warning. Without `--check-artwork`, directory hasArtwork is honest (it reads file tags); only the artwork-updated rule misses (hash-vs-hash comparison). Less severe than Subsonic's "all artwork-add/-remove silently invisible" failure mode.
- AC #2 (flip default): not the chosen approach. Marked unchecked.

**Gates**

typecheck (core + e2e), oxlint, unit (core), integration (core), docker e2e (Subsonic + artwork) — all green locally on macOS.

AC #3 and #4 unchecked — option 4 was chosen, so the conditional AC clauses for option 3 (docs) and the default-change matrix predictor don't apply. Only #1 (design recorded) is materially completed by this task. The warning surface IS the user-discovery mechanism.
<!-- SECTION:NOTES:END -->
