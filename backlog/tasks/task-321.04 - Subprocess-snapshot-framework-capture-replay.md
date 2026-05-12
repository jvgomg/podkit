---
id: TASK-321.04
title: Subprocess snapshot framework (capture + replay)
status: To Do
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-12 08:16'
labels:
  - testing
  - vm-coverage
  - foundation
milestone: m-19
dependencies:
  - TASK-290
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
- [ ] #1 SubprocessRunner abstraction defined in packages/device-testing/src/subprocess.ts and exported from the package
- [ ] #2 All existing callsites of system_profiler, diskutil, lsblk, lsusb, ffmpeg/ffprobe in podkit-core and ipod-firmware use the abstraction; default impl preserves current behaviour
- [ ] #3 PODKIT_SNAPSHOT_CAPTURE=1 mode captures real subprocess output to JSON keyed by a stable hash
- [ ] #4 Replay mode loads captured JSON and returns recorded output; missing fixtures throw a clear error pointing at the capture command
- [ ] #5 A small README documents how to add a new subprocess callsite and how to capture fresh fixtures
- [ ] #6 All existing unit tests pass with no behavioural change
<!-- AC:END -->
