---
id: TASK-491
title: CI depends on runner-image ffmpeg without declaring it
status: To Do
assignee: []
created_date: '2026-09-06 23:31'
labels:
  - ci
  - dx
dependencies: []
references:
  - test-packages/test-fixtures/scripts/check-ffmpeg.ts
  - test-packages/test-fixtures/src/static/video.ts
  - test-packages/test-fixtures/src/encoder-guard.ts
  - .github/workflows/
  - mise.toml
priority: medium
type: bug
ordinal: 270000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

No GitHub Actions workflow installs ffmpeg. Grepping all eight workflows in `.github/workflows/` for `ffmpeg` returns nothing. Every job that generates fixtures relies on the runner image happening to ship an ffmpeg with the right encoders.

That is an undeclared, unpinned dependency on GitHub runner image contents. It works today by luck, and would break silently — or worse, partially — if a runner image changed its ffmpeg build.

## What is actually required

`test-packages/test-fixtures` hard-fails (does not skip) without a specific encoder set:

- `scripts/check-ffmpeg.ts` `REQUIRED_ENCODERS`: `flac`, `libmp3lame`, `aac`, `libvorbis`, `libopus`, `mjpeg`
- `src/static/video.ts:32` `REQUIRED_ENCODERS`: `libx264`, `libvpx-vp9`, `aac`, `libopus`
- `src/encoder-guard.ts` re-checks at runtime for the audio set

`libvorbis` in particular is the one stock Homebrew omits, which is why contributors need either the `mise.toml` pin or the homebrew-ffmpeg tap. Nothing guarantees the CI runners have it.

## Options

1. Declare ffmpeg explicitly per workflow (`apt-get install ffmpeg` / `brew install`), accepting whatever encoders the distro build has — cheap, but does not actually guarantee the encoder set.
2. Adopt mise in CI and reuse the `"conda:ffmpeg"` pin from `mise.toml`. Gives dev/CI parity for free and guarantees the encoder set on both Linux and macOS runners. Larger change: mise is currently used in **no** workflow.

Option 2 is the more honest fix, but it is a broader change to how CI provisions tooling and deserves its own decision.

## Note

Found incidentally while deciding whether to pin ffmpeg in `mise.toml`. Independent of that change — this gap predates it and exists whether or not contributors use mise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every workflow that runs fixture generation or tests declares its ffmpeg provisioning explicitly
- [ ] #2 The provisioned ffmpeg is verified to carry the full REQUIRED_ENCODERS set on each runner OS, ideally by running check-ffmpeg.ts as a CI step
- [ ] #3 A decision is recorded on whether CI adopts mise for tooling parity with the dev environment, or declares dependencies per-workflow
- [ ] #4 CI fails loudly and early on a missing encoder rather than midway through fixture generation
<!-- AC:END -->
