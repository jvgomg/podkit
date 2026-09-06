---
id: TASK-490
title: >-
  Consume libgpod prebuilds in the monorepo dev loop (drop libgpod-dev as a
  contributor requirement)
status: To Do
assignee: []
created_date: '2026-09-06 23:31'
labels:
  - dx
  - packaging
  - native
milestone: m-21
dependencies: []
references:
  - packages/libgpod-node/package.json
  - packages/libgpod-node/scripts/has-prebuild.cjs
  - .github/workflows/prebuild.yml
  - test-packages/gpod-testing/package.json
  - tools/prebuild/build-linux-glibc.sh
  - TASK-100
  - TASK-101
  - CONTEXT.md
priority: medium
type: feature
ordinal: 269000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Let a fresh clone build and test podkit **without any prebuild library or prebuild tool installed** — no `libgpod-dev`, no `libglib2.0-dev`, no `pkg-config` — by consuming prebuilt native artifacts in the monorepo's own development loop.

See [CONTEXT.md](../../CONTEXT.md) for the *prebuild library* / *prebuild tool* / *prebuild* vocabulary this task is written in.

## Why this is not TASK-101

TASK-101 covers publishing `@podkit/libgpod-node` to npm so **external consumers** get prebuilds. That does not help a monorepo clone: workspace packages resolve `@podkit/libgpod-node` via `workspace:*` and never see the npm tarball. This task is about the **contributor dev loop**, and is unblocked by the npm-publishing decision that TASK-101 is deferred behind (`release.yml` still has `publish: echo "publish-placeholder"`).

It also revises TASK-100's AC #8 ("developer setup still documents building libgpod from source"): after this task, building libgpod from source is only required for contributors modifying `packages/libgpod-node/native/`.

## Current state

The machinery mostly exists and is thrown away:

- `packages/libgpod-node/package.json` build script is `(node scripts/has-prebuild.cjs || bun run build:native) && bun run build:ts` — **if a prebuild is present, node-gyp never runs**, so pkg-config/libgpod/glib are never consulted.
- `scripts/has-prebuild.cjs` already resolves `prebuilds/<platform>-<arch>[-musl]/` and detects musl vs glibc.
- `.github/workflows/prebuild.yml` already builds statically-linked, `ldd`-verified prebuilds for 6 triples (linux x64/arm64 glibc, linux x64/arm64 musl, darwin x64/arm64) — then uploads them to `actions/upload-artifact` (lines 136-140, 224-228) where nothing can consume them. No workflow does `gh release upload`.

## Second artifact: gpod-tool

Shipping only the `.node` addon is not enough. `@podkit/gpod-testing#generate-templates` shells out to the `gpod-tool` C binary, so a box without libgpod fails `bun run test:unit` even with a working `.node` prebuild. `@podkit/gpod-testing` already has a `build:linux-binary` script and `bin/` in its `files` array, so it is shaped for the same treatment.

## Scope

Publish both artifacts somewhere a clone can fetch them, and document the fetch. Deliberately **out of scope**: wiring the fetch automatically into `bun install` — that raises its own design questions (offline/fork clones, artifact hash pinning in a lockfile, fetch-on-CI behaviour) and should be a follow-up.

## Verification note

Reproducing the "no native deps" state is awkward on a machine that already has libgpod installed. A container or a scratch VM is the honest check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 libgpod-node prebuilds for all 6 CI triples are published to a fetchable location (GitHub Release assets or equivalent), not just actions/upload-artifact
- [ ] #2 gpod-tool binaries are published for the same Linux triples
- [ ] #3 A documented command fetches the correct prebuild for the host platform into packages/libgpod-node/prebuilds/ and the gpod-tool binary onto PATH
- [ ] #4 On a machine with no libgpod, no glib dev headers and no pkg-config, after running the fetch: bun run build, bun run typecheck and bun run test:unit all pass
- [ ] #5 Fetch correctly distinguishes glibc from musl hosts, reusing the detection in scripts/has-prebuild.cjs rather than duplicating it
- [ ] #6 development.md and AGENTS.md state that libgpod/GLib/pkg-config are needed only when modifying packages/libgpod-node/native/
- [ ] #7 An ADR records the decision to distribute prebuilds for dev-loop consumption, cross-referencing ADR-002 and TASK-101
<!-- AC:END -->
