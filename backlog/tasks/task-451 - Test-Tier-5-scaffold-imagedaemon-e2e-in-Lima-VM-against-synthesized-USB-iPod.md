---
id: TASK-451
title: 'Test Tier 5: scaffold image+daemon e2e in Lima VM against synthesized USB iPod'
status: In Progress
assignee: []
created_date: '2026-06-27 19:05'
updated_date: '2026-07-11 17:04'
labels:
  - docker
  - daemon
  - testing
  - vm
milestone: m-22
dependencies:
  - TASK-464
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - test-packages/device-testing-daemon/
  - test-packages/e2e-vm-tests/
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 5 of the docker testing strategy (scaffold now, broaden later). Run the shipped Docker image inside the Linux Lima VM, against a synthesized USB iPod from `device-testing-daemon`, with real device passthrough to the container. The only tier that exercises the USB setup path (`device add` -> firmware inquiry -> SIE write) and validates daemon steady-state against a fully-controlled device.

Reuse: the VM harness already synthesizes USB iPods, serves SysInfoExtended over the vendor read, and has device-add / doctor-repair / discovery scenarios — re-point one persona at the Docker image rather than the host binary. Constraint: macOS Docker Desktop cannot pass USB to containers, so this runs inside the Linux VM. Scope here is scaffolding (one persona, wiring proven); the full persona matrix is a later Draft task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Docker image runs inside the Lima VM with /dev/bus/usb passthrough to the container
- [x] #2 One synthesized USB iPod persona drives `device add` -> SIE write through the image
- [x] #3 Daemon steady-state sync against the synthesized device proven through the image
- [ ] #4 Documented local command to run the tier
- [x] #5 Full persona matrix explicitly deferred to a Draft task
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Execution plan (from design agent + user steer: prove a REAL sync through the image)

Verified against fresh 20GiB VM: nerdctl + containerd ARE present (no re-baseline needed); disk 17GiB free.

### Persona decision
Need ONE persona that is USB-inquiry-capable + syncable + has a FAT mass-storage backing file. None exists today (nano-7g = USB+FAT but access:none/not-syncable; video-5g = FAT+syncable but SCSI-only inquiry). PLAN: augment a syncable USB-inquiry persona (nano-3g/4g/5g candidates) with a FAT32 backing file. Must confirm: (a) it is in libgpod's writable/syncable table, (b) FAT (not HFS+, which the VM can't mount — nano-4g-black is HFS+), (c) USB-inquiry per matrix §4.

### Milestones (each independently verifiable against the VM)
- **M1 — Linux daemon binary.** Extend `build-linux-binary.sh` to also compile `podkit-daemon` in the podkit-linux-builder VM → `packages/podkit-daemon/bin/podkit-daemon-linux-<arch>`. Plain compile (TASK-461: daemon needs no USB plugin). Add resolver in `lima-test-vm.ts`.
- **M2 — Image build in-VM.** New `test-packages/device-testing/src/runners/lima-docker-image.ts` `buildPodkitImageInVm()`: stage bin/arm64/{podkit,podkit-daemon} + Dockerfile + entrypoint into a VM ctx dir, `sudo nerdctl build` with CI-matching build-args (single-arch arm64, native). Verify: `nerdctl run podkit:tier5 --version`. (AC#1)
- **M3 — Persona + device-node resolver.** Augment the chosen syncable persona with a FAT backing file; add `resolvePersonaDeviceNodes()` (block `/dev/sdX` + `/dev/bus/usb/BBB/DDD`) next to `buildScsiSdDiscoveryScript` in `mount-persona.ts`.
- **M4 — AC#2: device add → USB inquiry → SIE write through the image.** `nerdctl run --device usb --device sdX -e PUID=0 podkit:tier5 device add --path /ipod`; assert SIE written on disk.
- **M5 — AC#3: real media sync through the image.** daemon (or `podkit sync`) through the image against the mounted syncable device; assert tracks land in the iTunesDB.
- **M6 — Test wiring + local command + docs.** `tier5-docker-image.e2e.test.ts` reusing `limaTestVmRunner`; `test:tier5` script; document run command; refresh stale it.skip/identity-matrix comments. (AC#4)
- **AC#5** — file the deferred full-persona-matrix Draft task.

### Open decisions resolved
- Image source: Stage 1 local in-VM build (this task); Stage 2 GHA pull = TASK-463.
- nerdctl: already present (no yaml change).
- AC#3 strength: REAL sync (user goal), hence the persona augmentation.

PERSONA DECISION REVISED (2026-07-11): use `ipod-video-5g-iflash-1tb` for the scaffold, NOT nano-3g/nano-4g.
- nano-4g-black: massStorageBackingFile=null AND it's HFS+ (VM can't mount) → unusable.
- nano-3g-black: augmenting it with a backing file BREAKS `discovery-reconciliation.e2e.test.ts:112`, which uses it as a USB-ONLY device (asserts the empty-lsblk pipeline yields no second row). Can't touch it.
- video-5g-iflash-1tb: ALREADY has a 256MiB FAT32 backing file + SIE + is syncable (standard iTunesDB). Its daemon binds BOTH FunctionFS (serves SIE over USB 0xC0, now working via TASK-462) AND mass-storage (gives /dev/sdX for mount+UUID). Ready-made, zero test-breakage, exercises the real USB 0xC0 inquiry code path, and supports a REAL media sync.
- CAVEAT (documented, deferred): a real iPod 5G Video uses SCSI inquiry, not USB — so this persona proves the USB-inquiry *code path* + the *sync pipeline*, not 5G-over-USB realism. A USB-native syncable FAT persona (a new nano-3g/4g/5g variant) is the realism refinement → fold into the AC#5 fuller-matrix Draft task.
- CONSEQUENCE: M3 no longer needs a persona edit; it reduces to adding resolvePersonaDeviceNodes() (block + USB node) to mount-persona.ts.

BLOCKER FOUND (M2, 2026-07-11): local Stage-1 image build is not viable as-designed. M1's linux binaries are glibc-linked (built in the Debian podkit-linux-builder VM); the production Dockerfile is alpine:3.21 (musl). The glibc binary cannot start in the musl image ('exec /usr/local/bin/podkit: no such file or directory' = missing glibc loader). agents/docker.md: CI produces musl-specific binaries for Docker; 'full Alpine/musl fidelity is Tier 5'. CI builds musl prebuilds + binaries in Alpine containers (prebuild.yml / build-platform.yml). Host only has glibc linux-arm64 prebuilds today. Options: (1) build musl binaries locally via the podkit-tests-alpine-musl VM toolchain (real infra: musl libgpod-node + usb prebuilds + bun --compile --target=bun-linux-arm64-musl) then feed the M2 runner; (2) do TASK-463 now (GHA pre-release musl image) and have Tier-5 PULL the CI artifact — matches the user's original Q7 preference; (3) local glibc-base Dockerfile variant for a fast dev loop (proves wiring+sync, not musl fidelity). M2 runner itself is complete + correct (builds image, right build-args, TARGETARCH, starts containerd+buildkit).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Notes from TASK-443 verification (2026-07-11)

**nerdctl/containerd already installed:** The podkit-device-harness VM has containerd + nerdctl from the Lima bundle — no docker install needed. The WIP image was loaded and run via `sudo nerdctl` throughout TASK-443 verification.

**FunctionFS cannot serve DEVICE-level USB vendor reads (critical blocker for AC#2):**
Linux FunctionFS only routes INTERFACE-level (0xC1) control transfers to userspace ep0. The real iPod SIE protocol uses DEVICE-level (0xC0). This means `device-testing-daemon` (FunctionFS gadget) cannot serve the real USB SIE vendor read — the kernel STALLs it before the daemon sees a SETUP event. Confirmed empirically: 0xC1 → daemon received it; 0xC0 → STALL, no daemon log.

AC#2 ('firmware inquiry → SIE write through the image') cannot be proven via USB with the current FunctionFS approach. Options:
1. Pre-populate SysInfoExtended on disk before `device add` (exercises the disk-SIE path, not USB inquiry)
2. Fix device-testing-daemon to use raw gadget API or another mechanism that can serve DEVICE-level vendor requests
3. Adjust AC#2 scope: 'device add reads disk SIE' (proven in TASK-443) vs 'device add writes SIE from USB inquiry' (blocked by FunctionFS)

**PUID=0 + --device <blockdev> required for device add:**
findmnt resolves UUID via libblkid which reads the block device directly. Block device is `brw-rw---- root disk`; uid=1000 returns empty UUID. One-time `device add` needs PUID=0 or disk group + `--device /dev/sdX`. Tests must account for this.

**Disk headroom:** harness VM was at 86% (785M free) during TASK-443. Image + test workload may require pruning. Monitor with `sudo nerdctl system prune -af` before test runs.

UPDATE (2026-07-11, TASK-462): the FunctionFS DEVICE-level blocker recorded in the TASK-443 notes above is RESOLVED. The dummy-hcd-daemon now serves the real iPod USB SIE vendor read (bmRequestType=0xC0) via the FUNCTIONFS_ALL_CTRL_RECIP descriptor flag, proven in-harness (A/B: 0x03 STALLs, 0x43 serves SIE XML). Consequences for this task:
- AC#2 ('device add -> SIE write through the image') is achievable over REAL USB inquiry, no disk-SIE workaround. The three options in the TASK-443 note (pre-populate SIE / raw-gadget rewrite / reframe AC) are moot.
- Target a USB-mode persona (ipod-nano-4g-black, USB PID 0x1263 — 'USB inquiry: yes' generation), NOT the SCSI-only ipod-video-5g persona (serving 5G over 0xC0 would be a fiction; Docker supports USB inquiry only per identity-support-matrix.md §5).
- PREREQ: bump the harness VM disk. It is 6 GiB (Lima 'disk:') and baking a Docker image inside the VM needs headroom; an unclean stop near-full wedged the boot this session (required destroy+harness:setup to recover).
- Image source (per plan Q7): Stage 1 = local in-VM build from the Dockerfile; Stage 2 (separate follow-up task) = pull a pre-release GHA-built image. A GHA pre-release/RC image seam does NOT exist yet (docker.yml is release-only) and must be built for Stage 2.

M2+item6 DONE / AC#1 PROVEN (2026-07-11): the M2 runner now selects the musl binaries (lima-docker-image.ts uses resolveDefaultPodkitMuslBinary/resolveDefaultDaemonLinuxMuslBinary; new resolvers in lima-test-vm.ts). Built the real alpine:3.21 image locally (podkit:tier5, 390MB) from the TASK-464 musl binaries and ran it in the harness VM: `podkit --version` -> 0.6.0 exit 0; `device scan --json` -> {success:true,devices:[]} exit 0. The production-shaped musl image runs podkit locally.

MINOR ENTRYPOINT BUG found: `nerdctl run podkit:tier5 --version` (bare leading flag) fails with `/entrypoint.sh: line 137: exec: --: invalid option` — the fallthrough `exec "$@"` mishandles a leading `-flag`. Workaround: prefix `podkit` (`run podkit:tier5 podkit --version` works). Real Tier-5 commands (device add / sync / daemon / subcommands) route correctly. Consider fixing entrypoint.sh to treat a leading `-`/`--flag` as a podkit arg. Not blocking.

NEXT: M3 resolvePersonaDeviceNodes + M4 (device add through the image, video-5g persona, USB+block passthrough) + M5 (real sync) + M6 (test wiring) + TASK-464 item 5 (turbo wiring).

M3+M4 DONE / AC#2 PROVEN (2026-07-11): added resolvePersonaDeviceNodes()+buildDeviceNodeDiscoveryScript() to mount-persona.ts (returns {blockDevice,usbNode}, filters on persona PID to dodge VZ-HID). For video-5g (PID 0x1209): {blockDevice:/dev/sda, usbNode:/dev/bus/usb/003/002}. Ran `device add -d tier5ipod --path /ipod --yes --json` through podkit:tier5 with `--device /dev/bus/usb/003/002 --device /dev/sda -e PUID=0 -e PGID=0 -v <mnt>:/ipod`, starting from an EMPTY FAT (no on-disk SIE) so USB inquiry was forced. Result: success:true, model resolved to iPod Video 5.5G from PID, volumeUuid 1234-ABCD, verification:verified. SIE-WRITE PROOF: /iPod_Control/Device/SysInfoExtended did not exist before; after device add it is a valid 9693-byte plist (FireWireGUID/SerialNumber/FamilyID/ModelNumStr) written from the USB read. Finding: nerdctl propagates the block-device mount into the container so resolveUsbDeviceFromPath('/ipod') walks the USB ancestry in-container correctly (no remount needed).

M5 DONE / AC#3 PROVEN (2026-07-11): REAL media sync through podkit:tier5. Setup: video-5g persona (PID 0x1209), nodes /dev/sda + /dev/bus/usb/003/003, FAT mounted /mnt/tier5-ac3, 2 generated FLACs. `sync -d tier5ipod -t music --json` through the image -> completed:2 failed:0, losslessCodec:aac (FLAC->AAC transcode by ffmpeg IN the container). VERIFIED: gpod-tool track_count 2 with correct metadata; ffprobe confirms .m4a are AAC 44100/221758; iTunesDB 3356->7902 bytes; `device music --format json` through the image -> {tracks:2,albums:1,artists:1,fileTypes:{AAC:2},syncTagComplete:2}.

TWO DOCKER FINDINGS (must handle in M6 test + docs):
1. IDENTITY_MISMATCH: the video-5g backing FAT ships a STALE SIE (iPod Video 30GB 5.5G) that mismatches the live 5th-Gen USB inquiry -> device add fails. Fix: remove on-disk SIE/SysInfo first (start clean) so device add writes fresh identity from the USB read. (The M6 test should synthesize a backing WITHOUT the stale SIE, or wipe it pre-add.)
2. DEVICE_PATH_UNRESOLVED: volumeUuid resolution FAILS inside the container -> UUID-based device addressing unusable in Docker. Use PATH-BASED addressing: config `[devices.tier5ipod] path="/ipod"` + `-d tier5ipod` resolves by path. Document this as a container constraint (already partly in identity-support-matrix.md §5).

Working config.toml: version=2; [codec] lossy/lossless=[aac]; [music.main] path=/music; [devices.tier5ipod] type=ipod path=/ipod volumeName=IPOD_VIDEO; [defaults] device=tier5ipod music=main.

AC#1/#2/#3 all PROVEN through the real musl image. REMAINING: M6 (codify into tier5-docker-image.e2e.test.ts + test:tier5 script + docs = AC#4) + AC#5 (file deferred full-persona-matrix Draft task) + optional entrypoint --version fix.

AC#5 DONE: filed DRAFT-021 (Tier-5 full persona matrix) as the deferred broadening task. REMAINING for next person = AC#4 only (M6): codify the proven manual flow into `test-packages/e2e-vm-tests/src/tier5-docker-image.e2e.test.ts` (build image via buildPodkitImageInVm → bring up video-5g via mountPersona → resolvePersonaDeviceNodes → device add + sync through the image with the passthrough recipe → assert tracks) + a `test:tier5` script + doc the run command in doc-053/agents/docker.md + refresh stale it.skip/identity-matrix comments. All commands/config/gotchas are in the M4/M5 notes above. Also optional: fix the entrypoint `exec "$@"` bare-flag bug.
<!-- SECTION:NOTES:END -->
