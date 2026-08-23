---
id: TASK-481
title: >-
  Unpin bun-types/@types/bun (remove the 1.3.14 override once personas' .xml
  typing is fixed)
status: Done
assignee: []
created_date: '2026-08-23 14:17'
updated_date: '2026-08-23 22:38'
labels:
  - tooling
  - chore
  - tech-debt
dependencies: []
references:
  - package.json
priority: low
ordinal: 260000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-480.02 (P1 @podkit/lima extraction), a `bun install` (adding `proper-lockfile`) re-resolved the repo's floating `"latest"` `bun-types`/`@types/bun` to the just-released 1.4.0, whose ambient `*.xml` typing breaks `@podkit/device-testing` personas repo-wide (`TS2322 Document vs string`). Minimal fix applied: root `package.json` `overrides` pinning `bun-types` + `@types/bun` to **1.3.14** (the version the repo was on). This is a workspace-wide pin with no self-expiry.

Follow-up: either (a) upgrade `bun-types`/`@types/bun` to a 1.4.x that no longer breaks the persona `.xml` typing (or fix the personas to satisfy the new typing) and remove the override, or (b) replace the floating `"latest"` bun-types deps with an explicit pinned version and drop the override. Goal: no invisible workspace-wide type pin lingering as silent tech debt.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Resolved as end-state (a): root `overrides` deleted, `bun-types`/`@types/bun` now resolve to 1.4.0 via the existing floating `"latest"` specifiers (no specifier changes needed — 1.4.0 is the current stable dist-tag).

**Actual root cause of the 1.4.0 break.** `bun-types` 1.4.0 adds `declare module "*.xml" { var contents: import("bun").XML.Document; export = contents }`. TypeScript *merges* same-specifier ambient module declarations rather than letting a more specific one shadow — so podkit's own `declare module '*.xml' { const content: string }` in `personas/text-imports.d.ts` merged with Bun's and lost. Every `.xml` default-import in the personas then resolved to `Bun.XML.Document`, producing the repo-wide TS2322. `skipLibCheck: true` swallowed the accompanying TS2309 on the merged declaration, leaving only the downstream error visible. The `with { type: 'text' }` attribute forces Bun's text loader at runtime, but TS's ambient matching is purely specifier-pattern-based and cannot see import attributes, so it can't influence which declaration wins. Verified in an isolated repro; also confirmed TS does not do longest-match shadowing for wildcard ambient modules.

**Fix.** One documented cast helper, `test-packages/device-testing/src/personas/raw-text.ts` (`asRawXmlText`), called by the 13 `personas/*/persona.ts` files that import `sysinfo-extended.xml`. The now-dead `*.xml` block was removed from `text-imports.d.ts`; its `.txt`/`.plist` blocks are unaffected (Bun's own `*.txt` also resolves to `string`; it declares no `*.plist`).

**Alternative rejected:** renaming the fixtures off the `.xml` extension to dodge the collision. It would have required updating hardcoded `readFileSync` path strings in `packages/ipod-firmware/src/plist/parser.test.ts` and `packages/podkit-core/src/diagnostics/checks/sysinfo-consistency.test.ts`, renaming 8 fixture files, and touching `agents/device-testing.md`, the persona-capture playbook and 11 `provenance.md` capture logs — and the content genuinely is an XML document, so the rename would discard a real format signal for a tooling workaround.

**Lockfile:** only `bun-types` and `@types/bun` moved (1.3.14 → 1.4.0); `Checked 906 installs across 1042 packages (no changes)` otherwise. No transitive drift from dropping the override.

**Gates:** typecheck 38/38 (uncached), lint 0/0 across 1123 files, build 21/21, test:unit 41/41 tasks. The `@podkit/device-testing` unit task is vacuously green for reasons unrelated to this change — see TASK-482 — so the persona change was verified directly instead, by loading `personas/index.ts` at runtime (which runs `validatePersona()` over every persona) and confirming `sysInfoExtendedXml` holds real XML text.

Uncommitted pending maintainer review.
<!-- SECTION:NOTES:END -->
