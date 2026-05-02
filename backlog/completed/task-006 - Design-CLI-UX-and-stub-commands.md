---
id: TASK-006
title: Design CLI UX and stub commands
status: Done
assignee: []
created_date: '2026-02-22 19:08'
updated_date: '2026-02-22 22:13'
labels:
  - decision
milestone: 'M1: Foundation (v0.1.0)'
dependencies:
  - TASK-002
references:
  - docs/PRD.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design the CLI user experience and create stubbed commands with documentation.

**Requirements:**
- Use commander library
- Bun runtime with Node APIs
- All planned commands stubbed with --help documentation

**Commands to design (from PRD):**
- `podkit sync` - Main sync command with options
- `podkit status` - Show iPod info and connection status
- `podkit list` - List tracks (on device or in collection)

**Deliverables:**
- CLI command structure documented
- All commands stubbed and respond to --help
- README section on CLI usage
- Consider: global options, output formats (--json), verbosity levels
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLI command structure documented
- [x] #2 All commands stubbed with working --help
- [x] #3 Uses commander library
- [x] #4 Runs with Bun using Node APIs
- [x] #5 Global options defined (--verbose, --json, etc.)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

**Files created:**
- `packages/podkit-cli/src/main.ts` - Entry point with commander setup and global options
- `packages/podkit-cli/src/commands/init.ts` - Create config file command
- `packages/podkit-cli/src/commands/sync.ts` - Sync command stub
- `packages/podkit-cli/src/commands/status.ts` - Status command stub
- `packages/podkit-cli/src/commands/list.ts` - List command stub
- `packages/podkit-cli/src/main.test.ts` - Tests for command structure

**Global options:**
- `-v, --verbose` (stackable: -v, -vv, -vvv)
- `-q, --quiet`
- `--json`
- `--no-color`
- `--device <path>`
- `--config <path>`

**Commands:**
- `init` - Creates default config at ~/.config/podkit/config.toml
- `sync` - Options: --source, --dry-run, --quality, --filter, --no-artwork, --delete
- `status` - Shows iPod device info
- `list` - Options: --source, --format, --fields

**Config loading order:**
1. Defaults (hardcoded)
2. Default config file (~/.config/podkit/config.toml)
3. Config file via --config
4. Environment variables
5. CLI arguments

**Dependencies added:**
- commander@14.0.3
<!-- SECTION:NOTES:END -->
