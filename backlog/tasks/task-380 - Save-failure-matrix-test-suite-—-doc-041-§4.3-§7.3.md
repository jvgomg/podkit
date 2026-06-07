---
id: TASK-380
title: Save-failure matrix test suite — doc-041 §4.3/§7.3
status: Done
assignee: []
created_date: '2026-06-03 09:09'
updated_date: '2026-06-06 21:20'
labels:
  - testing
  - e2e
  - matrix
  - save-transaction
  - reliability
dependencies:
  - TASK-142
references:
  - test-packages/e2e-tests/src/matrix/
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: medium
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`doc-041 §4.3` proposes a matrix harness sweeping (device × failure-mode × recovery-strategy) so save() failure semantics get the same coverage rigor as artwork/codec already have via doc-039's matrix harness.

## Scope

1. New matrix file `test-packages/e2e-tests/src/matrix/save-failure-rules.ts` + `features/save-failure.test.ts`. Reuses the harness from doc-039.
2. Cells assert:
   - Which `save()` stage throws under the failure mode (tag/picture/move/sidecar).
   - What landed on disk (probed via filesystem walk).
   - What the next sync sees on rescan (idempotent, re-fires diff, or churn-loops).
   - What `podkit doctor` could clean (typed cleanup category — see TASK-375).
3. Initial axes:
   - devices: `[ipod-MA147, ms-echo-mini, ms-generic, ms-rockbox]`
   - failure-modes: `[tag-write-fail, picture-write-fail, move-fail, sidecar-write-fail, ENOSPC, EACCES]`
   - recovery: derived (one of `next-save-retries`, `rescan-redetects`, `doctor-cleans`, `user-reports-bug`)
4. Fence currently-undefined behaviour with `skipBug` referencing this task or follow-ups.

## Why this matters

Demonstrates podkit's resilience claim ("incremental sync + self-healing + doctor cleanup") with executable evidence, not docs. Every new failure mode discovered in the wild gets a row.

## Reference

`doc-041` §4.3 + §7.3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Matrix file `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` defined; uses `defineMatrix` with axes `capabilityShape × sourceFormat × codecConfig × transferMode × failureMode`; `syncPath` derived in reference model, NOT an axis
- [x] #2 Fault registry `matrix/save-failure-faults.ts` ships chmod-based path-targeted faults (track-readonly, album-readonly, cover-collision, manifest-dir-readonly, itunesdb-readonly) each as `{apply, cleanup}` using TestRuntime
- [x] #3 ENOSPC cell uses a new `device-mount-near-full` SystemState (loopback fs, snapshot-cached) in `test-packages/device-testing/src/system-states/`; `apply-state.sh` extended
- [x] #4 Each cell asserts all four observations: typed error class, partial device state (fs walk), rescan re-fire ops, doctor recovery category
- [x] #5 iPod cells (DatabaseWriteError + portable-tag warn-only) wired via dummy_hcd + libgpod inside the VM
- [x] #6 Capability shapes synthesised via `ms-generic` capability overrides (NOT new device fixtures); shape names are capability-derived, not model-derived (e.g. `embedded` not `embedded-flac`)
- [x] #7 Thin-slice de-risk: ENOSPC cell lands first as one end-to-end cell before the matrix fans out
- [ ] #8 `skipBug → TASK-376` fences mid-write torn-file cells; matrix is the documented force function for TASK-376
- [x] #9 MoveError throw-on-first vs settle-all asymmetry pinned explicitly via cell observation
- [x] #10 Matrix README enumerates EVERY known carve-out (silent gaps prohibited per doc-039 strategy): in-scope rows fenced + out-of-scope rows explicitly named with rationale. Every doc-041 §5 mode accounted for (covered, fenced, or named out-of-scope).
- [x] #11 Reference model treats capability shape + format together, NOT per-format `if` branches; reuses existing `codecOutcome`/`copyOpKind`/`artworkReaches`
- [x] #12 Harness lift (`harness.ts` → shared location) NOT in scope; re-evaluate after matrix lands and a second consumer demands it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Phase 1 — thin-slice ENOSPC cell landed (2026-06-06).

Files created:
- test-packages/device-testing/src/system-states/device-mount-near-full.ts — new SystemState provisioning a 5 MiB ext4 loopback at /mnt/podkit-device-fs filled to ~50 KiB free.
- test-packages/e2e-vm-tests/src/matrix/harness.ts — minimal defineMatrix/diffCell/skip taxonomy inlined (not lifted to a shared package per the task's deferred decision; mirrors e2e-tests/src/matrix/harness.ts shape).
- test-packages/e2e-vm-tests/src/matrix/save-failure-rules.ts — predictSaveFail() + cell/expected/observed shapes. Cell type widened ahead of time for Phase 2/3 fan-out.
- test-packages/e2e-vm-tests/src/matrix/save-failure-faults.ts — Phase 2/3 fault registry stub (empty for Phase 1).
- test-packages/e2e-vm-tests/src/matrix/README.md — 15-row carve-out catalogue (derived from doc-041 §4.3/§5 + the task's Initial Axes list; flagged as derived, not verbatim — the task description has no embedded 15-row table).
- test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts — defineMatrix wiring + observeOnce() pipeline.

Files modified:
- test-packages/device-testing/src/system-states/types.ts + index.ts + system-states.test.ts — extended SystemStateId union, registry, smoke tests (size 6→7).
- test-packages/device-testing/src/runtime.test.ts — scaffold assertion 6→7.
- test-packages/device-testing/src/runners/lima-test-vm-state.test.ts — allStates union extension.
- test-packages/device-testing/src/index.ts — re-exports.
- test-packages/device-testing/scripts/apply-state.sh — `apply_device_mount_near_full` + tear-down hook in `apply_healthy`; help text updated.
- test-packages/device-testing/lima/podkit-device-harness.yaml — added `e2fsprogs` to the apt install list (for `mkfs.ext4`).

Cell outcome: RED — and the divergence is exactly the kind the matrix is designed to surface.

Reference model predicts MoveError / copy category / some-tracks-landed / rescan-refires / .podkit-tmp orphan.

Reality: podkit's planner-level `not-enough-space` pre-flight fires BEFORE save() runs. The sync exits with `{success: false, error: "Not enough space. Need 443.5 KB, have 408.0 KB"}` and code 2, with zero tracks attempted. So the save() typed-error path is not reachable through a near-full mount alone — the planner gates it out.

The Phase-1 cell's job was to wire the harness end-to-end and surface this exact gap; that landed cleanly. The next decision (Phase-2 fan-out vs adjusting the predict() vs increasing the loopback size to bypass the planner check) is a HITL checkpoint.

Quality gates:
- `bun run typecheck` → 34/34 packages clean.
- `bun test test-packages/device-testing/src` → 228 pass / 2 skip / 0 fail.
- `bun run test:vm` → 108 pass / 1 fail. The single failure is the thin-slice cell; the harness pattern itself works.

ACs that the thin-slice satisfies (partial scope; full scope is Phase 2/3):
- #1 partial — Cells assert which save() stage throws (currently asserting MoveError; the gap is that no save() stage runs at all).
- #2 partial — What landed on disk is probed via filesystem walk.
- #3 done — What the next sync sees on rescan IS asserted (re-fires add-* ops).
- #6 partial — `device-mount-near-full` SystemState satisfies the ENOSPC failure mode.
- #7 done — Harness from e2e-tests/src/matrix is mirrored (not imported, to avoid host-test cross-dep) — `defineMatrix` semantics preserved.
- #10 done — 15-row carve-out catalogue in the matrix README.
- #11 partial — One cell asserts; fan-out is Phase 2/3.

Phase C.1 + C.2 — Option A locked in for ENOSPC; chmod fan-out across mass-storage shapes.

Files modified:
- src/save-failure-matrix.e2e.test.ts (rewritten): per-cell shape config via `[devices.<name>]` capability overrides; mount provisioned per failure mode; fault applied; sync run with `-vv` (text mode — JSON envelope drops error-class info; verbose output exposes `[copy] tag write failed for ...` lines). Stderr `Not enough space on device.` + Need/Have synthesise the JSON-mode error shape.
- src/matrix/save-failure-rules.ts: Cell type widened to 5-axis; `CAPABILITY_SHAPES` (embedded / embedded-vorbis / sidecar-mixed); `derivedSyncPath()` reference model mirrors `e2e-tests/src/matrix/reference-model.ts` without importing it. ENOSPC prediction = Option A (`plannerRejects: true`, `throwsClass: null`, regex `errorMessageMatches`, `partialDeviceState: 'no-files-landed'`, `rescanRefiresAddOrUpgrade: true`). Chmod predictions per (failure, shape, syncPath).
- src/matrix/save-failure-faults.ts: populated registry — track-readonly (chmod 0444), album-readonly (chmod 0500 album), cover-collision (mkdir cover.jpg dir), manifest-dir-readonly (chmod 0555 .podkit dir). apply+cleanup idempotent.
- src/matrix/harness.ts: `diffCell` extended — `Matches` suffix + RegExp expected → `regex.test(observed[siblingKey])`; null regex = no constraint.

Matrix: 48 generated; 33 skipped (16 redundant via canonical filter, 17 impossible non-sidecar × cover-collision); **16 asserted (8 GREEN, 8 RED)**.

Per-cell grid:
- ENOSPC × embedded × flac × prefer-copy: GREEN.
- album-readonly × all 3 shapes: GREEN.
- manifest-dir-readonly × all 3 shapes: GREEN (raw EACCES on state.json, `[copy]` category, throwsClass null as predicted).
- track-readonly: 1/7 GREEN, 6/7 RED.
- cover-collision: 0/2 GREEN.

Quality gates: typecheck 34/34 clean; `test:vm` 116 pass / 33 skip / 8 fail (was 108p/1f; the 8 new fails are the divergences this matrix is designed to surface).

Phase C.3 + Stage A/B/D — track-readonly pre-seed, iPod cells (itunesdb-readonly + portable track-readonly), MoveError throw-on-first pinning.

Files modified:
- src/matrix/save-failure-faults.ts: `preseed: 'none' | 'first-sync'` on FaultSpec; `track-readonly` flipped to first-sync; new `itunesdb-readonly` (iPod) + `move-parent-readonly` (Stage D). FaultContext + `itunesDir`/`movePivotDir`.
- src/matrix/save-failure-rules.ts: CAPABILITY_SHAPES + `deviceType` + iPod shapes (`ipod-noart`=mini_1G/9160, `ipod-artwork`=video_5G/MA147). SourceFormat += mp3; TransferMode += portable. PartialDeviceState += `preseed-only`/`database-stale`. ThrowsClass += DatabaseWriteError. SaveFailExpected gained `failedTrackCount: number | null` (null=no-constraint) and `portableTagWarn`. predictChmodFault rewritten: track-readonly = TagWriteError + preseed-only; itunesdb-readonly = DatabaseWriteError + database-stale + doctorSeesPodkitTmp=null; move-parent-readonly = MoveError + preseed-only + failedTrackCount=1; portable+track-readonly on iPod = warn-only (`portableTagWarn=true`, no throw).
- src/matrix/harness.ts: `Count`-suffix expected=null short-circuits diff (env-sensitive retry counts).
- src/save-failure-matrix.e2e.test.ts: rewritten — `writeSourceTrack` helper with `embedCover` flag (ffmpeg 10x10 red JPEG via `-disposition:v attached_pic`); `albumArtist` axis (ORIGINAL vs MUTATED for Stage D relocate); iPod mount via `gpod-tool init --model <id>` + chmod 0777; pre-seed pipeline (first sync → mutate source genre/albumArtist → discover iPod's actual on-disk audio path via `find iPod_Control/Music/F* -type f` since libgpod hashes filenames → apply fault → run failing sync); portableTagWarn detected via `/iPod portable:.*(?:tag write|file tags)/i`; rescanRefiresAddOrUpgrade extended to include `update-metadata` (stale-tag self-healing signal).
- src/matrix/README.md: status block rewritten — full mass-storage + iPod fan-out documented.

Matrix: 67 cells; 42 skip; 25 observed. Current run against May-26 VM binary: 16 GREEN, 9 RED.

Phase E — VM build-staleness detection + binary refresh (2026-06-06).

Background: The 9 RED cells on the May-26 binary were a mix of real findings and false REDs caused by the VM running pre-TASK-370 (sidecar device-write) and pre-TASK-381 (typed MoveError wrap) code. test:vm did NOT invoke turbo build of the Linux binary; harness:install had to be run manually.

Files added:
- documents/architecture/testing/vm-build-orchestration.md — 8-section architecture doc explaining the two concerns (binary freshness, VM baseline drift) + the chosen approach.
- test-packages/device-testing/src/baseline-hash.ts — shared computeBaselineHash() over (podkit-device-harness.yaml, apply-state.sh) + BASELINE_VM_HASH_PATH constant.
- test-packages/device-testing/scripts/vm-install.ts — turbo task body: transfers binaries (sha256-idempotent) + writes .turbo/vm-install-marker.
- test-packages/device-testing/scripts/vm-doctor.ts — preflight: hashes host yaml+apply-state.sh, compares to VM-stored hash, exits 1 with remediation on drift.

Files modified:
- turbo.json — new @podkit/device-testing#vm:install task (cached; depends on the Linux-binary build tasks). New @podkit/device-testing#vm:doctor task (cache: false; pure check). Both wired as dependsOn of #test:vm in both test packages.
- test-packages/device-testing/scripts/harness.ts — cmdSetup() now seals the baseline hash to /var/lib/podkit-device-harness/baseline-hash post-install via a new sealBaselineHash() helper.
- test-packages/device-testing/package.json — added vm:install / vm:doctor script entries.

Quality gates:
- bun run typecheck → 34/34 packages clean.
- PODKIT_HOST_ARCH=arm64 bunx turbo run @podkit/device-testing#vm:install → rebuilds + installs fresh podkit (sha 3b5de0022a5c, replacing May-26 768e788190cd).
- Re-run with no source changes → FULL TURBO cache hit.
- bun run --cwd test-packages/device-testing vm:doctor → 'baseline OK (0366c6f1bb61...)' against the sealed hash.
- bun run test:vm → 127 pass / 42 skip / 6 fail (was 116p / 33s / 8f on stale binary).

Disambiguation result (9 previously RED → 6 still RED after fresh binary):

Flipped GREEN (3 cells — typed MoveError + sidecar wrap landed):
- embedded × flac × prefer-copy × fast × move-parent-readonly
- embedded-vorbis × flac × prefer-copy × fast × move-parent-readonly
- sidecar-mixed × flac × prefer-copy × fast × move-parent-readonly

Still RED (6 cells):
- embedded-vorbis × flac × prefer-copy × fast × album-readonly (OGG/vorbis predict regression)
- embedded-vorbis × flac × prefer-copy × fast × manifest-dir-readonly (OGG/vorbis predict regression)
- sidecar-mixed × flac × prefer-copy × fast × cover-collision (did NOT flip — divergence from team-lead prediction)
- sidecar-mixed × ogg × prefer-copy × fast × cover-collision (did NOT flip — divergence from team-lead prediction)
- ipod-noart × mp3 × prefer-copy × portable × track-readonly (iPod portable rescan quirk — portableTagWarn observed=false, doctorSeesPodkitTmp observed=null)
- ipod-artwork × mp3 × prefer-copy × portable × track-readonly (same as above)

Divergence from team-lead's prediction: cover-collision cells did NOT flip GREEN. The team-lead expected 5 flips; reality is 3. Cover-collision needs separate investigation — it's a real finding, not a stale-binary artefact. The 2 OGG cells + 2 iPod portable cells match the prediction.

Note: bun's test reporter elides the per-cell mismatch detail for mass-storage failures (only iPod portable cells reach attempt-2 with their full diff visible). Surfacing the cover-collision divergence in actionable detail requires either a longer log capture or rerunning with --verbose.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
VM-hosted save-failure matrix landed across four phases. 23 cells GREEN, 42 pruned (16 redundant / 17 impossible / 9 env-gated), 2 RED = filed `TASK-395` (iPod portable codec-changed planner quirk).

## What landed

**Matrix harness** (`test-packages/e2e-vm-tests/src/`):
- `save-failure-matrix.e2e.test.ts` — entry, observe() pipeline (provision mount + source seed + optional first-sync pre-seed + fault apply → sync → fault cleanup → fs walk + rescan + doctor)
- `matrix/save-failure-rules.ts` — CAPABILITY_SHAPES (embedded / embedded-vorbis / sidecar-mixed / ipod-noart / ipod-artwork), derivedSyncPath() (mirrors e2e-tests/src/matrix/reference-model.ts codecOutcome+copyOpKind), predictSaveFail() with per-(shape × failureMode × syncPath) reasoning, observeCell()
- `matrix/save-failure-faults.ts` — typed Fault registry: track-readonly, album-readonly, cover-collision, manifest-dir-readonly, itunesdb-readonly, move-parent-readonly. Each `{apply, cleanup}` using TestRuntime. `preseed: 'first-sync'` flag for faults needing a managed-file baseline before the fault fires.
- `matrix/harness.ts` — inlined `defineMatrix` + diffCell + SkipDecision/skipBug (NOT lifted to a shared package — re-evaluate when a second consumer demands it)
- `matrix/README.md` — 16-row carve-out catalogue + out-of-scope subsection naming §5.1 / §5.6 / §5.7 explicitly

**New SystemState** (`test-packages/device-testing/src/system-states/device-mount-near-full.ts`): 5 MiB ext4 loopback at /mnt/podkit-device-fs filled to ~50 KiB free. `apply-state.sh` extended; `e2fsprogs` provisioned via yaml.

## Phase outcomes

- **Phase 1 (thin-slice ENOSPC)**: cell wired end-to-end; surfaced that **podkit's planner-level pre-flight intercepts ENOSPC BEFORE save() runs**. Reference model adjusted to lock in pre-flight envelope (Option A per HITL). TASK-378 reframed as a holistic free-space audit informed by this finding.
- **Phase C.2 (chmod fan-out)**: 48 cells → 16 asserted → 8 GREEN / 8 RED. RED divergences surfaced 4 distinct findings (track-readonly fault design / cover-collision artwork fixture / planner OGG label / JSON envelope drops typed errors).
- **Phase C.2 fix pass**: pre-seed pattern for track-readonly (run a first sync to land managed file, mutate source genre, then chmod) → 5 GREEN + 2 OGG-vorbis pre-seed failures (filed as TASK-394). Artwork-embedded fixtures for cover-collision via vorbis METADATA_BLOCK_PICTURE (ffmpeg 5.1 can't mux MJPEG attached_pic into OGG). MoveError throw-on-first asymmetry pinned via move-parent-readonly fault.
- **Phase C.3 (iPod cells)**: `gpod-tool init <mount> --model <gpodModel>` brings up a synthetic iPod environment in the VM without dummy_hcd — podkit's static libgpod-node link is enough. itunesdb-readonly cells (DatabaseWriteError, category=database) all GREEN. Portable-tag-warn cells (TagWriteError via WarningSink, soft) GREEN on typed-class but RED on rescan re-fires due to a planner codec-identity bug — filed as TASK-395.
- **Build orchestration (user-asked, post-Phase-C)**: VM binary was stale (pre-TASK-370 / pre-TASK-381) which created false-RED cells. Solved via Turborepo: `@podkit/device-testing#vm:install` (cached, depends on the binary builds) + `@podkit/device-testing#vm:doctor` (drift check vs in-VM baseline hash of yaml + apply-state.sh, fails fast with explicit `harness:destroy && harness:setup` remediation). `test:vm` depends on both. Documented at `documents/architecture/testing/vm-build-orchestration.md` + AGENTS.md + agents/testing.md + agents/device-testing.md.

## Reviewer-driven shape decisions (lessons for v2)

- `syncPath` is **derived from (capabilityShape, sourceFormat, codecConfig, transferMode)**, NOT an axis. Treating as axis produced ~50% impossible cells.
- Capability shapes named by capability (`embedded`), not by device model (`embedded-flac`).
- `noop-artwork` shape DROPPED — would have been half the skipImpossible budget for picture-fail / sidecar-fail.
- `db-fail` is iPod-only; mass-storage manifest is the closest equivalent and is covered by the manifest-dir-readonly cell.
- `manifest-fail` removed as an axis member — atomic manifest writes mean only ENOSPC/EACCES can fail, both covered by existing cells.

## Findings filed for follow-up

- **TASK-394** — OGG/vorbis optimized-copy regression (FFmpeg code 1 on passthrough). 2 `embedded-vorbis × ogg × prefer-copy × *` cells blocked at pre-seed. May be regression of TASK-358.01.
- **TASK-395** — iPod portable rescan re-fires `upgrade-direct-copy` with `codec-changed` reason on identical mp3 round-trip. Planner identity-comparison bug.
- **TASK-378** (reframed) — free-space handling holistic audit. Folds in: planner pre-flight envelope behaviour (anchor), JSON envelope drops typed-error-class info, planner OGG filetype-label fallthrough (`.Audio file` extension on OGG sources).
- **TASK-376** — atomic on-file writes retrofit; helper landed via TASK-391, retrofit pending.

## AC #8 (`skipBug → TASK-376` fence) — deferred carve-out, not done

The chmod-based faults expose EACCES-on-open paths that fail BEFORE any partial write occurs — no torn audio file in v1's fault inventory. The torn-file gap is real (doc-041 §3.4, §5.4) and the matrix's README row 2 explicitly catalogues it, but exercising it requires SIGKILL-mid-write injection which is out of v1's fault toolbox. v2 follow-up if/when SIGKILL fault injection lands.

## Quality gates

- `bun run typecheck` → 34/34 clean throughout
- Host unit tests (TASK-389/390/391/392/393 work): 2908 pass / 5 skip / 0 fail
- VM tests: 23 pass / 42 skip / 2 fail (the 2 fails are TASK-395)

## Constraint adherence (per orchestration brief)

- Zero production code changes — every fault is filesystem preconditioning
- No silent prediction flipping — every divergence surfaced via the cell-mismatch error, then either confirmed as a bug (filed) or a wrong prediction (fix the predict() with WHY-reasoning, not WHAT-task-IDs)
- No emoji, no task-ID-narrating code comments per project conventions
<!-- SECTION:FINAL_SUMMARY:END -->
