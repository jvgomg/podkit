---
id: TASK-443
title: Verify firmware inquiry (USB + SCSI) works inside the Alpine image
status: Done
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-07-11 09:25'
labels:
  - docker
  - ipod-firmware
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-docker/Dockerfile
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The USB *setup* tier (one-time `device add` writing SysInfoExtended) depends on firmware inquiry working inside the Alpine container. The Dockerfile installs no libusb/sg3-utils; the `usb` native binding is bundled and SG_IO via koffi needs no extra package — but this has never been verified in-container. This is a verify-first spike that gates the promise of the USB setup tier.

Determine empirically (with USB passthrough) whether `device add`/`device scan` firmware inquiry succeeds in the image. Add runtime system packages only if verification shows they're needed; otherwise document why none are required. Capture the result in the in-codebase USB/SCSI support matrix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Empirically verified whether USB firmware inquiry works in the Alpine image with /dev/bus/usb passthrough
- [x] #2 Any required runtime system packages added to the Dockerfile (or documented as not needed, with reasoning)
- [ ] #3 `device add` with USB passthrough writes SysInfoExtended to a device from inside the container (proven via the VM e2e tier)
- [x] #4 Finding recorded in the in-codebase USB/SCSI device-support matrix
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Verify-first spike, against WIP local (musl/arm64) image. Manual proof now; automated Tier-5 wiring lands in TASK-451 (AC#3 completes there).

**Phase A — build WIP musl binaries (podkit-tests-alpine-musl VM, running)**
1. Sync current source into the Alpine VM (reuse run-tests.sh rsync path).
2. bun install; build libgpod-node native (node-gyp against system libgpod-dev — dynamic link acceptable for WIP image; note divergence from shipped static binary, irrelevant to the inquiry stack under test).
3. `bun run compile` in podkit-cli (stages usb linux-arm64 armv8 prebuild + gpod binding) and podkit-daemon. Copy binaries out.

**Phase B — docker inside podkit-device-harness VM**
4. Check disk headroom; `apt-get install docker.io` in the harness VM (manual for spike — baseline-hash drift acknowledged; provisioning change formalized in TASK-451).
5. Stage minimal build context (Dockerfile, entrypoint.sh, bin/arm64/*) via limactl copy; `docker build` in-VM. Add `apk add libgpod` to WIP image only if the dynamic binding requires it.

**Phase C — empirical verification against synthesized USB iPod**
6. Start device-testing-daemon persona (USB-capable generation, e.g. classic/nano 5G) serving SysInfoExtended over the vendor read; mount gadget mass-storage in the VM.
7. In container with `--device /dev/bus/usb` + volume at /ipod: `podkit device add --path /ipod` → assert firmware inquiry succeeds and SysInfoExtended written to the device (AC#1, spike-level AC#3 evidence).
8. Negative probes: no `--device` passthrough (expect access-probe guidance); check /dev/sg* story for the gadget and document SCSI-in-container status (feeds TASK-296 notes).

**Phase D — record findings**
9. Dockerfile: add runtime packages only if verification demands (expectation: none — usb prebuild bundles static libusb; koffi bundled). Document reasoning either way (AC#2).
10. Update documents/architecture/device/identity-support-matrix.md §4/§5 with the verified in-container result (AC#4). Task notes: what was proven manually vs deferred to TASK-451 automation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Phase 2 verification — 2026-07-11

### Findings

**Finding 1 — findmnt UUID requires root + block device in container**
findmnt resolves volume UUID via libblkid (reads block device directly). `/dev/sda` node is `brw-rw---- root disk`; uid=1000 returns empty UUID → refuse-no-uuid. Fix: pass `--device /dev/sdX` AND run one-time `device add` with PUID=0 (or add container user to disk group). Post-setup sync-only containers can use PUID=1000 (no block-device access needed).

**Finding 2 — FunctionFS cannot serve iPod DEVICE-level USB vendor reads**
Real iPod USB SIE protocol uses bmRequestType=0xC0 (recipient=DEVICE). Linux FunctionFS only routes INTERFACE-level (0xC1) control transfers to userspace ep0. The test harness gadget (device-testing-daemon) therefore STALLs all SIE vendor reads — the daemon never sees a SETUP event. Confirmed by testing 0xC1 (daemon received it + logged 'unhandled request') vs 0xC0 (STALL, no daemon log). This is a test infrastructure gap only — real Apple iPod hardware responds to DEVICE-level vendor reads normally.

**Finding 3 — Disk-based SIE path works correctly in container**
With SysInfoExtended pre-populated on disk, podkit reads and parses it correctly ('iPod Video 30GB Black (5.5th Generation)'). The stale-guid persona's model mismatch (coarse USB PID fallback 5th gen vs rich disk SIE 5.5th gen) is detected and flagged for doctor --repair — correct behavior.

**Finding 4 — USB native binding IS embedded and works**
The bundler-plugin.cjs embeds the linux-arm64 usb prebuild. USB device found (05ac:1209 on dummy_hcd bus), correct control transfer attempted (0xC0, 0x40, 0x02, wIndex=0, wLength=4096). The STALL is purely from the test gadget's FunctionFS limitation, not from the bundler or transport code.

**Finding 5 — eudev-libs + findmnt needed and added**
AC#2 confirmed: `eudev-libs` (libudev.so.1 for usb prebuild dlopen) and `findmnt` (util-linux-misc, for UUID resolution) must be in the Dockerfile. Both added in this task.

### Verified recipe for one-time `device add` in container
```
nerdctl/docker run --rm \
  --device /dev/bus/usb \
  --device /dev/sdX \
  -e PUID=0 -e PGID=0 \
  -v /config:/config \
  -v /mnt/ipod:/ipod \
  podkit device add -d myipod --path /ipod --yes
```

### AC#3 status
Manual in-VM proof done (USB device found, correct transfer attempted, disk SIE path works). Automated VM e2e proof lands with TASK-451. AC#3 checkbox stays unchecked per the spike-first decision; TASK-451 owns it.

### Impact on existing tasks
- TASK-460: doctor inquiry-methods check must be fixed (claims USB always available in shipped binaries)
- TASK-461: podkit-daemon compile path must embed USB via bundler-plugin too
- TASK-451 notes updated: nerdctl/containerd already present in harness VM; block device passthrough + PUID=0 needed for device add tests
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## TASK-443 — Verify firmware inquiry (USB + SCSI) works inside the Alpine image\n\n### What was done\n\nThree-phase spike: code fix → in-container verification → documentation.\n\n**Phase 1 (code fix, prior session):**\n- Discovered the bundled `usb` npm native prebuild fails to dlopen in Alpine due to missing `libudev.so.1` → added `eudev-libs` to Dockerfile\n- Discovered `findmnt` missing from Alpine (lsblk package doesn't ship it) → added `findmnt` (util-linux-misc)\n- Discovered Bun's compiled binary cannot use `Module._resolveFilename` hooks for native module relocation → built `bundler-plugin.cjs` (usbNativeBundlerPlugin) that embeds the usb prebuild at build time; `compile-build.ts` drives Bun.build with the plugin\n- Deleted the broken runtime `bundle.cjs` / `bundleUsbNative` approach\n\n**Phase 2 (in-container verification, this session):**\n- TEST 1 (no USB/block passthrough): fails with refuse-no-uuid — confirmed findmnt needs block device in container\n- TEST 2 (PUID=1000 + block device): still refuses UUID — libblkid can't open `brw-rw---- root disk` node as uid=1000\n- TEST 3 (PUID=0 + block + USB): device found, USB transfer attempted correctly (0xC0/0x40/0x02), STALL from test gadget FunctionFS limitation\n- Root cause of USB STALL: FunctionFS only routes INTERFACE-level (0xC1) requests to userspace; real iPod protocol uses DEVICE-level (0xC0); test harness gap, not a podkit bug\n- Disk SIE path: pre-populated SysInfoExtended → read correctly → rich model resolved → model mismatch for stale-guid persona (correct behavior)\n\n**Phase 3 (documentation):**\n- Updated `documents/architecture/device/identity-support-matrix.md` §4 (runtime requirements: eudev-libs, findmnt, PUID=0, --device <blockdev>) and §5 (Docker one-time setup recipe)\n\n### Changed files\n- `packages/ipod-firmware/bundler-plugin.cjs` + `.d.ts` — new build-time Bun.build plugin\n- `packages/podkit-cli/scripts/compile-build.ts` — new Bun.build driver\n- `packages/podkit-cli/scripts/compile.sh` — invokes compile-build.ts\n- `packages/podkit-cli/src/compile-entry.js` — usb block removed\n- `packages/ipod-firmware/bundle.cjs` — deleted\n- `packages/ipod-firmware/package.json` — exports updated\n- `packages/podkit-docker/Dockerfile` — eudev-libs + findmnt\n- `packages/ipod-firmware/src/bundler-plugin.test.ts` — 15 tests\n- `packages/podkit-cli/src/bundle.test.ts` — node-gyp-build absence assertion\n- `agents/ipod-firmware.md`, `agents/docker.md` — bundling/runtime docs updated\n- `documents/architecture/device/identity-support-matrix.md` — §4/§5 updated with verification findings\n- `.changeset/usb-via-npm-package.md` — corrected for bundler-plugin API\n- `.changeset/docker-eudev-findmnt-deps.md` — new changeset for @podkit/docker\n\n### Open follow-ups (separate tasks)\n- TASK-451: automate the in-container device add flow as VM e2e test (owns AC#3)\n- TASK-460: fix doctor inquiry-methods check (hardcodes false USB availability)\n- TASK-461: embed usb prebuild in podkit-daemon compile path too\n- Follow-up for device-testing-daemon: FunctionFS cannot serve DEVICE-level vendor reads; daemon needs raw gadget API or similar to serve real iPod USB SIE protocol"
<!-- SECTION:FINAL_SUMMARY:END -->
