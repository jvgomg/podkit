---
title: "ADR-021: CLI Distributes as a Bun Binary Only"
description: Drop the npm channel for the podkit CLI; libraries stay Node-compatible. The CLI and the @podkit/ipod-archive leaf are Bun-targeted, unlocking bun:sqlite for the archive catalogue.
sidebar:
  order: 22
---

# ADR-021: CLI Distributes as a Bun Binary Only

## Status

**Accepted** (2026-06-22)

Refines the distribution clause of [ADR-001](/developers/adr/adr-001-runtime).

> **Clarification (2026-06-24):** "Not published to npm" does **not** mean "no changeset." Because `podkit` stays out of the changesets `ignore` list and `privatePackages.version: true` keeps it versioned (see the risk table and Implementation notes below), a **user-facing CLI change still requires a changeset targeting the `podkit` package** — the changeset bumps the CLI version and writes its changelog entry, which the binary/Docker release workflow consumes instead of an npm publish. See [agents/releases.md](../agents/releases.md) for the canonical policy.

## Context

The `podkit device archive` feature (doc-047, TASK-431) must write a `library.sqlite` catalogue. That forced a runtime decision (spike TASK-431.02): how does the CLI get a SQLite driver?

ADR-001 framed the CLI as Node-runnable — the npm channel builds with `bun build --target node` and ships a `#!/usr/bin/env node` shebang. Under Node, `bun:sqlite` (built into the Bun runtime) is unavailable, so the spike enumerated:

- **Branch A** — make the CLI a Bun-only `bun --compile` binary, unlocking `bun:sqlite`.
- **Branch B** — keep the dual (npm + binary) channel and use a Node-safe driver: `better-sqlite3` (native addon) or `sql.js` (pure wasm).

The project owner clarified the intent ADR-001 had blurred: **the libraries must stay Node-compatible for future Node consumers, but the CLI is itself a consumer whose only deployment target is a Bun binary.** ADR-001 conflated "we distribute on Node" with "every distributable is Node-runnable." Those are separable, and separating them is the cleaner design.

Two facts make Branch A cheap in practice:

- CLI deployment is **already Bun-binary-first**: Docker copies prebuilt **musl Bun binaries** (`bin/${TARGETARCH}/podkit`), and releases/brew ship `bun build --compile` binaries. The only thing the npm channel adds is `npm i -g podkit` / `npx podkit`.
- This repo's hardest distribution problem is **native-addon musl/glibc/arch juggling** (`libgpod-node` + `usb`, see `compile.sh` + the prebuild CI matrix). Adding `better-sqlite3` compounds it — it ships no upstream musl prebuilds, so Alpine would build from source. `sql.js` avoids native but adds a ~1MB wasm bundle. `bun:sqlite` adds **nothing**.

## Decision Drivers

- Libraries (`@podkit/core` and every other `@podkit/*` package) must remain Node-compatible — non-negotiable.
- Minimise distribution surface; do not add a third native addon or a wasm payload if avoidable.
- The npm CLI channel is largely vestigial; Docker/releases/brew already ship the Bun binary.

## Options Considered

### Option A: Bun-only CLI + `bun:sqlite`
Drop the npm CLI channel. CLI ships only as a `bun --compile` binary. The archive package uses the built-in `bun:sqlite`. Zero dependency, no native staging, no wasm, no musl concern. Cost: `npm i -g podkit` / `npx podkit` disappear; `@podkit/ipod-archive` becomes Bun-only.

### Option B1: Dual channel + `better-sqlite3`
Keep npm + binary. Native addon: rides the existing `.node` staging (one extra `compile.sh` line, like `usb`) but adds a **third** native dep to the prebuild matrix, and Alpine/musl has no upstream prebuild → build-from-source. Faster queries — irrelevant for a write-once catalogue.

### Option B2: Dual channel + `sql.js`
Keep npm + binary. Pure wasm: no native build, runtime-agnostic. Cost: bundle a ~1MB wasm into the compiled binary (`import wasm from "sql-wasm.wasm" with { type: "file" }` + `initSqlJs({ wasmBinary })`); whole DB held in memory then `db.export()` to disk.

## Decision

**Option A.**

1. **Distribution split (refines ADR-001):** libraries distribute Node-compatible via npm; the **`podkit` CLI distributes only as a Bun `--compile` binary**. The npm CLI channel (`npm i -g podkit` / `npx podkit`) is dropped. Homebrew + direct binary download remain.
2. **`@podkit/ipod-archive` is an explicitly Bun-targeted leaf package** (CLI-only consumer per doc-047) and uses **`bun:sqlite`** for `library.sqlite`.

The Bun coupling is confined to exactly two artifacts: the CLI binary and `@podkit/ipod-archive`. Everything else — `@podkit/core`, `@podkit/libgpod-node`, `@podkit/daemon`, and the rest — stays Node-compatible. ADR-002's N-API choice still holds: the native addons remain cross-runtime for the libraries' sake.

## Consequences

### Positive
- Simplest possible SQLite path: zero new dependency, no native staging, no wasm payload, no musl/glibc/arch matrix entry.
- The library boundary stays clean — every package except the one declared leaf remains Node-runnable.
- Docker, releases, and Homebrew are already Bun-binary-first; no new build pipeline.

### Negative
- `npm i -g podkit` and `npx podkit` no longer exist. Install is via Homebrew or binary download.
- `@podkit/ipod-archive` cannot be consumed by a Node program. Acceptable: it is a leaf with a single CLI consumer.

### Risks
| Risk | Mitigation |
|------|------------|
| Accidental npm publish of `podkit` | Mark the CLI package `private: true` — sufficient, since changesets skips publish for private packages. Do **not** add `podkit` to the changesets `ignore` list: `release.yml` reads `packages/podkit-cli/package.json` for the binary-release version, and `privatePackages.version: true` already keeps versioning while skipping publish — `ignore` would break that versioning. |
| A future Node consumer wants the archive logic | The driver is isolated behind the `LibraryDbWriter` module; swap to `sql.js` there if it ever needs Node. |
| `bun:sqlite` untested in CI | Tests run under Bun (`bun run test`), so `bun:sqlite` is exercised with no extra harness. |

## Implementation

Tracked as a follow-up (TASK-431.10). Mechanical conversion of the CLI to Bun-only:

- `packages/podkit-cli/package.json`: mark `"private": true` and drop the npm `bin` entry. (Done in TASK-431.10.) The `--target bun` build flip is deferred — see below.
- Remove the now-irrelevant `#!/usr/bin/env node` shebang from the CLI entry. (Done in TASK-431.10.)
- Do **not** add `podkit` to `.changeset/config.json` `ignore` — `private: true` already prevents publish, and `ignore` would break the binary-release version read in `release.yml` (see the risk table).
- `.github/workflows/release.yml`: already never npm-publishes (`publish: echo "publish-placeholder"`); GitHub Release binaries unchanged.
- The CLI bundle is built `bun build --target bun` and the e2e `'production'` runner invokes `dist/main.js` under `bun` (was `node`). (Done in TASK-431.10.) `dist/main.js` is an internal Bun-run e2e proxy — never user-shipped — and runs under the same runtime as the compiled binary, so `bun:sqlite` and other Bun built-ins resolve identically. The only hardcoded `node` CLI spawn (`graceful-shutdown.test.ts`) was switched to `bun`.

Docs aligned in the same change as this ADR: `docs/developers/building-from-source.md`, `docs/project/roadmap.md`, `agents/releases.md`, `AGENTS.md`, `agents/feature-requests.md`.

## Related Decisions

- [ADR-001](/developers/adr/adr-001-runtime) — Runtime Choice (Bun/Node). This ADR refines its distribution clause: libraries Node-compatible, CLI Bun-binary-only.
- [ADR-002](/developers/adr/adr-002-libgpod-binding) — N-API bindings stay cross-runtime for the libraries.

## References

- doc-047 — PRD: iPod Archive Command (device archive)
- TASK-431.02 — SQLite strategy spike (this decision)
- TASK-431.06 — LibraryDbWriter (unblocked by this decision)
- [bun:sqlite](https://bun.sh/docs/api/sqlite)
