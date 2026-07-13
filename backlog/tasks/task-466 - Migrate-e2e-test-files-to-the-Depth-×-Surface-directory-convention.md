---
id: TASK-466
title: Migrate e2e test files to the Depth × Surface directory convention
status: Done
assignee: []
created_date: '2026-07-12 12:53'
updated_date: '2026-07-12 15:59'
labels:
  - docker
  - testing
milestone: m-22
dependencies: []
references:
  - documents/architecture/testing/taxonomy.md
  - adr/adr-025-canonical-test-taxonomy.md
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
ordinal: 226000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Execute the deferred convention migration defined by [ADR-025](../../adr/adr-025-canonical-test-taxonomy.md) and [test taxonomy §5](../../documents/architecture/testing/taxonomy.md). Deferred from the taxonomy documentation work so the scheme could be reviewed before churning files + test gating.

## What

Encode E2E **Surface** by directory (default surface at package root; non-default surfaces in subdirs):

1. **Host `docker-source`:** `git mv` the 8 `*.docker.test.ts` files (today under `commands/`, `features/`, `workflows/`) into `test-packages/e2e-tests/src/docker-source/` (preserve history). Drop the now-redundant `.docker` token if desired.
2. **VM rename:** `git mv test-packages/e2e-vm-tests/src/docker-dist/` → `vm-docker/`.
3. **Re-key gating from suffix → directory:**
   - `e2e-tests/package.json`: `test:e2e` (default) excludes the surface subdirs; `test:e2e:docker` (keep script name stable) selects `docker-source/`; add `test:e2e:docker-loopback` for `docker-loopback/` (coordinate with TASK-450).
   - `e2e-vm-tests/package.json`: `test:e2e:docker-dist` path → `vm-docker/`.
   - Update `turbo.json` inputs if they enumerate these paths.
4. **Verify no test drops out of gating:** for each surface task, confirm it selects exactly the intended files (dry-run the runner globs; count before/after). This is the risky part — the host runner is the custom `gpod-tests-parallel`; check its `--pattern`/`--exclude` path semantics.
5. **Clean up the taxonomy doc:** once the dirs exist, remove the *(planned)* / *(renamed)* / *today:* markers in taxonomy §4/§5/§6 and switch the enumerate commands to the path-based forms.

## Separate / optional (do NOT bundle)
Normalizing `e2e-tests`' bare `*.test.ts` → `*.e2e.test.ts` suffix — a wide mechanical rename with consistency as its only payoff. Track as its own task if wanted; ADR-025 marks it deferred.

## Not in scope
The `test-packages/e2e-tests/src/docker/` **helpers** dir (container lifecycle) is unrelated to the `docker-source/` surface dir — do not merge them despite the similar names.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 8 host *.docker.test.ts files moved to test-packages/e2e-tests/src/docker-source/ with git history preserved
- [x] #2 test-packages/e2e-vm-tests/src/docker-dist/ renamed to vm-docker/
- [x] #3 test:e2e / test:e2e:docker / test:vm / test:e2e:docker-dist globs re-keyed to directories; each verified to select exactly the intended files with none dropped from gating
- [x] #4 taxonomy.md §4/§5/§6 planned/renamed/today markers removed and enumerate commands switched to path-based forms
- [ ] #5 quality gate (lint+typecheck+build+test) green after the move
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrated e2e tests to the Depth × Surface directory convention (ADR-025). Committed as 2efe3e25.

- 8 host `*.docker.test.ts` → `test-packages/e2e-tests/src/docker-source/` (git mv, history preserved, `.docker` token dropped — now directory-gated).
- `test-packages/e2e-vm-tests/src/docker-dist/` → `vm-docker/` (3 files; basenames kept per scope).
- Re-keyed gating: `e2e-tests/package.json` (test:e2e / :serial / :dummy / :real / :docker / :docker:serial), `e2e-vm-tests` package.json + bunfig, and `device-testing/src/preflight.ts` argv self-gate. Extended `gpod-tests-parallel` with `--exclude-path` + `--list` (the runner previously matched basename only, so it could not gate by directory).
- Gate integrity independently verified by an Opus review: host default 37, host docker 8, vm default, vm docker-dist 2 — identical selection before/after, nothing dropped or double-counted. Typechecks green in gpod-testing, e2e-tests, e2e-vm-tests.
- Cleaned taxonomy.md §4/§5/§6 (removed planned/renamed markers for the now-existing dirs; documented the runner limitation + new flags). `docker-loopback/` left planned (TASK-450).

AC5 (full `bun run quality` green) not checked: the quality DAG reaches and passes the migration-relevant stages (test:e2e / test:e2e:docker), but its final `@podkit/device-testing:test:vm` stage has a PRE-EXISTING, unrelated failure (3 personas' `doctor --scope system --json` disagree with the healthy SystemState fixture — untouched by this migration; likely fixture drift from d68fccdc). Owner is handling that separately.

Latent-bug fix rode along: `test:e2e:docker:serial` was bare `bun test` (silently ran all 45 host files); now scoped to the 8 docker-source files.
<!-- SECTION:FINAL_SUMMARY:END -->
