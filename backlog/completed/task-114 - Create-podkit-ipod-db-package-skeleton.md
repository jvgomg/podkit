---
id: TASK-114
title: Create @podkit/ipod-db package skeleton
status: Done
assignee: []
created_date: '2026-03-12 10:52'
updated_date: '2026-04-03 20:26'
labels:
  - phase-0
milestone: ipod-db Core (libgpod replacement)
dependencies: []
references:
  - doc-003
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up the new `@podkit/ipod-db` package in the monorepo with build config, test setup, and directory structure.

**Package setup:**
- `packages/ipod-db/package.json` with name `@podkit/ipod-db`, TypeScript, Bun test runner
- `packages/ipod-db/tsconfig.json` extending root config
- Add to workspace in root `package.json`
- ESM module format matching other packages

**Directory structure (empty files with TODO comments):**
```
src/
  index.ts
  database.ts
  binary/reader.ts, writer.ts, errors.ts
  itunesdb/parser.ts, writer.ts, types.ts, records/
  artworkdb/parser.ts, writer.ts, ithmb.ts, pixel-formats.ts, types.ts
  device/sysinfo.ts, sysinfo-extended.ts, models.ts, types.ts
  hash/hash58.ts, hash72.ts, hashAB.ts, index.ts
  files/copy.ts, paths.ts
__tests__/
  binary/, itunesdb/, artworkdb/, device/, hash/, round-trip/, parity/, fixtures/
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Package builds successfully in monorepo
- [x] #2 bun test runs (even if no tests yet)
- [x] #3 Directory structure matches design document
- [x] #4 Package is importable from other workspace packages
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Shared with Virtual iPod milestone (m-17).** This package skeleton also serves the read-only parser needed for the virtual iPod web UI. Ensure `src/binary/reader.ts` works with both Node.js `Buffer` and browser `Uint8Array` — the virtual iPod runs in a web worker.
<!-- SECTION:NOTES:END -->
