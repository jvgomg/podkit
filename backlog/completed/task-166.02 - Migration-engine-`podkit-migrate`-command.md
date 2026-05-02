---
id: TASK-166.02
title: Migration engine & `podkit migrate` command
status: Done
assignee: []
created_date: '2026-03-19 14:42'
updated_date: '2026-03-19 15:29'
labels:
  - config
  - cli
milestone: Config Migration Wizard
dependencies:
  - TASK-166.01
references:
  - doc-006
documentation:
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/commands/
parent_task_id: TASK-166
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the core migration engine and the `podkit migrate` CLI command for automatic (non-interactive) migrations. See PRD: doc-006.

**Behaviour:**
- Migration interface: each migration has source version, target version, human-readable description, and a migrate function that receives raw TOML content and returns updated TOML content.
- Migration registry: ordered list of migrations. Engine applies them sequentially (0→1, then 1→2, etc.).
- Engine reads raw TOML (not parsed config — structure may be incompatible with current types).
- `podkit migrate` command:
  - Detects config file location (same resolution as normal config loading).
  - Shows current version, target version, and list of pending migrations.
  - Runs migrations sequentially.
  - Shows a summary/diff of changes before writing.
  - Asks for confirmation before writing.
  - Backs up original file with timestamp (e.g., `config.toml.backup.2026-03-19`).
  - Writes updated config with new version number.
  - `--dry-run` previews changes without writing.
  - Exits cleanly with "config is up to date" if no migrations needed.
- Include a trivial test migration (version 0→1 that bumps version only) to prove the system end-to-end.

**User stories covered:** 2, 5, 6, 8, 9, 11, 12, 15
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration interface defined: source version, target version, description, migrate function (raw TOML → raw TOML)
- [x] #2 Migration registry holds an ordered list of migrations
- [x] #3 Engine applies migrations sequentially from current version to target
- [x] #4 `podkit migrate` shows current version, target version, and pending migration descriptions
- [x] #5 `podkit migrate` shows summary of changes and asks for confirmation before writing
- [x] #6 `podkit migrate` backs up original config with timestamp before writing
- [x] #7 `podkit migrate --dry-run` shows what would change without writing
- [x] #8 `podkit migrate` exits cleanly with 'up to date' message when no migrations needed
- [x] #9 Trivial test migration (0→1) proves the system end-to-end
- [x] #10 Unit tests: engine applies migrations in order, skips already-applied, backup created, dry-run doesn't write
- [x] #11 Integration test: `podkit migrate` on a version 0 config file produces a version 1 config file with backup
<!-- AC:END -->
