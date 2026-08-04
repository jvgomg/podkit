---
id: TASK-471
title: >-
  Fail-closed linkage gates + interpreter assertion across all Linux binaries
  and .node prebuilds
status: Done
assignee: []
created_date: '2026-08-04 15:16'
updated_date: '2026-08-04 18:12'
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
- [x] #1 Every binary + .node linkage gate rejects the full forbidden lib set (glibc+musl × x64+arm64)
- [x] #2 Interpreter assertion on every produced binary AND .node: ld-linux-* in glibc jobs, ld-musl-* in musl jobs
- [x] #3 A wrong-libc .node/binary fails CI (regression guard for the ship bug + TASK-468)
- [x] #4 docker.yml fails if the binary it bakes into the Alpine image is not musl
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in .github/workflows/build-platform.yml + docker.yml (working tree only; not committed — CI validation is the lead's step).

Part 1 — full fail-closed linkage set (14 tokens: libgpod|libgdk_pixbuf|libglib|libgobject|libgio|libgmodule|libffi|libplist|libxml2|libsqlite|libpcre2|libpng|libjpeg|libtiff) now on EVERY Linux gate:
- musl-x64 binary smoke was the only subset (libgpod|libgdk_pixbuf) — aligned to full set.
- Verified already-full: musl-x64 .node verify, musl-arm64 .node verify + binary smoke (both heredocs), glibc binary smoke, and glibc .node (build-linux-glibc.sh:142). No change needed there.
- Darwin otool gates (build-platform.yml lines 109/148) intentionally LEFT as the libgpod|libglib|libgobject|libgdk_pixbuf subset — on macOS libxml2/libsqlite3/libffi/libz are system libs legitimately dynamically linked. AC#1 is Linux-scoped.

Part 2 — libc assertions (fail-closed; grep failure exits 1):
- Binary interpreter via `readelf -l` → `case` on "Requesting program interpreter": glibc job asserts ld-linux present + ld-musl absent; musl jobs assert ld-musl present + ld-linux absent. Covers podkit (all Linux jobs) AND podkit-daemon (musl jobs — glibc job compiles CLI only, no daemon).
- .node NEEDED-libc via `readelf -d` (a .node is ET_DYN with no PT_INTERP, so interpreter check is inapplicable — libc flavour is proven by DT_NEEDED). glibc .node MUST NEED libc.so.6 + MUST NOT NEED libc.musl-*; musl .node inverse. This is the direct TASK-468 guard. Added to musl-x64 + musl-arm64 .node verify steps, and a new unconditional step in the glibc job (runs on cache hit too, so a cache-restored musl .node still fails).

Part 3 — docker.yml "Prepare binaries for multi-arch build": added a fail-closed loop asserting all four baked binaries (amd64/arm64 × podkit/podkit-daemon) request ld-musl; a glibc/-gnu artifact slip now fails the build instead of shipping in the Alpine image. Informational `file` lines kept.

readelf availability (binutils) — added to always-run steps so gates survive prebuild cache hits:
- musl-x64: added `binutils` to the "Install Bun" apk (runs on every path; build-base only on cache-miss).
- musl-arm64 first heredoc: readelf from build-base (already present). Second heredoc: added `binutils` to its apk add.
- glibc: added `binutils` to "Install base tools" apt (always-run; build-essential only on cache-miss).
- docker.yml: ubuntu-latest ships readelf, no change.

Informational ldd/otool/file echo lines preserved throughout. No jobs/artifacts reordered or renamed — purely additive gates. `actionlint .github/workflows/build-platform.yml .github/workflows/docker.yml` → exit 0.

Note on AC#2 wording ("interpreter assertion on every ... .node"): a .node has no program interpreter, so the .node guard is the NEEDED-libc (readelf -d) check — the correct technical equivalent, satisfying the intent (libc match enforced on binary AND .node).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented + CI-validated (build-platform.yml run 30937005541, all 6 jobs green with the new gates). Commit 70d5f234.

AC#1: musl-x64 binary linkage grep aligned to the full 14-lib forbidden set; all Linux binary + .node gates now reject the full set (darwin intentionally left on its subset — libxml2/libsqlite3/libffi/libz are macOS system libs, legitimately dynamic; AC scopes to glibc+musl × x64+arm64).
AC#2: binary interpreter assertion via `readelf -l` on every produced Linux binary incl. podkit-daemon — glibc jobs require ld-linux, musl jobs ld-musl, wrong-one fails. For .node prebuilds (ET_DYN, no PT_INTERP) the equivalent is a `readelf -d` DT_NEEDED-libc assertion: glibc .node must NEED libc.so.6 (not libc.musl-*), musl .node the reverse.
AC#3: the .node NEEDED-libc gate is the direct TASK-468 regression guard (a musl .node on the glibc builder now fails CI). Gates are fail-closed by construction (case/explicit exit 1; empty readelf output falls through to exit 1) — verified by inspection; the run proved they pass on correct binaries without false-positives. binutils added to the musl + glibc build images for readelf.
AC#4: docker.yml "Prepare binaries" now asserts every baked binary (amd64/arm64 × podkit/podkit-daemon) requests the ld-musl interpreter — an -gnu naming slip can no longer ship a glibc binary in the Alpine image.
actionlint clean. Informational ldd/otool/file lines preserved.
<!-- SECTION:FINAL_SUMMARY:END -->
