---
id: TASK-105
title: Add compiled binary smoke test to release CI
status: To Do
assignee: []
created_date: '2026-03-11 14:16'
updated_date: '2026-03-11 14:26'
labels:
  - ci
  - testing
  - packaging
milestone: Homebrew Distribution
dependencies:
  - TASK-104
references:
  - packages/e2e-tests/
  - .github/workflows/prebuild.yml
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Add an integration test step to the release workflow that verifies each compiled CLI binary actually runs correctly on its target platform before publishing the GitHub Release. This prevents shipping broken binaries.

## Context

The release workflow (TASK-104) compiles standalone binaries on each platform. We need confidence that the binary works — not just that it was built. Since each binary runs on its own platform in the CI matrix, we can test it in the same job that builds it.

## Implementation

### Per-platform smoke tests (in the compile job)

After `bun run compile` produces the binary, run these checks:

1. **Version check**: `./bin/podkit --version` exits 0 and outputs a version string
2. **Help check**: `./bin/podkit --help` exits 0 and contains expected subcommands
3. **Native addon loaded**: `./bin/podkit device info --help` exits 0 (this code path loads the native binding)
4. **Dynamic dependency check**:
   - macOS: `otool -L ./bin/podkit` — verify no unexpected dylibs (only system libs)
   - Linux: `ldd ./bin/podkit` or check the extracted `.node` sidecar — verify no libgpod/glib dynamic deps
5. **Dummy iPod test**: Create a temp directory, run `./bin/podkit device init --path /tmp/test-ipod` (or similar), verify it creates the iPod directory structure. This exercises the native addon end-to-end.

### Optional: E2E test against dummy iPod

If the existing E2E test infrastructure (`packages/e2e-tests`) can be configured to use the compiled binary instead of `bun run dev`, wire it up as an optional step. This would run the full sync workflow against a dummy iPod using the compiled binary.

## Notes

- These tests run in the same CI job that builds the binary, so they're on the correct platform
- Keep tests fast (< 30s) — they gate every release
- If any test fails, the release workflow should stop before creating the GitHub Release
- The dummy iPod test is the most valuable — it proves the native addon loads and can perform real operations
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each platform's compile job runs smoke tests before uploading the binary artifact
- [ ] #2 `podkit --version` and `podkit --help` are verified on all 4 platforms
- [ ] #3 Native addon loading is verified (a command that exercises the binding runs successfully)
- [ ] #4 Dynamic dependency check confirms no unexpected shared library dependencies
- [ ] #5 A dummy iPod init operation succeeds using the compiled binary (end-to-end native addon test)
- [ ] #6 If any smoke test fails, the release workflow halts before creating a GitHub Release
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Merged into TASK-104. Smoke tests are now part of the release workflow acceptance criteria (#7, #8, #14) rather than a separate task.
<!-- SECTION:NOTES:END -->
