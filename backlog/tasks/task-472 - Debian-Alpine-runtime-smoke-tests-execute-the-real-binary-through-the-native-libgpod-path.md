---
id: TASK-472
title: >-
  Debian + Alpine runtime smoke tests: execute the real binary through the
  native libgpod path
status: In Progress
assignee: []
created_date: '2026-08-04 15:16'
updated_date: '2026-08-04 18:13'
labels:
  - ci
  - test
  - vm
  - libgpod-node
milestone: m-23
dependencies:
  - TASK-470
references:
  - adr/adr-026-dual-libc-linux-distribution.md
  - doc-057
  - .github/workflows/build-platform.yml
  - .github/workflows/verify-release.yml
  - test-packages/gpod-testing/templates
  - mise.toml
priority: high
ordinal: 232000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the runtime gate whose absence let a non-executing binary ship. A shared smoke script runs the **actual built binary** on both distros and exercises the code paths that silently broke:

- `podkit --version` — proves it executes at all (the literal glibc failure).
- `podkit device scan --json` — USB-walk / sysfs path.
- **Native libgpod read through the addon** — `podkit device info --device <dir>` against a **valid `gpod-testing` template** iPod dir (real gpod-tool-generated `iTunesDB`, e.g. MA147), asserting **success / a known track count**. NOT the pure-TS `packages/ipod-db/fixtures/**` DBs (they exercise `@podkit/ipod-db`, never the native binding), and NOT the current gate's weak "returned an error" check (`build-platform.yml:157`).
- `podkit doctor` `inquiry-methods` USB path **degrades cleanly on a host without libudev** (explicit assertion, both libcs).

Run in **CI**: the glibc binary in a Debian/Ubuntu container, the musl binary in Alpine; wire into `build-platform.yml` / `verify-release.yml` so a wrong-libc / non-executing / silent-libgpod-failure binary fails the release. Run **locally** via `podkit-tests-debian-glibc` + `podkit-tests-alpine-musl` (`mise test:linux:debian` / `:alpine`). Fold the existing Alpine "binding loads (isolated)" gate into this shared harness.

Depends on TASK-470 (needs the glibc binary to smoke on Debian).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A shared smoke script runs the real binary: --version, device scan --json, device info against a valid gpod-testing template (assert success/track count), and libudev-absent USB degrade
- [ ] #2 CI runs the smoke: glibc binary in a Debian/Ubuntu container, musl binary in Alpine, wired into build-platform.yml/verify-release.yml
- [ ] #3 Local smoke runs via podkit-tests-debian-glibc + podkit-tests-alpine-musl (mise test:linux:debian/:alpine)
- [ ] #4 The suite fails on a non-executing binary, a wrong-libc binary, or a silent libgpod-DB failure
<!-- AC:END -->
