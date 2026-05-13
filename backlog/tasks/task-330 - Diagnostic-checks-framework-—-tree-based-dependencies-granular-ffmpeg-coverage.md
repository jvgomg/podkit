---
id: TASK-330
title: >-
  Diagnostic checks framework — tree-based dependencies + granular ffmpeg
  coverage
status: To Do
assignee: []
created_date: '2026-05-13 16:18'
labels:
  - diagnostics
  - doctor
  - design
  - refactor
dependencies: []
priority: medium
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design and implement a richer diagnostic-check framework so `podkit doctor` gives users an accurate, granular picture of their ffmpeg environment, and so the sync engine can refuse to start cleanly when required codecs are missing.

## Motivation

Today's diagnostic system (`packages/podkit-core/src/diagnostics/`) has gaps that became visible during the codec/container disambiguation work:

- No explicit "ffmpeg present" check. Both `codec-encoders` and `video-encoder` silently `skip` when ffmpeg is missing, hiding the root cause.
- No decoder checks. Doctor only inspects output encoders; if a user's source files include a codec ffmpeg cannot decode, sync fails per-file with no upfront warning.
- All-or-nothing encoder check. The current `codec-encoders` reports against the default codec stacks regardless of whether the user's actual config or device codec preference would use those codecs.
- No dependency between checks. Each check decides for itself whether to skip; the runner can't say "the artwork-rebuild check depends on the device-readable check passing first" without inline conditionals.
- No platform-aware repair surface. Repair text in checks is hand-written per-platform with brittle string assembly.
- Sync does not pre-validate codec availability. The user discovers missing encoders mid-sync, after partial work, rather than at plan time.

The user's stated goals:

1. Granular detail — users see ffmpeg presence, each required decoder, each required encoder as distinct check results.
2. Required-vs-optional distinction based on user's sync settings and device codec preferences.
3. Tree-structured dependency between checks so downstream checks short-circuit cleanly when upstream fails.
4. Sync-time validation that errors before doing work, with the same repair text doctor would emit.
5. Platform-aware repair commands (homebrew, apt, dnf, apk, pacman), ideally detected from the runtime environment.

## Scope — design phase (deliverable: ADR or design doc)

Before any code change, produce a design document covering:

### A. Tree data structure for check dependencies

- Define `DiagnosticCheck` as a node in an explicit tree (or DAG), not a flat list with string IDs referencing each other.
- Decide: tree (single parent) or DAG (multiple prerequisites)?
- Decide whether check IDs remain stable strings for repair-targeting (`podkit doctor --repair <id>`) or move to a different addressing scheme.
- Define run semantics: when does a child run? Only on parent `pass`? Or also on `warn`? What about `skip`?
- Define result aggregation: how does the runner emit a top-level health verdict from a tree of results?
- Migration path for existing checks (artwork-rebuild, artwork-reset, codec-encoders, video-encoder, inquiry-methods, orphans, orphans-mass-storage, sysinfo-extended, sysinfo-consistency, udev-rule).
- How the device-scope vs system-scope distinction interacts with the tree. (System-scope checks form one subtree, device-scope another?)

### B. ffmpeg granularity

- Required encoders are computed from the resolved (codec preference × device codec support × user config) tuple, not the static `DEFAULT_LOSSY_STACK` / `DEFAULT_LOSSLESS_STACK`.
- Required decoders are computed from the source codecs present in the user's configured collections (probe collection adapters for unique codec set).
- Optional encoders/decoders are listed as informational `pass`/`note` so users can see the full picture without warnings.
- Each codec gets an individual check node, not a single aggregate. Failures point to the specific missing codec.

### C. Platform-aware repair

- Detect package manager once per `doctor` invocation: `which brew`, `which apt-get`, `which dnf`, `which pacman`, `which apk`, or `/etc/os-release` `ID=` lookup.
- Each repairable codec/encoder failure exposes a `repairCommand` string parameterised by the detected manager, plus a fallback "for other platforms" list.
- Define how `--repair` interacts: today's `DiagnosticRepair` interface is for in-process repairs (rebuilding artwork, etc.). External-command repairs are a different shape — does the framework grow a second repair kind, or do we surface them as "manual fix" with a copyable command?

### D. Sync-time validation

- Extract the encoder-availability subset from the doctor framework into a reusable predicate: `validateEncodersForPlan(plan: SyncPlan, capabilities: TranscoderCapabilities): ValidationResult`.
- Sync engine calls this before doing transcode work. On failure, emits the same repair text doctor uses (delegated through one shared surface).
- Decision: does `--dry-run` still surface the error, or just print the plan with a warning? Lean towards same hard fail — dry-run should reflect reality.

### E. Open questions to resolve in design

- Should "ffmpeg-present" check failure cascade-fail every codec check? Or run them anyway and report `skip` with the parent reason? Tree should make the answer mechanical.
- How to test the tree runner with parents/children that have different applicability (`applicableTo`)? Today's filter is per-check; with a tree, children inherit applicability from parents implicitly?
- What does "required vs optional" detection look like for users who haven't configured a device yet (fresh install)? Default to "all codecs required" or "no codecs required"?

## Scope — implementation phase

Once design is accepted, implement in stages so the framework refactor lands ahead of the granular checks:

1. Stage 1 — refactor `DiagnosticCheck` to its tree form, port existing checks unchanged. No new functionality. Tests for the tree runner pass-through behaviour.
2. Stage 2 — add the `ffmpeg-present` root and re-parent encoder/decoder/video-encoder checks. Convert the existing `codec-encoders` aggregate into per-codec children. Add the missing `codec-decoders` subtree.
3. Stage 3 — wire the required-vs-optional inference from user's config + device capabilities.
4. Stage 4 — implement platform detection + repair-command shaping.
5. Stage 5 — `validateEncodersForPlan` and sync engine pre-flight integration.

## Non-goals

- Auto-installing missing dependencies. Repair is "tell the user the command," not "run it for them."
- Cross-platform shell-out abstractions beyond what the existing `spawn`-based pattern already provides.
- A full DAG planner. If the design phase decides DAG isn't worth the complexity over tree, that decision sticks.

## Out of scope (separate work)

- The codec-vs-container model is already separated (Phase 1 shipped in `doc-036`). This task does not touch the codec model.
- Container-aware sync (`doc-037`) and portable-strict mode (`doc-038`) are separate PRDs.
- Test-fixture refactor (move `.ogg` generation into `@podkit/test-fixtures`, drop `HAS_LIBVORBIS` skip) is being implemented as a concrete refactor, not part of this task.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Design document landed before implementation begins.
- [ ] #2 Tree-based DiagnosticCheck interface replaces flat list; existing checks ported with no behavioural change.
- [ ] #3 ffmpeg-present check at root of system subtree; downstream codec checks skip cleanly when it fails.
- [ ] #4 codec-decoders subtree exists with per-codec children (mp3, vorbis, opus, flac, aac, alac, pcm at minimum).
- [ ] #5 codec-encoders becomes per-codec children with required-vs-optional inference based on user config + device capabilities.
- [ ] #6 Doctor output groups checks visually by tree depth and indicates skipped-because-parent-failed.
- [ ] #7 Platform package-manager detection in one place; repair commands generated from a single source.
- [ ] #8 validateEncodersForPlan exists; sync engine pre-flights via it and errors before work with same repair text doctor prints.
- [ ] #9 User-facing docs (docs/user-guide/devices/doctor.md) updated.

## References

- `packages/podkit-core/src/diagnostics/index.ts` — current registry
- `packages/podkit-core/src/diagnostics/checks/codec-encoders.ts` — current encoder check, repair-advice patterns
- `packages/podkit-core/src/diagnostics/checks/video-encoder.ts` — current video-encoder check
- `packages/podkit-core/src/diagnostics/types.ts` — current types
- `agents/testing.md` — testing strategy for system checks (injected probes vs real environment)
- `doc-036` — codec/container design principles (separate, complementary)
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
