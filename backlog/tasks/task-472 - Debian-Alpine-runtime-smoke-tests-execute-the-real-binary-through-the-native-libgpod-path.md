---
id: TASK-472
title: >-
  Debian + Alpine runtime smoke tests: execute the real binary through the
  native libgpod path
status: Done
assignee: []
created_date: '2026-08-04 15:16'
updated_date: '2026-08-04 19:48'
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
- [x] #1 A shared smoke script runs the real binary: --version, device scan --json, device info against a valid gpod-testing template (assert success/track count), and libudev-absent USB degrade
- [x] #2 CI runs the smoke: glibc binary in a Debian/Ubuntu container, musl binary in Alpine, wired into build-platform.yml/verify-release.yml
- [ ] #3 Local smoke runs via podkit-tests-debian-glibc + podkit-tests-alpine-musl (mise test:linux:debian/:alpine)
- [x] #4 The suite fails on a non-executing binary, a wrong-libc binary, or a silent libgpod-DB failure
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented + CI-validated (build-platform.yml run 30944521081, all 6 jobs green). Commits 71723a04 + a00b2b4c.

Shared script test-packages/e2e-shared/scripts/runtime-smoke.sh drives the REAL built binary: (1) --version executes; (2) device scan --json emits a well-formed envelope + clean exit; (3) device info --device <committed MA147 template> --json reads the iTunesDB THROUGH the native libgpod addon, asserting success==true + musicCount==0 (known count) + model.number==A147 — replaces the old weak "Could not read" check; (4) doctor inquiry-methods degrades cleanly (status=warn, doctor exits non-zero, no crash / no "Failed to load native") when the usb prebuild can't dlopen libudev.so.1 (zero-byte decoy on LD_LIBRARY_PATH), Linux-only.

Committed a ~12K MA147 fixture at test-packages/e2e-shared/fixtures/smoke-ipod (templates/ is gitignored/generated, so a stable committed fixture was needed). Wired into every Linux build job in build-platform.yml, folding the old isolated checks — runs the glibc binary in ubuntu:20.04 and the musl binary in Alpine, with no dependency on upload-artifacts. Added jq to the glibc image and lsblk+findmnt to the musl images (device scan needs lsblk; Alpine splits util-linux — matches the Docker runtime deps). shellcheck + actionlint clean.

AC#4: the suite fails on a non-executing binary (--version), a wrong-libc binary (won't run at all, caught upstream by the TASK-471 interpreter gate too), and a silent libgpod-DB failure (device info now asserts positive success + track count, not "no error").

AC#3 (local via mise test:linux:debian/:alpine): wired in tools/lima/run-tests.sh — after the suite, each VM ensures jq, runs `bun run compile`, and calls the same shared script against the VM-real-libc binary. Implemented but NOT run by me this session (CI validated the script itself on real glibc+musl); the local VM path is the user's to exercise (`mise run test:linux`).
<!-- SECTION:FINAL_SUMMARY:END -->
