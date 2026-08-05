---
id: TASK-474
title: >-
  E2E daemon steady-state in the VM: SIGTERM drain + Apprise notify +
  detect→mount→sync→eject (usb-synth)
status: In Progress
assignee: []
created_date: '2026-08-05 17:25'
updated_date: '2026-08-05 18:05'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
FEASIBILITY PROVEN (2026-08-05, live probe in podkit-device-harness VM). The core unknown — can the daemon DETECT a synthesized USB iPod from inside a container — is YES.

Proven recipe (AC1 end-to-end, ~1s cycle):
1. buildPodkitImageInVm({force}) -> tag `podkit:docker-dist` (already exists; ~15s cached).
2. mountPersona({personaId, vendorId, productId, mountPoint}) for ipodVideo5gIflash1tb -> synthesizes the USB gadget + mounts backing.
3. Seed: `gpod-tool init <mp> --model MA147` (classic SysInfo + empty iTunesDB; 5G Video is non-checksum so no SIE needed to sync). Seed /music with FLAC(s) + /config/config.toml ([music.main] path=/music, [defaults] music=main, [codec] lossy/lossless=aac; NO [devices] block — daemon syncs the detected device by its mount path).
4. Unmount the backing on the VM host (`umount -l`) but LEAVE the gadget bound, so the daemon mounts it itself.
5. resolvePersonaDeviceNodes -> blockDevice=/dev/sda, usbNode=/dev/bus/usb/NNN/MMM.
6. Run daemon: `sudo nerdctl run -d --privileged --network host -e PUID=0 -e PGID=0 -e PODKIT_POLL_INTERVAL=2 -v <cfg>:/config -v <music>:/music:ro <IMAGE> daemon`.
   - `--privileged` is REQUIRED: exposes host /dev (incl. partition nodes /dev/sdaN the daemon mounts), /sys (idVendor=05ac read for detection), and CAP_SYS_ADMIN (mount). Not just --device.
   - `--network host` so PODKIT_APPRISE_URL can reach a mock on the VM host (127.0.0.1:<port>).
   - nerdctl rejects `-d --rm` together -> use `-d`, clean up with `rm -f`.

Observed daemon log: 'iPod candidate detected -> iPod detected: sda {label:IPOD_VIDEO, uuid:1234-ABCD} -> Mounting /dev/sda -> Sync plan {add:1} -> Sync completed {completed:1,failed:0} -> Ejecting -> Ejected -> Sync cycle completed successfully'. 1 track file landed on the device.

Remaining to build the actual test (test-packages/e2e-vm-tests/src/vm-docker/):
- AC2 SIGTERM drain: generate enough tracks (e.g. ~15-20 FLACs, or slower transcode) that the sync runs a few seconds, then `nerdctl stop` (SIGTERM) mid-sync; assert container exits 0, iTunesDB parses/consistent, completed tracks preserved (per the chosen rigor: clean save + exit 0, not mid-track partial).
- AC3 Apprise: run a tiny mock HTTP server on the VM host (python3 likely available; capture POST JSON {title, body} to a file), set PODKIT_APPRISE_URL=http://127.0.0.1:<port>/notify, assert a sync-complete notification is delivered.
- Structure as a *.docker-dist.test.ts sibling reusing container-helpers + limaTestVmRunner; gate under test:e2e:docker-dist (local-only).

Probe scripts were scratch (removed); recipe captured here.
<!-- SECTION:NOTES:END -->
