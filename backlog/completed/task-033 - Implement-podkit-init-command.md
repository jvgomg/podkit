---
id: TASK-033
title: Implement podkit init command
status: Done
assignee: []
created_date: '2026-02-22 22:16'
updated_date: '2026-02-23 12:21'
labels: []
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-006
  - TASK-032
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the `podkit init` command that creates a default configuration file.

**Current status:** Basic implementation complete in TASK-006. This task covers testing and integration with config system.

**Already implemented:**
- Creates `~/.config/podkit/config.toml` with commented example settings
- Errors if config file already exists (unless `--force` flag)
- Creates parent directories if they don't exist
- Displays helpful next steps after creation

**Remaining work:**
- Add tests for init command
- Share config path constant with config loading system (TASK-032)
- Ensure DEFAULT_CONFIG template stays in sync with config schema

**Options:**
- `--force` - overwrite existing config
- `--path <path>` - custom config location
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tests cover all init command behavior
- [x] #2 Config path constant shared with config loader
- [x] #3 DEFAULT_CONFIG template matches config schema
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary (2026-02-23)

### Changes Made

1. **Refactored init.ts** to extract testable functions:
   - `configExists(path)` - check if config file exists
   - `createConfigFile(options)` - create config with proper result object
   - `formatSuccessMessage(path)` - format the success output
   - `CONFIG_TEMPLATE` - exported template constant

2. **Config template now uses DEFAULT_CONFIG values**:
   - `quality = "${DEFAULT_CONFIG.quality}"` (high)
   - `artwork = ${DEFAULT_CONFIG.artwork}` (true)
   - This ensures the template stays in sync with the config schema

3. **Added comprehensive tests** (`init.test.ts`):
   - CONFIG_TEMPLATE tests (TOML validity, uses defaults, comments)
   - configExists tests (non-existent, existing file)
   - createConfigFile tests:
     - Creates file at path
     - Writes correct content
     - Creates parent directories
     - Errors when file exists (without force)
     - Overwrites with force flag
     - Edge cases (spaces, special chars)
   - formatSuccessMessage tests (all content validation)

### Files Changed
- `packages/podkit-cli/src/commands/init.ts` - refactored for testability
- `packages/podkit-cli/src/commands/init.test.ts` - new test file (27 tests)

### Verification
- All 27 init tests pass
- TypeScript type checking passes
- Linting passes
- All 388 unit tests pass

## Code Review (2026-02-23)

**Reviewer:** Claude Code

### Checklist Verification

- [x] Uses `DEFAULT_CONFIG_PATH` from config module - line 5 imports from `../config/index.js`
- [x] Uses `DEFAULT_CONFIG` from config module - line 5 imports, used in CONFIG_TEMPLATE lines 26-29
- [x] Template matches config schema - CONFIG_TEMPLATE includes all fields from PodkitConfig (source, device, quality, artwork)
- [x] `--force` option works - implemented in createConfigFile with proper error handling
- [x] `--path` option works - line 118 with DEFAULT_CONFIG_PATH as default

### Test Coverage

- 27 tests in `init.test.ts` covering:
  - CONFIG_TEMPLATE validation (TOML format, default values, comments)
  - configExists function (non-existent, existing file, directory edge case)
  - createConfigFile (creates file, writes content, creates parent dirs, handles existing file, force flag)
  - formatSuccessMessage (all content validation)

### Verification Results

- TypeScript: All 7 typecheck tasks pass
- Linting: 0 warnings, 0 errors
- Unit tests: All 388 tests pass

### Code Quality Notes

1. Good separation of concerns: Functions are extracted for testability
2. Proper typing: Interface definitions for options and results
3. Documentation: JSDoc comments explain sync with config schema
4. Error handling: Clear error messages with actionable advice

**Status: Approved**
<!-- SECTION:NOTES:END -->
