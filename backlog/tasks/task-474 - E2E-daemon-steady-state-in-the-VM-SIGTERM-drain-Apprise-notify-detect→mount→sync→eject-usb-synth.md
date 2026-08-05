---
id: TASK-474
title: >-
  E2E daemon steady-state in the VM: SIGTERM drain + Apprise notify +
  detect→mount→sync→eject (usb-synth)
status: To Do
assignee: []
created_date: '2026-08-05 17:25'
labels:
  - docker
  - daemon
  - testing
  - vm
milestone: m-22
dependencies:
  - TASK-450
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - documents/architecture/testing/taxonomy.md
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
  - packages/podkit-daemon/src/main.ts
ordinal: 234000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
End-to-end coverage of the `podkit-daemon` steady-state path against a **synthesized USB iPod** in the Lima VM (`vm-docker-image` · `usb-synth`, Tier-5). This is the daemon device coverage originally mis-scoped onto the loopback tier (TASK-450) — the daemon's iPod detection is **USB-gated** (`device-poller.ts`: loop devices excluded, Apple vendor id `05ac` required), so it can only be exercised against a real USB gadget, i.e. the VM harness. See TASK-450's "Why this changed" note.

Today these behaviours are **unit-only** (`packages/podkit-daemon/src/{sync-orchestrator,apprise-client,notification-formatter}.test.ts`) — there is **no e2e** anywhere (`e2e-vm-tests` covers CLI `device add`/sync/doctor against personas, not the daemon binary's poll→orchestrate→shutdown loop). This task fills that gap.

## Scope
The **shipped image's `podkit-daemon`** running in the VM against a synthesized USB iPod persona (reuse `image.docker-dist.test.ts`'s `ipodVideo5gIflash1tb` gadget + `buildPodkitImageInVm`), asserting the steady-state loop end to end:

1. **Detect → mount → sync → eject**: the daemon's poller sees the synthesized USB iPod (Apple vendor id present), auto-mounts, spawns a real `podkit` sync of a `local-dir` source, then ejects.
2. **SIGTERM graceful-drain**: SIGTERM the daemon during a sync → it forwards SIGINT to the CLI child, drains, the iTunesDB is saved consistently, container exits 0, no corruption.
3. **Apprise notify**: point `PODKIT_APPRISE_URL` at a mock endpoint reachable from the VM container; assert a sync-complete notification is delivered.

## Notes
- Runs locally-only via `test:e2e:docker-dist` infra (expensive; VM + image build). Not in the routine `quality`/`test:vm` DAG.
- Complements TASK-450 (VM-free CLI loopback surface); together they replace the original single loopback-daemon plan.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Daemon-in-image (VM) detects the synthesized USB iPod → mount → real `podkit` sync of a local-dir source → eject, asserted end to end
- [ ] #2 SIGTERM during an in-progress sync → daemon drains, iTunesDB saved consistently, container exits 0, no corruption (completed tracks preserved)
- [ ] #3 Sync-complete notification delivered to a mock Apprise endpoint reachable from the VM container
- [ ] #4 Runnable locally via a documented command; excluded from the routine quality/test:vm DAG
<!-- AC:END -->
