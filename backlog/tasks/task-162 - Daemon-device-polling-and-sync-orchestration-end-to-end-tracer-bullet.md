---
id: TASK-162
title: 'Daemon: device polling and sync orchestration (end-to-end tracer bullet)'
status: To Do
assignee: []
created_date: '2026-03-18 23:56'
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
Create the `packages/podkit-daemon` package — a Node.js process that runs inside a Docker container, polls for iPod devices, and automatically syncs them using the CLI.

This is the core tracer bullet: the thinnest possible end-to-end path through every layer. When complete, a user can plug in an iPod and see it auto-detected, mounted, synced, and ejected — verified via `docker logs`. No notifications yet (that's a follow-up task).

See PRD doc-004 (Docker Daemon Mode) for the full architecture and design decisions.

### Modules to implement

1. **Device Poller** — Polls `lsblk --json` at a configurable interval (env var `PODKIT_POLL_INTERVAL`, default 5s). Compares snapshots to detect new block devices. Uses iPod detection heuristics: USB vendor ID `0x05ac` via `/sys/bus/usb/devices/`, partition type (FAT32). Emits device-appeared/device-disappeared events.

2. **CLI Runner** — Shells out to the `podkit` CLI binary with `--output json`. Parses results into typed objects. Similar pattern to the existing e2e-tests cli-runner (`packages/e2e-tests/src/helpers/cli-runner.ts`).

3. **Sync Orchestrator** — State machine for one sync cycle:
   - Mount: `podkit mount --disk /dev/sdXN --target /ipod --output json`
   - Dry-run: `podkit sync --device /ipod --dry-run --output json`
   - Sync: `podkit sync --device /ipod --output json`
   - Eject: `podkit eject --device /ipod --output json`
   - Handles errors at each stage (mount failure, sync failure) and logs them
   - Enforces one-device-at-a-time

4. **Entry point** — Reads daemon env vars, wires modules, starts poll loop. Logs activity to stdout for `docker logs`.

### Docker changes

- Add `daemon` to known commands in `docker/entrypoint.sh`
- Update Dockerfile to include the daemon entry point (Node.js script alongside CLI binary)
- The daemon uses the same config file (`PODKIT_CONFIG`) and env vars as the CLI

### Package structure

- Private workspace package: `@podkit/podkit-daemon`
- TypeScript, ESM, follows existing monorepo conventions (see `packages/gpod-testing/package.json` for reference)
- FAT32 filesystem only
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Device Poller detects new iPod block devices by comparing lsblk snapshots and logs detection to stdout
- [ ] #2 Device Poller ignores non-iPod USB devices (no false positives)
- [ ] #3 Device Poller respects PODKIT_POLL_INTERVAL env var (default 5s)
- [ ] #4 Sync Orchestrator executes the full mount → dry-run → sync → eject cycle via CLI subprocess calls
- [ ] #5 Sync Orchestrator handles mount failure gracefully (logs error, continues polling)
- [ ] #6 Sync Orchestrator handles sync failure gracefully (still ejects device, logs error)
- [ ] #7 Sync Orchestrator enforces one sync at a time (ignores new devices while syncing)
- [ ] #8 CLI Runner parses JSON output from mount, sync, and eject commands into typed objects
- [ ] #9 Entry point reads PODKIT_POLL_INTERVAL and PODKIT_CONFIG env vars
- [ ] #10 Docker entrypoint recognizes 'daemon' command and starts the Node.js daemon process
- [ ] #11 Dockerfile includes the daemon entry point alongside the CLI binary
- [ ] #12 Unit tests for Device Poller with mocked lsblk JSON snapshots
- [ ] #13 Integration tests for Sync Orchestrator with mocked CLI Runner
<!-- AC:END -->
