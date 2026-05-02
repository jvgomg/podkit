---
id: TASK-039
title: Implement E2E test package for CLI
status: Done
assignee: []
created_date: '2026-02-23 16:28'
updated_date: '2026-02-23 16:28'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `packages/e2e-tests/` - a new package for automated end-to-end testing of the podkit CLI. Tests invoke the built CLI artifact (`dist/main.js`) as a real user would, against both dummy iPods (CI-safe) and real iPods (manual validation).

**Features implemented:**
- Target abstraction (`IpodTarget` interface) for dummy/real iPod switching
- CLI runner that spawns actual CLI binary and captures output
- Fixture helpers for test audio files
- Pre-flight checks for real iPod testing
- Per-command tests (init, status, list, sync)
- Workflow tests (fresh sync, incremental sync)

**Also fixed:**
- Native binding resolution in `libgpod-node/src/binding.ts` to work with bundled CLI
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Package structure created with proper dependencies
- [x] #2 IpodTarget interface abstracts dummy vs real iPod
- [x] #3 CLI runner spawns actual CLI binary
- [x] #4 Test fixtures accessible via helper functions
- [x] #5 Pre-flight checks validate environment
- [x] #6 Command tests cover init, status, list, sync
- [x] #7 Workflow tests cover fresh sync and incremental sync
- [x] #8 All 37 tests passing
- [x] #9 Native binding resolution fixed for bundled CLI
- [x] #10 Documentation updated (TESTING.md, AGENTS.md, README.md)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented comprehensive E2E test package for the podkit CLI.

### Package Structure
```
packages/e2e-tests/
├── src/
│   ├── targets/      # IpodTarget abstraction (dummy/real)
│   ├── helpers/      # CLI runner, fixtures, preflight checks
│   ├── commands/     # Per-command tests
│   └── workflows/    # Multi-step workflow tests
├── package.json
├── tsconfig.json
└── README.md
```

### Test Coverage
- **37 tests** across 6 files
- Command tests: init (5), status (8), list (11), sync (11)
- Workflow tests: fresh-sync (1), incremental (1)

### Key Features
1. **Target abstraction** - `withTarget()` wrapper handles dummy/real iPod transparently
2. **CLI runner** - `runCli()` and `runCliJson()` spawn actual CLI binary
3. **Pre-flight checks** - Validates environment before real iPod testing
4. **Fixture helpers** - Access to test audio files in `test/fixtures/audio/`

### Native Binding Fix
Fixed `libgpod-node/src/binding.ts` to search multiple locations for native binding:
- Relative to source file (development)
- In `node_modules/@podkit/libgpod-node/` (bundled CLI, published package)
- Walking up directories for hoisted node_modules

### Scripts Added
```bash
bun run test:e2e          # Run with dummy iPod (CI-safe)
bun run test:e2e:real     # Run with real iPod (requires IPOD_MOUNT)
```
<!-- SECTION:FINAL_SUMMARY:END -->
