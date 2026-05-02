---
id: TASK-032
title: Implement config loading system
status: Done
assignee: []
created_date: '2026-02-22 22:16'
updated_date: '2026-02-22 22:58'
labels: []
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-006
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the configuration loading system that merges settings from multiple sources.

**Loading order (lowest to highest priority):**
1. Defaults (hardcoded in code)
2. Default config file (`~/.config/podkit/config.toml`)
3. Config file via `--config <path>` flag
4. Environment variables (`PODKIT_SOURCE`, `PODKIT_DEVICE`, `PODKIT_QUALITY`)
5. CLI arguments

**Config file format (TOML):**
```toml
source = "/path/to/music"
device = "/media/ipod"
quality = "high"
artwork = true
```

**Implementation:**
- Parse TOML config files
- Read environment variables with `PODKIT_` prefix
- Merge sources in priority order
- Export typed config object for commands to use
- Handle missing config file gracefully (use defaults)

**Dependencies:**
- Need a TOML parser (consider `@iarna/toml` or `smol-toml`)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Config loads from ~/.config/podkit/config.toml
- [x] #2 Config loads from custom --config path
- [x] #3 Environment variables override config file
- [x] #4 CLI arguments override everything
- [x] #5 Missing config file doesn't error (uses defaults)
- [x] #6 Typed config object available to commands
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Started

**Approach:**
1. Use `smol-toml` for TOML parsing (lightweight, TypeScript-native)
2. Create a `config/` directory with:
   - `types.ts` - TypeScript interfaces for config
   - `defaults.ts` - Default values
   - `loader.ts` - Config loading and merging logic
   - `index.ts` - Public exports
3. Integrate into main.ts to load config before command execution
4. Pass config to commands via commander context or shared module

## Implementation Complete

**Files created:**
- `src/config/types.ts` - TypeScript interfaces (PodkitConfig, GlobalOptions, PartialConfig, QualityPreset)
- `src/config/defaults.ts` - Default values, DEFAULT_CONFIG_PATH, ENV_PREFIX, ENV_KEYS
- `src/config/loader.ts` - Config loading and merging functions
- `src/config/index.ts` - Public API exports
- `src/config/loader.test.ts` - 33 unit tests for config system
- `src/context.ts` - CLI context module for sharing config with commands

**Files modified:**
- `src/main.ts` - Added preAction hook to load config before commands
- `src/commands/sync.ts` - Updated to use getContext() for config access
- `src/commands/status.ts` - Updated to use getContext() for config access
- `src/commands/list.ts` - Updated to use getContext() for config access
- `package.json` - Added smol-toml dependency

**Config sources (priority order):**
1. Defaults (hardcoded in defaults.ts)
2. Config file (~/.config/podkit/config.toml or --config path)
3. Environment variables (PODKIT_SOURCE, PODKIT_DEVICE, PODKIT_QUALITY, PODKIT_ARTWORK)
4. CLI arguments (--device, --source, --quality, --no-artwork)

**Test coverage:**
- 39 tests pass (6 existing + 33 new config tests)
- Tests cover: file loading, env vars, CLI options, merging, missing files, invalid values

**Verified:**
- `bun run typecheck` passes
- `bun run lint` passes
- `bun run test:unit` passes
- Manual testing confirms priority order works correctly

## Code Review Summary

**Reviewer:** Claude Code
**Date:** 2026-02-22
**Verdict:** Approved with minor improvements

### Code Quality Assessment

**Strengths:**
1. Clean, well-organized module structure (`types.ts`, `defaults.ts`, `loader.ts`, `index.ts`)
2. Comprehensive TypeScript typing with proper interfaces
3. Good separation of concerns - each loader function is independent and testable
4. Robust TOML parsing with proper type validation
5. Clear priority order documented in comments
6. Context module provides clean access pattern for commands

**Issues Fixed During Review:**
1. `init.ts` had duplicate `DEFAULT_CONFIG_PATH` - updated to import from config module
2. Added additional edge case tests for malformed TOML, unknown keys, wrong types, and paths with whitespace
3. Added comprehensive test coverage for the context module (10 new tests)

### Test Coverage

**Before review:** 39 tests
**After review:** 53 tests

New tests added:
- `loader.test.ts`: throws on malformed TOML syntax, ignores unknown keys, handles wrong types, handles whitespace in paths
- `context.test.ts`: 10 tests covering getContext, setContext, getConfig, getGlobalOpts, clearContext

### Verification Results

- `bun run typecheck`: PASS
- `bun run lint`: PASS (0 warnings, 0 errors)
- `bun run test:unit`: PASS (53 tests)

### Files Modified/Created

**Modified:**
- `src/commands/init.ts` - Fixed duplicate constant, now imports from config module
- `src/config/loader.test.ts` - Added 4 edge case tests

**Created:**
- `src/context.test.ts` - 10 tests for CLI context module
<!-- SECTION:NOTES:END -->
