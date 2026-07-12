---
id: TASK-450
title: 'E2E docker-loopback: daemon integration against a loopback FAT fixture iPod'
status: To Do
assignee: []
created_date: '2026-06-27 19:05'
updated_date: '2026-07-12 12:52'
labels:
  - docker
  - daemon
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - documents/architecture/testing/taxonomy.md
  - adr/adr-025-canonical-test-taxonomy.md
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the **E2E · `host-docker-image` · `local-dir` · `loopback-fat`** cell of the [test taxonomy](../../documents/architecture/testing/taxonomy.md) (doc-053 rollout stage 4).

The `podkit-daemon` runs **inside the shipped image container**, driving a real `podkit` CLI subprocess against a **loopback FAT block device** mounted in that container and carrying a fixture iPod tree (existing on-disk identity). This is the fast, VM-free local proxy for "the daemon really syncs a real-ish device": the container supplies the Linux kernel that `losetup`/`mkfs.vfat`/`lsblk` need, so no `dummy_hcd` VM is involved. (This is why the runtime is `host-docker-image`, not a bare host binary — a host binary + loopback would only run on native-Linux CI, not on a macOS dev host.)

Also asserts **hard-error-on-generic** end-to-end (fixture lacking authoritative identity → refuse + notify, never mutate), SIGTERM graceful-drain, and notification to a mock Apprise endpoint.

**Location:** `test-packages/e2e-tests/src/docker-loopback/` — a non-default E2E surface subdir per the taxonomy's directory rule (default host surface stays in the feature dirs). Add a `test:e2e:docker-loopback` script that gates on that directory.

**Spike already run (2026-07-12) — capability proven.** On Docker Desktop, a `--privileged` container can `losetup` a file, `mkfs.vfat -F 32` it, and have `lsblk` report `FSTYPE=vfat` + `LABEL` — the exact surface the daemon poller reads. A whole-disk FAT (mkfs on the loop device itself) maps directly onto the poller's whole-disk-FAT detection path (commit d3361548). So this task is wiring existing pieces, not new capability: the container-lifecycle helpers in `test-packages/e2e-tests/src/docker/`, the FAT image builder, the `podkit-daemon`, and a small mock Apprise HTTP server. The daemon's graceful-drain (`main.ts`/`sync-orchestrator.ts`) and Apprise client already have unit coverage; this proves the wiring end-to-end.

One thing to verify during build: `losetup`-in-container needs `--privileged` (or `CAP_SYS_ADMIN` + `/dev/loop-control`) — confirmed working on Docker Desktop in the spike; keep it working on native-Linux CI too.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Daemon-in-container + real CLI subprocess drives detect (via lsblk) -> mount -> sync -> eject against a loopback FAT fixture iPod
- [ ] #2 SIGTERM graceful-drain asserted (completed tracks preserved)
- [ ] #3 Notification delivery asserted against a mock Apprise endpoint
- [ ] #4 Hard-error-on-generic asserted: fixture lacking authoritative identity is refused + notified, never mutated
- [ ] #5 Runnable locally via a documented command (test:e2e:docker-loopback)
- [ ] #6 Test lives in test-packages/e2e-tests/src/docker-loopback/ per the taxonomy directory rule
<!-- AC:END -->
