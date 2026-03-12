---
id: TASK-124
title: 'Remove libgpod-node, gpod-tool, and native build infrastructure'
status: To Do
assignee: []
created_date: '2026-03-12 10:56'
labels:
  - phase-6
  - cleanup
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-123
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove all C/C++ code and native build infrastructure from the repository after successful swap to @podkit/ipod-db.

**Packages to remove:**
- `packages/libgpod-node/` — N-API bindings (~3,700 lines C++, ~4,400 lines TS)
- `tools/gpod-tool/` — C CLI for test iPod setup (~735 lines C)
- `tools/libgpod-macos/` — macOS libgpod build scripts (~292 lines)
- `tools/prebuild/` — Static deps build scripts (~200 lines)

**CI to remove:**
- `.github/workflows/prebuild.yml` — 3-platform binary build pipeline
- Any prebuild-related steps in other workflows

**Build config to remove:**
- `packages/libgpod-node/binding.gyp`
- `packages/libgpod-node/native/` directory
- Any node-gyp or prebuildify configuration

**Update gpod-testing:**
- `packages/gpod-testing/` currently wraps `gpod-tool` CLI
- Rewrite to use `@podkit/ipod-db` directly for creating test iPod environments
- `createTestIpod()` → use `Database.initializeIpod()` + `Database.create()`
- `withTestIpod()` → same auto-cleanup wrapper
- Remove gpod-tool dependency

**Documentation updates:**
- Update AGENTS.md: remove references to native bindings, C++ toolchain, prebuild
- Update docs/developers/development.md: remove libgpod/GLib/GdkPixbuf setup
- Update docs/developers/architecture.md: document new ipod-db package
- Update ADR-009 status to "Accepted"
- Update ADR-002 (libgpod binding approach) status to "Superseded by ADR-009"
- Remove parity tests from ipod-db (no longer needed)

**Remove from workspace:**
- Remove `@podkit/libgpod-node` from root `package.json` workspaces
- Run `bun install` to clean up lockfile

**Total removal: ~17,000 lines** of native binding infrastructure (C++, C, YAML, shell, build configs).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/libgpod-node/ directory removed
- [ ] #2 tools/gpod-tool/ directory removed
- [ ] #3 tools/libgpod-macos/ directory removed
- [ ] #4 tools/prebuild/ directory removed
- [ ] #5 Prebuild CI workflow removed
- [ ] #6 gpod-testing rewritten to use ipod-db directly
- [ ] #7 All tests still pass after removal
- [ ] #8 AGENTS.md updated (no C++ references)
- [ ] #9 Developer docs updated (no native toolchain setup)
- [ ] #10 ADR-009 status set to Accepted
- [ ] #11 ADR-002 status set to Superseded
- [ ] #12 Parity tests removed
- [ ] #13 Zero C/C++ files remain in repository
- [ ] #14 bun install succeeds with clean lockfile
<!-- AC:END -->
