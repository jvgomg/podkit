---
id: TASK-529
title: >-
  Three bare unit tests need a real system tool — re-suffix them to Integration
  and check the gate still runs them
status: To Do
assignee: []
created_date: '2026-09-25 17:39'
labels:
  - testing
dependencies: []
references:
  - docs/architecture/testing/taxonomy.md
  - docs/agents/testing.md
  - packages/podkit-core/src/artwork/resize.test.ts
  - packages/podkit-core/src/transcode/ffmpeg-prediction.test.ts
  - test-packages/substrate/src/pve/tls.test.ts
priority: low
type: chore
ordinal: 299000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fallout from reconciling `taxonomy.md` with the tree. The Unit row used to say "no subprocess", which the tree never matched — 29 bare `*.test.ts` files across five packages spawn processes. It now says what the repo actually sorts on: **no real external dependency**. Spawning `bun`, `bash`, `sh` or `grep` is fine, because nothing has to be installed for those to work.

Under that rule three bare `*.test.ts` files are misfiled. Each shells out to a tool a contributor has to install:

| File | Needs |
|---|---|
| `packages/podkit-core/src/artwork/resize.test.ts` | `ffmpeg` + `ffprobe` |
| `packages/podkit-core/src/transcode/ffmpeg-prediction.test.ts` | `ffmpeg` + `ffprobe` |
| `test-packages/substrate/src/pve/tls.test.ts` | `openssl` (mints a self-signed cert, then reads its SHA-256 fingerprint back) |

This is the repo's own definition of Integration — `docs/agents/testing.md` §"Test package layout" says `*.integration.test.ts` is for "library code with real system deps (ffmpeg / gpod-tool / libgpod-node) but no CLI subprocess", which is these three exactly.

**The rename is not the hard part; the gate is.** Suffixing a file moves it between CI gates, and the two packages route Integration differently:

- `packages/podkit-core` — `bunfig.toml` ignores `**/*.integration.test.ts`, so a rename drops the file out of `test:unit` as intended. But `test:integration` is `gpod-tests-parallel`, a custom runner rather than a suffix glob. Whether it would pick these up has to be checked, not assumed. A rename that lands them in neither gate is strictly worse than the mislabel.
- `test-packages/substrate` — has **no** `test:integration` script at all (`test:unit` is the only one). So `tls.test.ts` needs a gate to exist before it can be moved into one.

**Do not "fix" this by mocking the tool.** Each asserts against what the real tool produced, and says so: `resize.test.ts` probes the output JPEG because "magic-byte checks let regressions slip through (an upscaled image is still a valid JPEG)". Mocking the boundary would delete the property under test. `ffmpeg` is already pinned in `mise.toml`, so requiring it is consistent with how the repo treats `metaflac` and `shellcheck`; `openssl` is not pinned and that gap is part of this decision.

Worth deciding at the same time whether these should call the `requireX()` preflight helpers, so a missing tool is a legible skip rather than a spawn failure.

Unrelated and already tracked: `@podkit/e2e-tests` keeps bare filenames for 13 tests that are E2E by depth. ADR-025 deferred that rename deliberately and it is not in scope here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the three files is either re-suffixed to `*.integration.test.ts` or given a recorded reason for staying bare
- [ ] #2 Every re-suffixed file is verified to actually run in a gate afterwards — named, with the command that proves it
- [ ] #3 `@podkit/substrate` gains a `test:integration` script if `tls.test.ts` moves, or the file stays put and says why
- [ ] #4 `podkit-core`'s `gpod-tests-parallel` runner is confirmed to collect the renamed files, rather than assumed to
- [ ] #5 A missing tool produces a legible skip via the `requireX()` preflight helpers, not a raw spawn failure
- [ ] #6 `bun run quality` is green afterwards, with no test silently dropped from every gate
<!-- AC:END -->
