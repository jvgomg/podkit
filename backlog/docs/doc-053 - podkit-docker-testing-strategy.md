---
id: doc-053
title: podkit-docker testing strategy
type: guide
created_date: '2026-06-27 19:02'
tags:
  - docker
  - daemon
  - testing
  - m-22
---
> Milestone: m-22 (podkit-docker alignment). Companion to doc-052 (PRD: podkit-docker alignment) — this doc is the harness that proves that PRD. Local-only by design; no CI gate is required.

## Why this exists

The shipped Docker image is currently built and pushed with **zero tests**. The `*.docker.test.ts` suite is a misnomer — it dockerizes *Navidrome source servers* and exercises the host CLI against them; nothing builds or runs the podkit image, its entrypoint, or the daemon-in-container. This doc defines a deliberate, layered harness so the image, entrypoint, and daemon are actually verified — including the device-onboarding behavior redefined in doc-052.

Scope decision: **local execution is sufficient.** We do not require these to run in GitHub CI. That removes the `dummy_hcd`-in-CI obstacle and lets the deepest tier reuse the existing Lima VM USB-gadget infrastructure.

## What good tests look like here

- Assert **external behavior**, not implementation. Feed inputs, assert outputs / typed errors / observable side effects.
- Push decision logic into **pure modules** so the expensive container/VM tiers only have to prove wiring, not branch coverage.
- Each tier earns its cost: the cheaper a tier, the more cases it owns; the VM tier owns only what genuinely needs a synthesized USB device.

## The five tiers

### Tier 1 — Daemon unit (isolation)
The daemon's decision logic, tested as pure functions with everything mocked. Includes the modules extracted in doc-052: **unknown-model sync guard**, **device-registry resolver** (UUID→config match), **readiness classifier** (`ready | needs-setup | needs-init | unsupported`), **mass-storage ENV mapper**, **container device-access probe**. The existing ~69 daemon tests already live here but are **not gated** in the quality run — fixing that gating is part of this tier. Runs everywhere, instantly.

### Tier 2 — Entrypoint (`bats`)
Shell-level tests of `entrypoint.sh`: command routing (sync vs daemon vs raw vs known-subcommand), command-parity (every CLI command is recognised — would have caught the `doctor` blocker), PUID/PGID user/group creation and ownership, `--device /ipod` injection for sync, `--path /config/config.toml` injection for init, su-exec privilege drop for one-shot vs root for daemon. No device, no real sync — pure entrypoint behavior.

### Tier 3 — Image smoke
Build the image for the **native arch** and assert it boots and is internally consistent: `--version` works, `doctor` works (not just "exists"), command-parity holds against the running binary, ffmpeg is present and runnable, both `podkit` and `podkit-daemon` binaries are present and executable, the entrypoint is executable. Cheap, and it catches the entire "image drifted from the CLI" class.

### Tier 4 — Daemon integration (loopback device, no USB)
The daemon binary + a **real CLI subprocess** against a **loopback FAT image** carrying a fixture iPod tree (existing on-disk identity). Exercises the steady-state path end to end: detect via `lsblk` → mount → sync → eject, plus SIGTERM graceful-drain and notification delivery to a mock Apprise endpoint. This is the fast local proxy for "the daemon really syncs a real-ish device" without needing the VM. Also the natural home for asserting the **hard-error-on-generic** behavior end-to-end (point it at a fixture lacking authoritative identity and assert it refuses + notifies, never mutates).

### Tier 5 — Image + daemon e2e (Lima VM, synthesized USB iPod)
The **shipped Docker image** run **inside the Linux Lima VM**, against a **synthesized USB iPod** from `device-testing-daemon`, with real device passthrough to the container. This is the only tier that exercises the USB *setup* path (`device add` → firmware inquiry → SIE write) and validates the daemon's path-based steady-state behavior against a device the harness fully controls.

Key reuse: the VM harness **already** synthesizes USB iPods with vendor/product descriptors, serves SysInfoExtended over the vendor read, and has e2e scenarios for `device add`, discovery, and `doctor --repair sysinfo-extended` (`e2e-vm-tests` + `device-testing-daemon`). Tier 5 re-points those existing personas at the Docker image rather than the host binary — it is adaptation, not new device infrastructure.

Constraint: **macOS Docker Desktop cannot pass USB to containers**, so Tier 5 must run the container inside the Linux VM (which has `dummy_hcd` and can pass `/dev/bus/usb` through), not on the dev host's Docker Desktop.

**Local run:**

```bash
bun run test:e2e:docker-dist
```

Prerequisites: the `podkit-device-harness` VM must be up (`bun run harness:status`; bring it up with `bun run harness:start` / `bun run harness:setup`) and the musl binaries must exist (built via `@podkit/device-testing#build:musl-binary`; if absent, `bunx turbo run build:musl-binary --filter @podkit/device-testing`). The tier builds the real Alpine/musl image in the VM (multi-minute) and drives it against a synthesized USB iPod, so it is **local-only** — excluded from `test:vm` and the `quality` DAG. It codifies four container gotchas: path-based addressing (not UUID), `PUID=0` + `--device <blockDevice>`, wiping the stale on-disk SIE before `device add`, and PID-filtered node resolution to dodge the VZ-HID trap. See `agents/docker.md` → "Running Tier 5 locally".

Persona caveat: the scaffold uses the 5G Video persona (`ipod-video-5g-iflash-1tb`), which binds both FunctionFS (live USB SIE inquiry) and mass-storage. It proves the **USB-inquiry code path + sync pipeline**, not 5G-over-USB realism (a real 5G Video uses SCSI inquiry). A USB-native syncable persona is the realism refinement, deferred to the full persona matrix (**DRAFT-021**).

## Coverage map

| Concern | Owning tier |
|---|---|
| Onboarding decision logic (registry, readiness, generic-guard, ENV map, access probe) | 1 |
| Entrypoint command routing / parity / PUID-PGID / injection / privilege | 2 |
| Image boots, binaries + ffmpeg present, command-parity vs running binary | 3 |
| Daemon steady-state sync (mount→sync→eject), SIGTERM, notifications, hard-error-on-generic | 4 |
| USB setup path (`device add` → SIE write) + daemon against a controlled USB device | 5 |

## Build-now vs later

- **Now (m-22, this release):** Tier 1 gating, Tier 2, Tier 3, Tier 4. Tier 5 **scaffolded** (image runnable in the VM against one synthesized persona) — enough to prove the wiring; broaden personas later.
- **Later (Draft / m-21):** full Tier-5 persona matrix; multi-arch image execution validation; SCSI-passthrough device scenarios (blocked on TASK-296).

## Prior art to follow

- `e2e-vm-tests/src/*.e2e.test.ts` — structure, expectations, persona/matrix pattern.
- `test-packages/device-testing-daemon/` — synthesized USB gadget + SysInfoExtended serving.
- `test-packages/e2e-tests/src/docker/` — container lifecycle management helpers (currently Navidrome-only) worth generalising for running the podkit image.
- `packages/podkit-daemon/src/*.test.ts` — existing daemon unit tests to gate and extend.
