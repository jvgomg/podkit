---
id: TASK-162
title: 'Daemon: device polling and sync orchestration (end-to-end tracer bullet)'
status: Done
assignee: []
created_date: '2026-03-18 23:56'
updated_date: '2026-03-19 14:54'
labels:
  - daemon
  - docker
dependencies:
  - TASK-161
references:
  - packages/e2e-tests/src/helpers/cli-runner.ts
  - packages/podkit-core/src/device/platforms/linux.ts
  - docker/entrypoint.sh
  - docker/Dockerfile
documentation:
  - backlog/documents/doc-004.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the `packages/podkit-daemon` package — a Bun-compiled binary that runs inside a Docker container, polls for iPod devices, and automatically syncs them using the CLI.

This is the core tracer bullet: the thinnest possible end-to-end path through every layer. When complete, a user can plug in an iPod and see it auto-detected, mounted, synced, and ejected — verified via `docker logs`. No notifications yet (that's TASK-163).

The daemon is a thin CLI wrapper — it does NOT load config files or create adapters. It shells out to the `podkit` CLI binary for all sync operations. The CLI handles config, device resolution, and UUID matching (via TASK-161's smart device resolution). The daemon just passes `--device /ipod` and the CLI figures out the rest.

See PRD doc-004 (Docker Daemon Mode) for the full architecture and design decisions.

### Modules to implement

1. **Device Poller** — Polls `lsblk --json` at a configurable interval (env var `PODKIT_POLL_INTERVAL`, default 5s). Compares snapshots to detect new block devices. Reuses iPod detection heuristics from `@podkit/core` (USB vendor ID `0x05ac` via `/sys/bus/usb/devices/`, FAT32 partition type). Emits device-appeared/device-disappeared events.

2. **CLI Runner** — Shells out to the `podkit` CLI binary with `--json`. Parses results into typed objects. Similar pattern to the existing e2e-tests cli-runner (`packages/e2e-tests/src/helpers/cli-runner.ts`).

3. **Sync Orchestrator** — State machine for one sync cycle:
   - Mount: `podkit mount --disk /dev/sdXN --target /ipod --json`
   - Dry-run: `podkit sync --device /ipod --dry-run --json`
   - Sync: `podkit sync --device /ipod --json`
   - Eject: `podkit eject --device /ipod --json`
   - Handles errors at each stage (mount failure, sync failure) and logs them
   - Enforces one-device-at-a-time
   - The CLI's smart device resolution (TASK-161) handles UUID matching — the daemon doesn't need to know about device names or config

4. **Entry point** — Reads daemon env vars (PODKIT_POLL_INTERVAL, PODKIT_APPRISE_URL), wires modules, starts poll loop. Logs activity to stdout for `docker logs`.

### Build target

Bun-compiled binary (like the CLI). Built with `bun build --compile`.

### Docker changes

- Add `daemon` to known commands in `docker/entrypoint.sh`
- Update Dockerfile to include the daemon binary alongside the CLI binary
- The daemon inherits the same env vars as the CLI (PODKIT_CONFIG, PODKIT_* settings)

### Package structure

- Private workspace package: `@podkit/podkit-daemon`
- TypeScript, ESM, follows existing monorepo conventions
- Depends on `@podkit/core` for device detection heuristics (lsblk parsing, iPod identification)
- Does NOT depend on CLI package (invokes CLI as subprocess)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Device Poller detects new iPod block devices by comparing lsblk snapshots and logs detection to stdout
- [x] #2 Device Poller ignores non-iPod USB devices (no false positives)
- [x] #3 Device Poller respects PODKIT_POLL_INTERVAL env var (default 5s)
- [x] #4 Sync Orchestrator executes the full mount → dry-run → sync → eject cycle via CLI subprocess calls
- [x] #5 Sync Orchestrator handles mount failure gracefully (logs error, continues polling)
- [x] #6 Sync Orchestrator handles sync failure gracefully (still ejects device, logs error)
- [x] #7 Sync Orchestrator enforces one sync at a time (ignores new devices while syncing)
- [x] #8 CLI Runner parses JSON output from mount, sync, and eject commands into typed objects
- [x] #9 Entry point reads PODKIT_POLL_INTERVAL env var
- [x] #10 Docker entrypoint recognizes 'daemon' command and starts the daemon binary
- [x] #11 Dockerfile includes the daemon binary alongside the CLI binary
- [x] #12 Daemon is compiled as a standalone Bun binary
- [x] #13 Unit tests for Device Poller with mocked lsblk JSON snapshots
- [x] #14 Integration tests for Sync Orchestrator with mocked CLI Runner
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

### Package: `packages/podkit-daemon`

**Source modules:**
- `cli-runner.ts` — Shells out to `podkit` binary with `--json` global flag. Provides `runMount`, `runSync`, `runEject` helpers.
- `device-poller.ts` — EventEmitter polling `lsblk --json`. Detects iPods by FAT32 + Apple USB vendor ID (`0x05ac`). Snapshot diffing for appeared/disappeared events. Concurrent poll guard.
- `sync-orchestrator.ts` — State machine: mount → dry-run → sync → eject. One-at-a-time enforcement. Error handling ensures eject always runs. `waitForIdle()` for graceful shutdown.
- `logger.ts` — Structured logging to stdout with ISO timestamps.
- `main.ts` — Entry point. Reads `PODKIT_POLL_INTERVAL` (with NaN guard) and `PODKIT_APPRISE_URL`. Graceful shutdown waits for in-progress sync before exit.

**Tests (17 passing):**
- `device-poller.test.ts` — lsblk JSON parsing, partition collection, EventEmitter contract
- `sync-orchestrator.test.ts` — Happy path, mount/sync/eject failures, one-at-a-time, error recovery

**Docker changes:**
- `docker/entrypoint.sh` — `daemon` added to known commands, handler execs `podkit-daemon` binary
- `docker/Dockerfile` — COPY for daemon binary alongside CLI binary, daemon is opt-in (default CMD remains `sync`)

### Review findings fixed
- **Critical:** `--json` must precede subcommand (Commander global flag) — fixed all 3 CLI calls
- **Critical:** `runEject` used nonexistent `--device` subcommand flag — fixed to use global `-d`
- **High:** NaN guard on `PODKIT_POLL_INTERVAL` — `Math.max(1, ... || 5)`
- **High:** Concurrent poll guard — `this.polling` flag prevents overlapping lsblk calls
- **High:** Graceful shutdown waits for in-progress sync via `waitForIdle()` before `process.exit`
- Fixed `@types/node` version conflict (daemon's `^22.0.0` downgraded root types, breaking core build)
<!-- SECTION:NOTES:END -->
