---
id: TASK-321.04
title: Subprocess snapshot framework (capture + replay)
status: Done
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-13 17:41'
labels:
  - testing
  - vm-coverage
  - foundation
milestone: m-19
dependencies:
  - TASK-290
modified_files:
  - packages/device-types/src/index.ts
  - packages/device-types/src/subprocess.ts
  - packages/device-testing/src/index.ts
  - packages/device-testing/src/subprocess.ts
  - packages/device-testing/src/subprocess.md
  - packages/device-testing/src/subprocess.test.ts
  - packages/device-testing/README.md
  - packages/podkit-core/src/index.ts
  - packages/podkit-core/src/subprocess-runner.ts
  - packages/podkit-core/src/device/usb-enumeration.ts
  - packages/podkit-core/src/device/usb-path-resolution.ts
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/platforms/linux.ts
  - packages/podkit-core/src/diagnostics/checks/video-encoder.ts
  - packages/podkit-core/src/transcode/ffmpeg.ts
parent_task_id: TASK-321
priority: medium
ordinal: 240
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Most macOS-specific and some Linux-specific discovery code spawns subprocesses (`system_profiler`, `diskutil`, `lsblk`, `lsusb`, `ffmpeg`). To make these paths deterministic in Tier 1 unit tests, introduce a small **subprocess snapshot framework** inside `@podkit/device-testing`:

1. **Injection point**: a `SubprocessRunner` abstraction (or function ref) at every callsite that today spawns one of these tools. Existing callsites must be refactored to use the abstraction; the default implementation continues to call the real subprocess.

2. **Capture mode**: when `PODKIT_SNAPSHOT_CAPTURE=1`, the framework records the command, args, and full output to a JSON fixture file keyed by a stable hash of the command + args.

3. **Replay mode**: when a test injects a `ReplaySubprocessRunner` pointed at a fixture directory, the runner returns the recorded output for matching commands and throws on misses.

4. **Storage**: fixtures live in the relevant persona's directory under `@podkit/device-testing` (per-persona) and a shared directory for environment-independent fixtures (e.g., FFmpeg `-encoders` listing).

Scope:
- Implement `SubprocessRunner` abstraction in `packages/device-testing/src/subprocess.ts`
- Refactor existing callsites (`packages/podkit-core/src/device/platforms/`, `packages/ipod-firmware/`, ffmpeg invocations in core) to use the abstraction
- No new tests in this task — those come with the persona tasks and TASK-301–311

Reference: the existing injection patterns in `packages/ipod-firmware/src/inquiry/{usb,scsi,probe}.ts` are the model for shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SubprocessRunner abstraction defined in packages/device-testing/src/subprocess.ts and exported from the package
- [x] #2 All existing callsites of system_profiler, diskutil, lsblk, lsusb, ffmpeg/ffprobe in podkit-core and ipod-firmware use the abstraction; default impl preserves current behaviour
- [x] #3 PODKIT_SNAPSHOT_CAPTURE=1 mode captures real subprocess output to JSON keyed by a stable hash
- [x] #4 Replay mode loads captured JSON and returns recorded output; missing fixtures throw a clear error pointing at the capture command
- [x] #5 A small README documents how to add a new subprocess callsite and how to capture fresh fixtures
- [x] #6 All existing unit tests pass with no behavioural change
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation notes / divergences

### Interface location: `@podkit/device-types`, not `@podkit/device-testing`
The task spec floated putting the interface in either `podkit-core` (local re-decl) or `device-types`. I chose `device-types` because (1) it has no `@podkit/core` dep, so production packages can import the type without cycling; (2) it gives a single canonical home shared by both `@podkit/device-testing` (which already depends on `device-types`) and `@podkit/core`.

Cycle audit: `@podkit/core` imports only the *interface* from `@podkit/device-types`, never any runtime symbol. `@podkit/device-testing` depends on `@podkit/core` (per TASK-321.01), so the chain is `device-testing → core → device-types` — strictly DAG, no cycle.

### Default runner duplicated, not shared
`defaultSubprocessRunner` exists in both `@podkit/device-testing/src/subprocess.ts` and `@podkit/core/src/subprocess-runner.ts`. They are byte-equivalent and trivially small (one `execFile` wrapper). Sharing would either force production to depend on `@podkit/device-testing` (rejected by task constraint) or move the implementation into `@podkit/device-types` (which would no longer be a types-only package). The duplication is acceptable given the size and isolation.

### Streaming spawns left alone
The task description says "every callsite" of ffmpeg/ffprobe, but the streaming `FFmpegTranscoder.transcode()`, `video/transcode.ts:transcodeVideo`, `video/probe.ts:probeVideo`, `video/metadata-embedded.ts`, `sync/music/pipeline.ts` ffmpeg spawn, and `artwork/resize.ts` ffmpeg spawn all consume stdout progress in real time. `SubprocessRunner.run` is a request/response shape and cannot preserve that semantic. These callsites already have their own `_spawnFn` DI seam for test injection. Switching them would (a) require widening `SubprocessRunner` or (b) drop progress reporting. I left them on `spawn` and documented this in `subprocess.md`. Hooking them into the snapshot framework can ship as its own task with a wider `SubprocessRunner` (e.g. `runStreaming(...)` returning an event emitter).

### Diagnostics `video-encoder` check uses default runner directly
The check signature `check(ctx: DiagnosticContext)` doesn't carry a subprocess; plumbing one through `DiagnosticContext` would be a much wider refactor. I routed `ffmpegEncoders()` through the abstraction but pass `defaultSubprocessRunner` from the check itself. Future task can widen `DiagnosticContext`.

### Linux device manager's `mount`/`umount` semantics preserved
Original `execCommand` returned `code: 1` on transport failure (binary not found, etc.) rather than throwing. My replacement preserves that contract exactly by try/catch around `subprocess.run` and collapsing rejections into `code: 1` — the surrounding code in those files inspects `code` and acts accordingly, so the behaviour is identical.

### FFmpegTranscoder.exec()'s signal abort dropped
`FFmpegTranscoder.exec()` previously installed an `AbortSignal` handler in its private exec method, but no caller ever passed a signal (verified via grep). The new version drops the dead signal plumbing; `transcode()`'s streaming spawn still installs its own signal handler.

### Env merging
`opts.env` is merged onto `process.env` by `defaultSubprocessRunner` (same semantics as the previous ad-hoc `execFile` calls). The hash function treats `env: undefined` and `env: null` as equivalent so fixtures captured without explicit env still replay against calls that pass `env: undefined`.

### Fixture storage convention
Capture/replay runners take a directory string and don't know about persona layout. The convention is (per task spec): `packages/device-testing/src/personas/<id>/subprocess-fixtures/` for per-persona, `packages/device-testing/fixtures/shared/` for environment-independent. Enforcement happens at test sites that choose which dir to point at — documented in `subprocess.md`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Subprocess snapshot framework (capture + replay)

### What shipped
- `SubprocessRunner` interface relocated to `@podkit/device-types` (no `@podkit/core` dep) so production packages can DI against it without importing the test harness.
- `@podkit/device-testing/subprocess.ts` rewritten as full framework: `defaultSubprocessRunner`, `CapturingSubprocessRunner`, `ReplaySubprocessRunner`, `createSubprocessRunner(env)`, `hashSubprocessCall`, `SubprocessFixture` type. Hash is `sha256({command, args, cwd, env})` truncated to 16 hex chars; env-key order is normalised before hashing.
- New `@podkit/core` local re-implementation `packages/podkit-core/src/subprocess-runner.ts` provides `defaultSubprocessRunner` — production never imports `@podkit/device-testing`.
- 21 framework unit tests (`packages/device-testing/src/subprocess.test.ts`) covering default runner, hash stability, capture+replay round-trip, missing-fixture error format, and env-var factory selection.
- README at `packages/device-testing/src/subprocess.md` documents capture flow, fixture layout (per-persona vs `fixtures/shared/`), and the missing-fixture → capture-command error pattern.

### Refactored callsites (default behaviour preserved)
- `packages/podkit-core/src/device/usb-enumeration.ts` — `enumerateUsb({ subprocess? })` for macOS `system_profiler`.
- `packages/podkit-core/src/device/usb-path-resolution.ts` — `resolveUsbDeviceFromPath({ subprocess? })` for macOS `diskutil` + `system_profiler`.
- `packages/podkit-core/src/device/platforms/macos.ts` — `MacOSDeviceManager` constructor takes `{ subprocess? }`; every `diskutil`/`system_profiler`/`mount` call routed through it.
- `packages/podkit-core/src/device/platforms/linux.ts` — `LinuxDeviceManager` constructor takes `{ subprocess? }`; every `lsblk`/`mount`/`umount`/`udisksctl`/`which` call routed.
- `packages/podkit-core/src/diagnostics/checks/video-encoder.ts` — `ffmpeg -encoders` routed via default runner.
- `packages/podkit-core/src/transcode/ffmpeg.ts` — `FFmpegTranscoderConfig` gains `subprocess`; the short-lived `exec()` private method (used for `ffmpeg -version`, `-encoders`, and `ffprobe`) routes through it.

### Divergences from spec (see implementationNotes)
- Streaming spawns (FFmpeg `transcode()`, video probe/transcode/metadata-embedded, music pipeline transcode, artwork resize) still use direct `spawn` and their existing `SpawnFn` DI — the `SubprocessRunner.run` contract is request/response and can't preserve real-time stdout progress consumption. Documented in `subprocess.md`.

### Quality gates (all green except an unrelated docs-site link)
- `bun run typecheck` — pass.
- `bun run build` — pass for every code package; `@podkit/docs-site` fails on a pre-existing broken link (`../../backlog/docs/` from `reference/codec-support/`) unrelated to this change.
- `bun run test:unit` — 1173/1173 pass + every other package green; `@podkit/core` 2459/2459, `@podkit/ipod-firmware` 226/226, `@podkit/device-testing` 81 pass + 2 skip (subprocess framework included).
- `bunx oxlint packages/device-testing packages/podkit-core packages/ipod-firmware` — 0 errors; the single pre-existing `mass-storage-tag-writer.ts:52` `eslint-plugin-unicorn(no-new-array)` warning is unrelated.

Reviewer follow-ups folded in by team-lead: (1) added `defaultSubprocessRunner` stub + `SubprocessRunner` type re-exports to `packages/demo/src/mock-core.ts` to satisfy the mock-core.check.ts symmetry assertion (TS2344 blocker); (2) deduplicated the runner in `@podkit/device-testing/src/subprocess.ts` to import `defaultSubprocessRunner` from `@podkit/core` rather than maintain a copy, since `@podkit/device-testing` already depends on `@podkit/core` (no new cycle). Full workspace typecheck pass, core 2459/2459, device-testing 81 pass + 2 skip.
<!-- SECTION:FINAL_SUMMARY:END -->
