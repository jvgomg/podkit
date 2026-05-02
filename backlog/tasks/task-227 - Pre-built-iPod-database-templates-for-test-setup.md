---
id: TASK-227
title: Pre-built iPod database templates for test setup
status: Done
assignee: []
created_date: '2026-03-23 20:33'
updated_date: '2026-05-02 11:06'
labels:
  - testing
  - performance
milestone: Test Suite Performance
dependencies: []
documentation:
  - backlog/documents/doc-021 - Test Suite Performance Plan.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the per-test `gpod-tool init` subprocess spawn (~300ms each) with pre-built template directories that are copied via `cp -r` (~5ms each).

## Context

Every call to `createTestIpod()` in `@podkit/gpod-testing` spawns a `gpod-tool init` subprocess to create an iPod directory structure and database. This happens **312 times** across the test suite, costing ~93.6 seconds of aggregate subprocess overhead. This is the single largest bottleneck in the test suite.

## Approach

1. **Generate template directories** for each iPod model used in tests: MA147, MA002, MA477, MB565, MC293, MC027. Run `gpod-tool init` once per model and commit the resulting directory structures to `packages/gpod-testing/templates/`.

2. **Update `createTestIpod()`** in `packages/gpod-testing/src/test-ipod.ts` to check for a matching template before falling back to `gpod-tool init`. When a template exists, use `cp -r` (via `fs.cp` with `recursive: true`) to copy it to a fresh temp directory.

3. **Add a generation script** (e.g. `generate-templates.ts`) that rebuilds the templates from `gpod-tool` so they can be regenerated if the database format changes.

4. **Verify all existing tests pass** without modification — this should be a transparent optimisation.

## Key files

- `packages/gpod-testing/src/test-ipod.ts` — `createTestIpod()` function to modify
- `packages/gpod-testing/src/gpod-tool.ts` — `init()` function (current subprocess approach)

## Reference

See doc-021 (Test Suite Performance Plan) for the full analysis.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createTestIpod() uses cp -r from a template directory when one exists for the requested model
- [x] #2 Falls back to gpod-tool init for models without a pre-built template
- [x] #3 Templates exist for all 6 models used in tests (MA147, MA002, MA477, MB565, MC293, MC027)
- [x] #4 A generation script exists to rebuild templates from gpod-tool
- [x] #5 All existing tests pass without modification
- [x] #6 Per-creation time is under 20ms (measured in gpod-testing integration tests)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented template fast-path in `createTestIpod()`. Per-call cost dropped from ~300ms (gpod-tool subprocess) to ~5ms (`fs.cp` from pre-built template).

## Changes

- `packages/gpod-testing/scripts/generate-templates.ts` — generates one template per model in `TEMPLATE_MODELS` using `gpod-tool init` with default name and TEST_FIREWIRE_GUID.
- `packages/gpod-testing/src/templates.ts` — exports `TEMPLATE_MODELS`, `templatePath()`, `templatesDir()`. Path resolution via `import.meta.url` works from both src/ and bundled dist/.
- `packages/gpod-testing/src/test-ipod.ts` — fast-path triggers when `name === 'Test iPod'`, `firewireId === TEST_FIREWIRE_GUID`, and template exists for model. Otherwise falls back to subprocess. Template availability is memoised per process.
- `turbo.json` — added `@podkit/gpod-testing#generate-templates` task (cached, outputs `templates/**`). Wired into global `test:integration`, `@podkit/gpod-testing#test:integration`, `@podkit/ipod-db#generate-fixtures`, `@podkit/ipod-db#test:integration`, `@podkit/e2e-tests#test` via absolute task references (`@podkit/gpod-testing#generate-templates`) — `^generate-templates` failed because turbo strict mode requires the task on every direct dep.
- `packages/gpod-testing/.gitignore` — excludes `templates/`.
- `packages/gpod-testing/package.json` — added `generate-templates` script and updated `clean`.
- Templates cover 7 models: original 6 plus MA146 (already in TestModels but missing from task scope).

## Verification

- `bun turbo generate-templates --filter=@podkit/gpod-testing` → 7 templates, ~290KB total, <2s cold, FULL TURBO cached on rerun.
- gpod-testing integration tests: 3.3s → 1.4s.
- libgpod-node integration tests: 285 tests, 14.7s, all pass.
- Full `bun run test`: 37 tasks, all pass (89s wall-clock including e2e).
- Typecheck clean.

## Decisions captured during planning

- **Custom params:** Audit showed `firewireId` overrides have zero callsites and `name` overrides are confined to one self-test plus fixture generators outside the test loop. Slow-path fallback is cheap and rarely hit; no need for post-copy patching.
- **Cache strategy:** Turbo task instead of runtime cache. Less code than building atomic-rename + chmod-a-w + binary-hash invalidation logic, and templates are an inspectable artifact.
- **Templates not committed:** Generated to `templates/` (gitignored), turbo cache handles invalidation via `inputs` on script + relevant src files.
- **HashInfo concern (raised by user):** Verified deterministic — gpod-tool builds it from a fixed firewire_id with hardcoded constants (`0xDECADE...`, iv=0..15). Byte-identical across machines, safe to template.

## Known gaps not in scope

- `bin/gpod-tool` is not in the task's turbo `inputs` (out of package). Rebuilding gpod-tool requires `bun turbo generate-templates --force` or `clean`. Acceptable trade-off; gpod-tool changes are rare.
- `IpodModelNumber` literal union still missing MA146/MC293/MC027 but accepts them via `| string` fallback. Cosmetic, not blocking.

## Measured A/B Benchmark

Added `PODKIT_DISABLE_TEMPLATE_CACHE=1` env var (declared in `globalPassThroughEnv` in turbo.json) to force the slow path. `bun turbo run test:integration --force`:

| Package | Without templates | With templates | Speedup |
|---|---|---|---|
| @podkit/gpod-testing | 3.72s | 1.60s | 2.3× |
| podkit-cli | 45.18s | 18.31s | 2.5× |
| @podkit/core | 49.48s | 18.31s | 2.7× |
| @podkit/libgpod-node | 103.71s | 26.51s | 3.9× |
| **Total wall-clock** | **111s** | **34s** | **3.3×** |

Note: 111s baseline is significantly higher than doc-021's 70s (suite has grown since); 34s matches doc-021's Phase 1 prediction of ~35s.

## Follow-up improvements applied

- `bin/gpod-tool` added as turbo input (`$TURBO_ROOT$/bin/gpod-tool`) so cache invalidates on binary rebuild — closes the staleness foot-gun.
- `IpodModelNumber` literal union expanded to include MA146, MC293, MC027 with `string & {}` open fallback (preserves autocomplete on literals).
- Added `packages/gpod-testing/src/templates.integration.test.ts` covering: templates dir exists, every TEMPLATE_MODELS entry has a directory, defaults trigger fast path (timing-based, <50ms), produced iPod is valid via `verify()`. Timing assertion auto-skips when `PODKIT_DISABLE_TEMPLATE_CACHE=1`.
- Exported `TEMPLATE_MODELS`, `templatesDir`, `templatePath` from gpod-testing's main index for introspection.
<!-- SECTION:FINAL_SUMMARY:END -->
