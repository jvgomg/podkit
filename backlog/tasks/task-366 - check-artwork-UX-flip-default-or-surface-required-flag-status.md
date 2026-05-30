---
id: TASK-366
title: '--check-artwork UX: flip default or surface required-flag status'
status: To Do
assignee: []
created_date: '2026-05-30 19:46'
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
- [ ] #1 Design decision recorded (which of the 3 options, with rationale).
- [ ] #2 If flipping default: CLI flag default updated, `--no-check-artwork` opt-out added, integration tests updated for the new default.
- [ ] #3 If docs prominence: `sync --help` text mentions the flag's role in change detection; the artwork-related docs page calls it out near the top.
- [ ] #4 The matrix predictor in `test-packages/e2e-tests/src/matrix/artwork-rules.ts` reflects the new default if changed.
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
