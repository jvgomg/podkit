---
id: TASK-431.10
title: Convert podkit CLI to Bun-only distribution (drop npm channel)
status: Done
assignee: []
created_date: '2026-06-22 13:25'
updated_date: '2026-06-22 14:25'
labels:
  - ipod
  - archive
  - distribution
  - cli
dependencies: []
references:
  - adr/adr-021-cli-bun-binary-distribution.md
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
modified_files:
  - packages/podkit-cli/package.json
  - packages/podkit-cli/src/main.ts
  - packages/podkit-cli/src/bundle.test.ts
  - test-packages/e2e-shared/src/cli-runner.ts
  - test-packages/e2e-tests/src/features/graceful-shutdown.test.ts
  - documents/architecture/dev-builds.md
  - adr/adr-021-cli-bun-binary-distribution.md
parent_task_id: TASK-431
priority: medium
ordinal: 164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mechanical conversion implementing ADR-021: the `podkit` CLI ships only as a Bun `--compile` binary; the npm channel (`npm i -g podkit` / `npx podkit`) is removed. Libraries (`@podkit/core` and all other `@podkit/*` packages) stay Node-compatible and npm-published — only the CLI app changes.

This is the implementation half of the TASK-431.02 spike (the decision and docs are already recorded). It does not block LibraryDbWriter (which can use `bun:sqlite` immediately under the existing compiled-binary path); it is the cleanup that makes the dropped-npm-channel decision real and guards against accidental publish.

Scope:
- `packages/podkit-cli/package.json`: build with `--target bun` (or drop the npm `build`/`bin` entirely); mark `"private": true`.
- Remove the now-irrelevant `#!/usr/bin/env node` shebang from the CLI entry (`src/main.ts`, emitted `dist/main.d.ts`).
- `.changeset/config.json`: add `podkit` to `ignore`.
- `.github/workflows/release.yml`: ensure the `podkit` CLI package is never npm-published (GitHub Release binaries + Docker unchanged).
- Verify: `bun run compile` still produces a working binary; `bun run quality` passes; a release dry-run does not attempt to publish `podkit`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit-cli marked private (no npm publish) and the npm `bin` entry removed
- [x] #2 `#!/usr/bin/env node` shebang removed from the CLI entry
- [x] #3 release.yml confirmed not to npm-publish the CLI (publish-placeholder); binary-release versioning preserved via privatePackages.version
- [x] #4 Compiled binary builds + runs (bin/podkit --version) and podkit unit tests pass (1723)
- [x] #5 CLI bundle built `--target bun`; e2e 'production' runner invokes it under `bun`; full e2e suite green (33 pass)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Investigation reshaped the task. Two of the original ACs were wrong or premature:

- **AC "add podkit to changeset ignore" was wrong** — `.github/workflows/release.yml` reads `packages/podkit-cli/package.json`'s version (`CLI_VERSION`) to cut the GitHub binary release, and `.changeset/config.json` already has `privatePackages: { version: true, tag: false }`. Adding `podkit` to `ignore` would stop changesets versioning it and break the binary-release flow. The correct lever is `"private": true` — npm publish is skipped for private packages while versioning continues.
- **AC "release.yml cannot npm-publish" was already satisfied** — the changesets action uses `publish: echo "publish-placeholder"`; there is no `npm publish` / `changeset publish` anywhere. Distribution was already binary-first (Docker copies prebuilt musl binaries; releases/brew ship `bun --compile`).

Changes made:
- `packages/podkit-cli/package.json`: added `"private": true`; removed the npm `bin` entry. (`main`/`types`/`exports`/`files` left as inert-when-private; no consumer imports the bare `podkit` package or `podkit/types`.)
- `packages/podkit-cli/src/main.ts`: removed the vestigial `#!/usr/bin/env node` shebang (e2e invokes `node dist/main.js` explicitly; the compiled binary ignores shebangs).
- `packages/podkit-cli/src/bundle.test.ts`: updated the header comment — `dist/main.js` is now an internal build/e2e artifact, not an npm bundle. The koffi/usb-external contract still holds (compiled-binary staging + koffi's `eval("require")` ESM hazard), so the assertions are unchanged.

Verified: `bun run build --filter podkit` clean; `bun run test:unit --filter podkit` → 1723 pass / 0 fail (incl. bundle + dev-hooks-strip); `bun run compile` → `bin/podkit` builds; `bin/podkit --version` → 0.6.0.

**Deferred (rides with the bun:sqlite slice, TASK-431.06):** the runtime *purity* flip — `bun build --target node` → `--target bun`, repoint the e2e "production" runner (`test-packages/e2e-shared/src/cli-runner.ts:115`) from `node dist/main.js` to `bun`, and retire/rewrite the node-bundle contract. There is no forcing function until `@podkit/ipod-archive` actually imports `bun:sqlite` (which makes `node dist/main.js` non-functional for the archive command). Doing it now, before that import exists, would mean reworking the e2e harness and bundle tests twice. `dist/main.js` stays as the fast node-run e2e artifact in the interim — it is never user-shipped, so this does not contradict ADR-021.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The npm distribution channel for the `podkit` CLI is dropped, per ADR-021. `packages/podkit-cli` is now `private: true` with the npm `bin` removed and the `#!/usr/bin/env node` shebang gone; release.yml already does not npm-publish (publish-placeholder), and binary-release versioning is preserved via `privatePackages.version`. The user-facing CLI ships only as the Bun `--compile` binary (Homebrew / GitHub Release / Docker).

Verified clean: build, 1723 unit tests, compiled `bin/podkit --version` → 0.6.0.

The remaining runtime-purity flip (`--target bun` + e2e production under bun + retiring the node bundle) is deferred to land with the `bun:sqlite` import in TASK-431.06, which is its forcing function. See implementation notes.

Sonnet pre-commit review applied: fixed an ADR-021 self-contradiction (risk table + implementation section had prescribed adding `podkit` to changeset `ignore`, which would break binary-release versioning); corrected stale "shipping artefact" wording in `dev-builds.md` and `e2e-shared/cli-runner.ts` (dist/main.js is now an internal e2e proxy, not the user-shipped artefact); and added two `bundle.test.ts` invariants — no shebang in dist/main.js, and package is `private`. Bundle tests: 7 pass / 0 fail.

Runtime-purity flip completed (no longer deferred): CLI bundle is now `bun build --target bun`, and the e2e `'production'` runner invokes `dist/main.js` under `bun` instead of `node`. Caught and fixed the one hardcoded `node` CLI spawn that the shared runner didn't cover — `graceful-shutdown.test.ts` had its own `spawn('node', ...)` which fast-failed (exit 1) on the bun-target bundle; switched to `bun` and it now exercises the real graceful-SIGINT→130 path. Verified: build clean, bundle tests 7/7 (externals + no-shebang + private), `bin/podkit` compiles + runs, typecheck clean (podkit/e2e-shared/e2e-tests), and the full `bun run test:e2e` suite is 33 pass / 0 fail. `dist/main.js` remains an internal Bun-run e2e proxy (never user-shipped), now on the same runtime as the shipped binary.
<!-- SECTION:FINAL_SUMMARY:END -->
