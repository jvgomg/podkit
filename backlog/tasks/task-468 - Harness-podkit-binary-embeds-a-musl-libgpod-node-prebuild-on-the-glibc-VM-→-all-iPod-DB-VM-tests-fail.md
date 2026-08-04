---
id: TASK-468
title: >-
  Harness podkit binary embeds a musl libgpod-node prebuild on the glibc VM →
  all iPod-DB VM tests fail
status: To Do
assignee: []
created_date: '2026-07-13 22:59'
updated_date: '2026-08-04 15:17'
labels:
  - bug
  - vm
  - build
  - libgpod-node
milestone: m-23
dependencies: []
references:
  - test-packages/device-testing/scripts/harness.ts
  - packages/libgpod-node/src/binding.ts
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - adr/adr-026-dual-libc-linux-distribution.md
  - doc-057
  - TASK-469
  - TASK-473
priority: high
ordinal: 228000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`harness:setup` / `vm:install` builds a **glibc** podkit binary (interpreter `/lib/ld-linux-aarch64.so.1`, via the `podkit-linux-builder` glibc builder) but the **libgpod-node native prebuild embedded inside it is musl-linked**. On the Debian glibc harness VM, loading the binding fails at runtime:

```
Failed to open database: Failed to load native binding: libc.musl-aarch64.so.1: cannot open shared object file
```

So every VM test that reads/writes the iTunesDB fails, while device-*scan* tests (which don't touch the DB) pass. This is the entire remaining `test:vm` failure set after the USB-enumeration-race fix (TASK-tracked separately): from a from-scratch VM, `test:vm` = 8 failures, all this one cause:

- `save-failure-matrix` — 6 cells (ipod-noart / ipod-artwork × itunesdb-readonly / track-readonly): pre-seed first sync fails to open the DB.
- `pre-sync-sweep` — "planted .podkit-tmp under iPod_Control/" dry-run: "Cannot read iPod database ... Missing iTunesDB file" (binding load failure surfaces as an invalid-iPod message).
- `doctor-sysinfo-modelnum-mismatch` — device-scope doctor returns `checks: []` + "An unexpected error occurred".

The binary itself is correctly glibc (it runs and produces device-scan output); the mismatch is *within* the bundle — `bun build --compile` embedded the musl libgpod-node prebuild instead of the glibc one. Likely a regression from the recent musl-builder work (`afdaf27d` local musl binary builder, `3ef29560` Tier-5 docker-dist + harness hardening) — the libgpod-node prebuild selection in the compile/bundler path picks musl for the glibc harness target.

Repro: `bun run harness:setup`, then run any DB-touching command against a mounted persona (e.g. the save-failure matrix, or `podkit device doctor` on a mounted iPod) → the musl-binding load error.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root-cause which build/bundle step embeds the musl libgpod-node prebuild into the glibc harness binary (bun --compile prebuild selection / bundler plugin)
- [ ] #2 The harness podkit binary loads a glibc libgpod-node binding on the Debian VM (verify at runtime + via the embedded prebuild's libc)
- [ ] #3 test:vm's DB-dependent tests pass: save-failure-matrix (6 cells), pre-sync-sweep, doctor-sysinfo-modelnum-mismatch
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Superseded by the m-23 decomposition: the fix is TASK-469 (libc-explicit prebuild selection in compile.sh) + TASK-473 (harness installs the glibc binary). The root cause here (glibc-runtime binary embedding a musl .node) is the harness manifestation of the broader dual-libc distribution gap captured in ADR-026 / doc-057. Close this when TASK-469 + TASK-473 land; the interpreter assertion in TASK-471 is its CI regression guard.
<!-- SECTION:NOTES:END -->
