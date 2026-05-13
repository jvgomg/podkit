---
id: TASK-321
title: 'Phase 1: test harness foundations'
status: Done
assignee: []
created_date: '2026-05-11 22:55'
updated_date: '2026-05-13 18:06'
labels:
  - testing
  - vm-coverage
  - foundation
milestone: m-19
dependencies:
  - TASK-290
priority: high
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task for the foundational package and conventions that the VM test harness depends on. Delivers the **shared infrastructure** consumed by both Tier 1 (native unit tests with injectable transports) and Tier 3 (Linux VM with real USB synthesis).

Scope is foundation-only — no test implementation here. Test implementation lives in TASK-301–311 (already in m-19) and Phase 3 integration tasks (TASK-322.*).

Subtasks deliver:
- `packages/device-testing/` — single package consolidating `DevicePersona`, `SystemState`, `TestRuntime` interface + `local-linux` runner, and the subprocess snapshot framework
- 3 starter `DevicePersona` captures from real hardware
- Initial `SystemState` registry (5–6 entries: healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs)
- Per-OS test tagging convention (`*.darwin.test.ts` / `*.linux.test.ts`)
- Linux native build pipeline: builder Lima VM + turbo-cached `build:linux-prebuild` and `build:linux-binary` tasks, sharing native-build implementation with existing GHA (`prebuild.yml`, `tools/prebuild/build-static-deps.sh`) — no duplicate build code

Depends on TASK-290 (ADRs accepted) for schema/architecture decisions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All Phase 1 subtasks are Done
- [x] #2 `packages/device-testing/` exists as a single package exporting DevicePersona, SystemState, TestRuntime, runners, and snapshot framework
- [x] #3 5+ SystemState entries in registry, each with expected doctor-system-output
- [x] #4 TestRuntime interface + working local-linux runner that executes test commands natively when host is Linux
- [x] #5 Subprocess snapshot framework supports capture and replay against fixture JSON files; injection points wired into existing subprocess call sites
- [x] #6 Per-OS test tagging convention is documented in agents/testing.md and the Bun runner skips mismatched-OS tests cleanly
- [x] #7 Builder Lima VM yaml exists (`tools/device-testing/lima/builder.yaml`) and turbo tasks `build:linux-prebuild` and `build:linux-binary` produce cached artefacts
- [ ] #8 Existing GHA `prebuild.yml` refactored so the builder VM and CI share native-build implementation; no duplicated build commands
- [x] #9 A trivial smoke test imports a persona from device-testing and runs it through an injected transport in a Tier 1 unit test
- [ ] #10 3 starter DevicePersona captures committed (ipod-video-5g-fresh, ipod-nano-7g-populated, echo-mini-empty) with provenance.md
- [x] #11 agents/testing.md updated to include a section on the three-tier test stack and when each tier runs
- [x] #12 agents/device-testing.md exists and covers the DevicePersona schema, human-in-the-loop capture flow, SystemState registry, runner ops, and tagging convention
- [x] #13 TASK-301..TASK-311 descriptions each include a note referencing @podkit/device-testing, DevicePersona, SystemState, and the lima-test-vm runner so implementers pick up the new stack
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Phase 1 foundations — shipped on `feat/m-19-phase-1`

All Phase 1 subtasks Done except TASK-321.02 (hardware persona captures), deferred as HITL — needs physical iPod 5G Video iFlash, iPod nano 7G, and Echo Mini sessions with the user. AC #10 remains unchecked for that reason. AC #8 partially met — `prebuild.yml` glibc path is refactored to invoke the shared script; `build-platform.yml` has no glibc Linux path today (Alpine/musl only), nothing to refactor there.

### Subtasks complete
- **321.01** — `@podkit/device-testing` package scaffold: `DevicePersona` + `SystemState` types (verbatim per ADR-017), empty registries, `TestRuntime` + `local-linux` runner, runner registry with auto-registration, `SubprocessRunner` placeholder, stub turbo `test:vm`, README, smoke tests.
- **321.04** — Full subprocess capture/replay framework. `SubprocessRunner` interface in `@podkit/device-types` (cycle-free), `defaultSubprocessRunner` in `@podkit/core`. `CapturingSubprocessRunner` (`PODKIT_SNAPSHOT_CAPTURE=1`), `ReplaySubprocessRunner` (`PODKIT_SNAPSHOT_REPLAY=1`), factory selection. Refactored every short-lived subprocess callsite in `podkit-core` (`usb-enumeration`, `usb-path-resolution`, `device/platforms/{macos,linux}`, `diagnostics/checks/video-encoder`, `transcode/ffmpeg.exec`) to accept an injectable runner. Streaming spawns left on existing `_spawnFn` DI with documented rationale. 21 framework tests.
- **321.05** — Per-OS test tagging convention (`*.darwin.test.ts` / `*.linux.test.ts`) documented in `agents/testing.md` with the `describe.skipIf` pattern; canary tests in `packages/device-testing/src/__tests__/`.
- **321.06** — SystemState registry populated with 6 starter states (`healthy`, `no-ffmpeg`, `no-libgpod`, `no-udev`, `no-sg-perms`, `corrupt-configfs`) — each in its own file with synthesised `expectedDoctorSystemOutput` JSON. Check IDs aligned with existing diagnostics-registry ids where they exist (codec-encoders, video-encoder, inquiry-methods, udev-rule). Golden file for `healthy` at `__fixtures__/healthy-doctor-output.golden.json`. README + smoke test.
- **321.07** — Linux native build pipeline. Single shared script `tools/prebuild/build-linux-glibc.sh` invoked by both `.github/workflows/prebuild.yml` (glibc matrix) AND Lima builder VM at `tools/device-testing/lima/builder.yaml`. Stock-Debian ABI verify VM at `tools/device-testing/lima/abi-verify.yaml`. Turbo tasks `@podkit/device-testing#build:linux-prebuild` + `@podkit/device-testing#build:linux-binary`. Mise tasks `device-testing:build-linux*`. ABI spike (AC #12) **ran end-to-end on aarch64 Apple Silicon Lima**: `ldd /usr/local/bin/podkit` on stock Debian 12.10 reported only `linux-vdso`, `libc`, `libpthread`, `libdl`, `libm`, `ld-linux-aarch64` — zero libgpod/libglib/libgdk_pixbuf/libplist references. x64 verification deferred to first CI run on `ubuntu-24.04`.
- **321.08** — `agents/testing.md` Three-Tier section + new `agents/device-testing.md` canonical reference + harness sweep applied to all 11 tasks TASK-301..311. The canonical block from the brief was used for 301–308; tailored variants for 309 (capabilities focus), 310 (golden-file focus), and 311 (explicit T2 tagging with `lsblkJson` / `systemProfilerJson`).

### Quality gates (final state of the branch)
- `bun run typecheck` — pass (FULL TURBO).
- `bun run test:unit` — all packages green; `@podkit/core` 2459/2459, `@podkit/ipod-firmware` 226/226, `@podkit/device-testing` 81 pass + 2 skip.
- `bunx oxlint .` — 0 errors; 1 pre-existing warning in `mass-storage-tag-writer.ts` (unrelated).
- `bunx prettier --check` on all new `.md` files — clean.

### Deferred
- **TASK-321.02 (HITL)** — 3 persona captures need physical hardware sessions. Capture script (`packages/device-testing/scripts/capture-persona.ts`) and provenance workflow are referenced in `agents/device-testing.md` as forthcoming. Schema is ready; only awaits the hardware.

### Known follow-ups (not blocking Phase 1 close)
- Local ABI spike was aarch64-only (Apple Silicon Lima default). x64 verification first happens on the next CI run.
- Streaming ffmpeg/spawn callsites not threaded through `SubprocessRunner` — `runStreaming` extension or wider refactor is a separate ticket.
- Diagnostics `video-encoder` check passes `defaultSubprocessRunner` directly because `DiagnosticContext` doesn't carry a subprocess; widening `DiagnosticContext` is a separate ticket.
<!-- SECTION:FINAL_SUMMARY:END -->
