---
id: TASK-343
title: m-18 follow-up tech debt + cleanup proposals
status: To Do
assignee: []
created_date: '2026-05-16 22:32'
updated_date: '2026-05-17 10:09'
labels:
  - tech-debt
  - follow-up
  - docs
  - testing
milestone: m-18
dependencies: []
priority: medium
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sweep of tech-debt items + structural concerns surfaced during the m-18 TASK-317 hygiene cluster. Each item has a problem statement + proposed fix; an incoming developer can pick up any item independently.

## 1. Three other shapes still carry bare-string `notSupportedReason`

**Problem**: TASK-679b68 ("consolidate unsupported-reason into resolveIpodModel") replaced `IpodModel.notSupportedReason: string` with `IpodModel.unsupportedReason: ReadinessUnsupportedReason`. But three sibling shapes still carry the legacy bare-string field:
- `IpodIdentity.notSupportedReason: string` — `packages/device-types/src/identity.ts`
- `IpodClassification.notSupportedReason: string` — `packages/devices-ipod/src/classify.ts`
- `DeviceScanDeviceEntry.notSupportedReason: string` — `packages/podkit-cli/src/commands/device/output-types.ts` (JSON envelope)

**Proposal**: Migrate each to the rich shape too. `IpodIdentity` + `IpodClassification` should produce `ReadinessUnsupportedReason` directly so the consumer-side `assessment.model?.unsupportedReason` pattern works everywhere. The JSON envelope (`DeviceScanDeviceEntry`) is user-facing API — versioned migration via changeset minor bump. Coordinate with TASK-317.07 (mass-storage preset display metadata) which may also touch the JSON envelope.

## 2. Docs site doesn't have new pages live

**Problem**: TASK-317.12 added `docs/devices/linux-filesystems.md` and TASK-317.11 added `docs/devices/troubleshooting.md`. Both are referenced from user-facing CLI messages via the central `DOCS_URLS` constant pointing at `jvgomg.github.io/podkit`. The docs site deploys from `docs-live` branch (per `agents/releases.md`), and the next release sync hasn't happened yet — every CLI message pointing at the new URLs currently returns 404.

**Proposal**: Cherry-pick the two new docs pages from `main` onto `docs-live` ahead of the next release. Add a step to the release checklist (or automation) that detects new files under `docs/` since the last sync and queues them for `docs-live` integration. Or just deploy `docs-live` more aggressively for docs-only changes.

## 3. Test style + mocking patterns vary across workers

**Problem**: Workers landed during the m-18 hygiene cluster used different test idioms:
- Some tests assert against full snapshot output (`expect(out.text()).toMatchSnapshot()`).
- Others use explicit field-by-field assertions (`expect(result.unsupported?.kind).toBe('ios-device')`).
- Some use `mock.module('@podkit/ipod-firmware', ...)` (which TASK-317.04 noted "leaks across Bun test files and breaks unrelated readiness tests").
- Others use injected fakes via optional constructor parameters (`{ SysInfoFsReader, SieReader }`).

**Proposal**: Write `agents/testing.md` (already referenced in `AGENTS.md` but may not exist yet — verify) with concrete guidance:
- Prefer dependency injection over `mock.module()`.
- Snapshot tests for stable user-facing text; explicit assertions for structured data.
- One canonical fake builder per persona (lives in `@podkit/device-testing`).
- Run-time test mocks via `bun:test`'s `mock()` only at function-call boundary, never via `mock.module()`.

## 4. Three stale worktrees on disk

**Problem**: Three orphan worktree directories under `.claude/worktrees/` carry uncommitted state from the wave-1 worker runs (HFS+ refusal, reconcile, doctor repair). Their work was re-integrated directly onto `main`; the worktree state is dead weight.

**Proposal**: One-liner cleanup:
```bash
for w in agent-a9bfc1d0cce752a3f agent-a6d99f9921f986071 agent-ada048c181d1f510d; do
  git worktree remove --force ".claude/worktrees/$w"
  git branch -D "worktree-$w" 2>/dev/null || true
done
```

(Verify each branch name first — `git worktree list` shows the canonical names.) Could be added to a periodic "session cleanup" script.

## 5. DOCS_URLS trailing slash inconsistency

**Problem**: The central `DOCS_URLS` constant (commit `b572b9e`) emits URLs without trailing slashes. But some Starlight pages serve from URLs that DO have trailing slashes (`/troubleshooting/macos-mounting/` etc.). Worker had to add trailing slashes at the call site (`${DOCS_URLS.macosMounting}/`) for two tips. Inconsistent.

**Proposal**: Either (a) include trailing slashes uniformly in `DOCS_URLS` (matches Starlight `trailingSlash: 'always'` default — depending on `astro.config.mjs` config), or (b) drop them everywhere and rely on Starlight's redirect. Pick one and pin it via a unit test that all `DOCS_URLS` entries end with or don't end with `/`.

## 6. Worktree-then-integrate workflow waste

**Problem**: The wave-1 work used three isolated worker worktrees, then `main` moved 3 m-19 commits, then every worker's output had to be recomposed against new APIs. Token-spend roughly 2–3× vs in-place work.

**Proposal**: Document in `agents/team-lead.md` (or wherever the orchestration guidance lives) that worktrees are appropriate for long-running parallel tracks but NOT for sequential single-feature work where main is actively moving. The right cadence: pull `origin/main` before spawning each worker; if main has moved meaningfully, abandon worktree isolation and work in main directly.

## 7. Backlog state churn during sessions

**Problem**: Many incremental `task_edit` calls during the m-18 session — each commit was preceded by one or two task-status updates. The MCP backlog edits commit as separate small commits that noise up the log.

**Proposal**: Batch task updates to the end of the session as a single "backlog: session updates" commit. Alternative: a single "session journal" task captures running decisions; per-task status updates happen only at task completion.

## 8. Pre-existing lint warnings on unrelated files

**Problem**: `bun run lint` reports 4 warnings on files untouched by this session (`packages/podkit-core/src/device/ipod-adapter.ts` `no-console`; `mass-storage-tag-writer.ts` `no-new-array`; `device-testing/.../no-fs-at-load.probe.mjs`). Pre-existing but cluttering output.

**Proposal**: Either clear them (likely small fixes) or add eslint-disable comments with explanations. Or upgrade the lint config to surface them differently so they don't drown out new findings.

## 9. CLI command files growing large

**Problem**: `packages/podkit-cli/src/commands/doctor.ts` is now ~1290 lines. `device/add.ts` is similarly large after the wave-1 work. They mix command-line parsing, business logic, rendering, and JSON output.

**Proposal**: Split per the pattern already in use (`device-scan-render.ts` is a separate file from `device/scan.ts`). For doctor specifically: extract the readiness/scope-resolution helpers into a sibling, the failure-explanation router into another, the rendering helpers into a third. Each file <500 lines.

## Notes for the picker-up

- These are tech-debt items, not bug fixes. Land them piecemeal as side-effects of related feature work, not as a "tech debt sprint" task.
- Items 1, 5, 9 have the highest long-term return; 2 has the most user-visible impact (404 docs URLs); 4 is a quick win.
- Items 3, 6, 7 are workflow/process — write them up once and don't re-touch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Items 1, 2, 4, 5 closed via small targeted PRs.
- [ ] #2 Items 3, 6, 7 captured in agents/*.md guidance docs.
- [ ] #3 Items 8, 9 either closed or filed as their own focused tasks if scope is non-trivial.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Item 8 (pre-existing lint warnings) closed in commit `c63ffe2` — 4 warnings cleared: 1 real fix in `mass-storage-tag-writer.ts` (`new Array(n)` → `Array.from({ length: n })`); 3 disable directives with explanatory comments for legitimate console.warn / console.log calls (ipod-adapter best-effort tag-write warnings, no-fs-at-load probe script). `bun run lint` now reports 0 warnings, 0 errors.
<!-- SECTION:NOTES:END -->
