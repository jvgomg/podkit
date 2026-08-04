---
id: TASK-471
title: >-
  Fail-closed linkage gates + interpreter assertion across all Linux binaries
  and .node prebuilds
status: To Do
assignee: []
created_date: '2026-08-04 15:16'
labels:
  - ci
  - build
  - libgpod-node
milestone: m-23
dependencies:
  - TASK-470
references:
  - adr/adr-026-dual-libc-linux-distribution.md
  - doc-057
  - .github/workflows/build-platform.yml
  - .github/workflows/docker.yml
priority: high
ordinal: 231000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the static-linking invariant enforced, not assumed, and add the single guard that catches both the shipping bug and TASK-468.

- **Complete + fail-closed linkage gates**: every produced binary/`.node` (glibc + musl × x64 + arm64) must reject the **full** forbidden set (`libgpod|libglib|libgobject|libgio|libgmodule|libgdk_pixbuf|libffi|libplist|libxml2|libsqlite|libpcre2|libpng|libjpeg|libtiff`). Today coverage is uneven — the musl-x64 binary smoke greps only `libgpod|libgdk_pixbuf` (`build-platform.yml:317`), darwin a subset (`:138`); align all to the full set used at `build-platform.yml:284` / `build-linux-glibc.sh:142`.
- **Interpreter assertion (the universal regression guard)**: on every produced binary AND `.node`, assert the program interpreter matches the intended libc — `readelf -l` → `ld-linux-*` in glibc jobs, `ld-musl-*` in musl jobs (incl. the new glibc CLI job from TASK-470; a stray musl prebuild there would reproduce TASK-468 in CI).
- **docker.yml interpreter gate**: the "Prepare binaries" step (`docker.yml:58-69`) already runs `file`; make it **fail** if the interpreter isn't musl, so an artifact-naming slip can't ship a glibc binary in the Alpine image.

Depends on TASK-470 (the glibc job must exist to gate it).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every binary + .node linkage gate rejects the full forbidden lib set (glibc+musl × x64+arm64)
- [ ] #2 Interpreter assertion on every produced binary AND .node: ld-linux-* in glibc jobs, ld-musl-* in musl jobs
- [ ] #3 A wrong-libc .node/binary fails CI (regression guard for the ship bug + TASK-468)
- [ ] #4 docker.yml fails if the binary it bakes into the Alpine image is not musl
<!-- AC:END -->
