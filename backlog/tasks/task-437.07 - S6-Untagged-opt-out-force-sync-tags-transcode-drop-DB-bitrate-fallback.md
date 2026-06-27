---
id: TASK-437.07
title: 'S6: Untagged opt-out + --force-sync-tags-transcode + drop DB-bitrate fallback'
status: In Progress
assignee: []
created_date: '2026-06-25 22:38'
updated_date: '2026-06-27 23:10'
labels:
  - sync
  - transcoding
  - quality
  - cli
dependencies:
  - TASK-437.01
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - packages/podkit-cli/src/commands/sync.ts
  - adr/adr-010-preset-change-detection.md
parent_task_id: TASK-437
priority: medium
ordinal: 199000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK.** See PRD doc-051.

Make the sync-tag the **sole** quality truth: remove the DB-bitrate + tolerance fallback entirely. A track with no sync-tag (one podkit didn't write) is **opted out** of bitrate/encoding re-checks — the classifier returns null for it (no guessing from the unreliable iPod-DB bitrate; libgpod has no VBR signal). Add `--force-sync-tags-transcode` (sibling of `--force-sync-tags`, which writes tags without re-encoding) — the only path that re-encodes untagged (or all matched) tracks to establish true bitrate + encoding, explicit because it is destructive. Record the "sync-tag is sole quality truth; no DB-bitrate fallback" decision in an ADR (extend or supersede ADR-010).

**Context:** user stories 13 (untagged left alone — no re-encode storm on upgrade), 14 (explicit adoption flag).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DB-bitrate + tolerance fallback path removed; classifier returns null for untagged tracks (opted out of bitrate/encoding checks)
- [x] #2 Upgrading to this feature does NOT trigger a re-encode storm on a library of untagged tracks
- [x] #3 --force-sync-tags-transcode re-encodes untagged (or all matched) tracks to establish true bitrate+encoding sync-tags; explicit + destructive
- [x] #4 --force-sync-tags (non-destructive, tag-only) behaviour preserved and clearly distinct
- [x] #5 Sync-tag round-trip tests: untagged opted out until adopted; adoption writes authoritative encoded data
- [ ] #6 E2E: untagged track unchanged on normal sync; --force-sync-tags-transcode adopts it
- [x] #7 ADR added/updated recording sync-tag-as-sole-truth (no DB-bitrate fallback)
- [x] #8 Changeset added
- [x] #9 User docs updated (--force-sync-tags-transcode + untagged opt-out behaviour)
- [x] #10 Architecture doc upgrades.md updated (sync-tag sole truth, fallback removed)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented sync-tag-as-sole-quality-truth + the explicit adoption flag. NOT marked Done (per instruction).

CORE (packages/podkit-core/src/sync/engine/upgrades.ts):
- Removed the DB-bitrate + tolerance fallback from `computeDeviceBound`'s lossless branch — the untagged lossless path now returns `null` (opted out), mirroring the lossy bound which already opted untagged out. The TAGGED ladders (sync-tag-exact, ALAC format check, lossless-boundary, encoding-mismatch) are untouched.
- Deleted only the truly-dead `DEFAULT_CBR_TOLERANCE` (export + core index re-export + demo mock-core copy). KEPT `detectBitratePresetMismatch`, `DEFAULT_VBR_TOLERANCE`, `DEFAULT_MIN_PRESET_BITRATE` — they have a NON-fallback consumer: the VIDEO handler (sync/video/handler.ts:259,266) still does bitrate-vs-tolerance preset detection (video carries no sync tags). Per the task's safety valve I did not break them; section header/JSDoc reworded to "VIDEO only".
- Removed `QualityTarget.bitrateTolerance`.

bitrateTolerance reinterpretation (handler.ts qualityTargetFromConfig): `toleranceUp = raw.toleranceUp ?? raw.bitrateTolerance`, `toleranceDown = raw.toleranceDown ?? raw.bitrateTolerance`. The classifier applies `?? 0` at the lossy comparison, so unset stays exact; explicit per-direction values win. MusicSyncConfig.bitrateTolerance doc updated.

ADOPTION (handler.ts postProcessSyncTagsTranscode, new Pass 2.5):
- Gated on `forceSyncTagsTranscode`. Runs BEFORE the tag-only postProcessSyncTags (Pass 4) so when both flags are set the transcode claims untagged tracks first (precedence) and the tag-only pass never re-sees them (partitionExisting physically moves them out of `existing`).
- Scope = GENUINELY untagged tracks (`!syncTag`). IMPORTANT FIX from sonnet review: an earlier predicate `!syncTag || syncTag.bitrate === undefined` would have re-encoded the entire already-tagged library, because a plain `quality=high` transcode tag legitimately omits `bitrate` (only customBitrate/override records it). Restricted to `!syncTag` — any podkit tag (transcode or copy) is authoritative and left to the classifier.
- Routes untagged tracks to a `quality-change` re-encode targeting resolved device quality, reusing transferUpgradeToIpod (writes the authoritative sync tag). Lossy with a cap → forced transcode to min(source,cap) via an attached cap-up qualityChange that resolveUpgradeAction stamps as bitrateOverride; lossless → classifier routing. Idempotent: adopted track has a tag → not re-adopted; normal re-sync matches via sync-tag-exact → no-op.

CLI: `--force-sync-tags-transcode` mirrors `--force-sync-tags` end-to-end — SyncOptions, the Option, sync.ts MusicContentConfig wiring (options ?? config ?? false), sync-presenter MusicContentConfig field, music-presenter createMusicHandler pass-through, core MusicSyncConfig field, plus config-file field + env (PODKIT_FORCE_SYNC_TAGS_TRANSCODE) + loader for symmetry.

TESTS (TDD): classifier untagged→null (both lossy+lossless) in upgrades.test.ts; rewrote the 3 handler tests that relied on the removed fallback to use TAGGED devices (sync-tag-exact drives the same detection); new handler describe `postProcessSyncTagsTranscode` covering adopt-lossless, adopt-lossy→min(source,cap), already-tagged-left-alone, normally-tagged-transcode-NOT-re-adopted (the review-driven guard), flag-off no-op, both-flags precedence; new dummy e2e in preset-change.test.ts seeds an untagged track via gpodTool.addTrack and asserts normal-sync opt-out (no quality-change) + flag adoption (quality-change-up=1), using --dry-run.

DELIVERABLES: ADR-022 (Accepted, supersedes ADR-010's audio preset-change-detection portion; ADR-010 status note + index updated); changeset .changeset/sync-tag-sole-quality-truth.md (minor podkit + @podkit/core); user docs (upgrades.md, sync-tags.md, cli-commands.md, config-file.md, environment-variables.md — untagged opt-out, --force-sync-tags-transcode vs --force-sync-tags, reinterpreted bitrateTolerance); arch doc documents/architecture/sync/upgrades.md (sync-tag sole truth, fallback removed, untagged opt-out, adoption pass, §7 open-work item marked done).

GATES (all green): lint 0/0; FULL turbo typecheck 36/36; @podkit/core unit 3376 pass/0 fail; podkit unit 1915 pass/0 fail; e2e (dummy) upgrades+preset-change+mass-storage-sync+artwork-sync-tags 50 pass/0 fail.

RE TASK-437.05 AC#5 (deferred): that AC reads "Opt-in source-bound tolerance config (default 0) damps source-bound lossy comparison; legacy bitrateTolerance reinterpreted (DB-fallback role gone)". The FIRST half (tolerance config) landed in 437.05. The SECOND half — bitrateTolerance reinterpreted + DB-fallback removed — is COMPLETED BY THIS TASK (437.07): the DB-bitrate fallback is gone and bitrateTolerance now folds into toleranceUp/toleranceDown. So 437.05 AC#5 is now fully satisfiable — retro-check it.

OPEN / SCOPE NOTES for reviewer:
- AC#6 (e2e) left UNCHECKED: the new e2e covers the DUMMY iPod via --dry-run (routing only, safe). A full-EXECUTION arm and a MASS-STORAGE arm were NOT added — the SyncTarget harness has no comment/sync-tag mutation API, and gpodTool.addTrack creates a metadata-only DB entry (no backing file), which makes a live re-encode (replaceTrackFile) unreliable to assert. The behavior is fully covered by unit tests; recommend a follow-up if a full-execution/mass-storage e2e is required.
- Review nits left as-is (judged acceptable): for an untagged lossy track with unknown source.bitrate, adoption re-encodes to the full cap (ADR-010's documented "unknown source → preset bitrate" default); the adoption qualityChange is labelled cap-up/up nominally (adoption bypasses the policy gate; resolveUpgradeAction treats cap-up/down identically).

Team-lead review pass (Sonnet) + fixes. Reviewer found NO blockers and verified the re-encode-storm prevention (untagged -> null on both bounds; adoption pass gated by the flag), the !syncTag adoption predicate, both-flags precedence, complete DB-fallback removal for audio (the retained detectBitratePresetMismatch/DEFAULT_VBR_TOLERANCE/DEFAULT_MIN_PRESET_BITRATE are video-only consumers), the bitrateTolerance reinterpretation, the intact tagged ladders, and ADR-022/ADR-010 coherence. Fixes I applied: (1) the adoption pass hardcoded direction 'up'/reason cap-up regardless of the move — now derives direction from effectiveTarget vs the device DB bitrate (display-only) so adopting an over-cap track reports a downward quality-change; this exposed that the adoption e2e was asserting the bug (a 900 kbps untagged track adopted to the 256 kbps high cap is a DOWN move), updated to expect quality-change-down. (2) Removed the now-doubly-dead public DiffOptions.bitrateTolerance field (no consumers; no-deprecation policy). (3) Fixed a stale `needsAdoption` JSDoc symbol reference. (4) Corrected the architecture doc which overgeneralised the opt-out (a bitless quality=high tag on a LOSSLESS source is still authoritative via exact comparison; only the lossy bound needs a recorded bitrate). Left N-2 (lossless-preset + lossy-source adoption display edge case) as-is. Gates green: lint 0/0, full typecheck 36/36, @podkit/core unit 3376 pass, podkit cli unit pass, e2e dummy 50 pass.

AC#6 left UNCHECKED — a real, harness-limited gap: the adoption round-trip (transcode executes -> tag written -> next sync no-ops) and a mass-storage arm are not full-execution e2e-tested because the e2e SyncTarget harness has no sync-tag/comment mutation API and gpodTool.addTrack yields a fileless DB entry (so a real transcode/replace cannot be driven against it). The routing + idempotency are covered at the handler/unit level and the dry-run e2e. Recommend a follow-up to extend the harness so AC#6 can be closed with a real execution + re-sync no-op on both iPod and mass-storage.
<!-- SECTION:NOTES:END -->
