---
id: doc-053
title: podkit-docker testing strategy
type: guide
created_date: '2026-06-27 19:02'
updated_date: '2026-08-05 17:26'
tags:
  - docker
  - daemon
  - testing
  - m-22
---
> Milestone: m-22 (podkit-docker alignment). Companion to doc-052 (PRD: podkit-docker alignment) — this doc is the harness that proves that PRD. Local-only by design; no CI gate is required.

> **Vocabulary note (superseded by [ADR-025](../../adr/adr-025-canonical-test-taxonomy.md)):** the "Tier 1–5" numbering below is **retired**. It is kept here only as this vertical's cost-ordered *rollout narrative* — it is **not** a test classification. Every test is classified by the canonical [test taxonomy](../../documents/architecture/testing/taxonomy.md) (**Depth** × **Surface**). The stages map as: T1 → **Unit**; T2 → **Integration**; T3 → **E2E**·`host-docker-image`·`none`; T4 → **E2E**·`host-docker-image`·`loopback-fat`; T5 → **E2E**·`vm-docker-image`·`usb-synth`. Do not introduce new "Tier N" labels; use the taxonomy coordinates.

## Why this exists

The shipped Docker image is currently built and pushed with **zero tests**. The `*.docker.test.ts` suite is a misnomer — it dockerizes *Navidrome source servers* and exercises the host CLI against them; nothing builds or runs the podkit image, its entrypoint, or the daemon-in-container. This doc defines a deliberate, layered harness so the image, entrypoint, and daemon are actually verified — including the device-onboarding behavior redefined in doc-052.

Scope decision: **local execution is sufficient.** We do not require these to run in GitHub CI. That removes the `dummy_hcd`-in-CI obstacle and lets the deepest stage reuse the existing Lima VM USB-gadget infrastructure.

## What good tests look like here

- Assert **external behavior**, not implementation. Feed inputs, assert outputs / typed errors / observable side effects.
- Push decision logic into **pure modules** so the expensive container/VM stages only have to prove wiring, not branch coverage.
- Each stage earns its cost: the cheaper a stage, the more cases it owns; the VM stage owns only what genuinely needs a synthesized USB device.

## The five rollout stages

> Retired "Tier N" numbering retained as the rollout narrative only — see the vocabulary note above for the canonical [taxonomy](../../documents/architecture/testing/taxonomy.md) coordinates.

### Tier 1 — Daemon unit (isolation) → canonical **Unit**
The daemon's decision logic, tested as pure functions with everything mocked. Includes the modules extracted in doc-052: **unknown-model sync guard**, **device-registry resolver** (UUID→config match), **readiness classifier** (`ready | needs-setup | needs-init | unsupported`), **mass-storage ENV mapper**, **container device-access probe**. The existing ~69 daemon tests already live here but are **not gated** in the quality run — fixing that gating is part of this stage. Runs everywhere, instantly.

### Tier 2 — Entrypoint (`bats`) → canonical **Integration**
Shell-level tests of `entrypoint.sh`: command routing (sync vs daemon vs raw vs known-subcommand), command-parity (every CLI command is recognised — would have caught the `doctor` blocker), PUID/PGID user/group creation and ownership, `--device /ipod` injection for sync, `--path /config/config.toml` injection for init, su-exec privilege drop for one-shot vs root for daemon. No device, no real sync — pure entrypoint behavior.

### Tier 3 — Image smoke → canonical **E2E** · `host-docker-image` · `local-dir` · `none`
Build the image for the **native arch** and assert it boots and is internally consistent: `--version` works, `doctor` works (not just "exists"), command-parity holds against the running binary, ffmpeg is present and runnable, both `podkit` and `podkit-daemon` binaries are present and executable, the entrypoint is executable. Cheap, and it catches the entire "image drifted from the CLI" class.

### Tier 4 — CLI device ops on a loopback FAT (no USB) → canonical **E2E** · `host-docker-image` · `local-dir` · `loopback-fat`
A real `podkit` **CLI** run **inside the shipped image container** against a **loopback FAT block device mounted in that container**, carrying a fixture iPod tree (existing on-disk identity). The container is how we reach a Linux block device without the VM: `losetup`/`mkfs.vfat` need a Linux kernel, and a privileged container provides one (proven on Docker Desktop) — so this stage is `host-docker-image`, not a bare host binary (a host binary + loopback would only run on native-Linux CI, not a macOS dev host).

**This is a CLI stage, not the daemon.** It was originally scoped as *daemon* integration (detect → mount → sync → eject + SIGTERM + notify). That is **not achievable VM-free**: the daemon's poller deliberately excludes `loop`-type devices and requires an Apple USB vendor id read from `/sys` (`packages/podkit-daemon/src/device-poller.ts`) — by design, so it only ever syncs provably-real iPods. A loopback can never trigger daemon detection, so daemon steady-state e2e moves to Tier 5 (`usb-synth`, see task-474). What a loopback *can* honestly prove is the **transport-agnostic CLI**: it operates on a mounted iPod filesystem via on-disk identity, no USB needed.

Owns: the `device add` **`--no-verify` (trust-disk)** verification tier against a mounted iPod volume (on-disk SysInfo present → `trusted-disk`, exit 0; absent → exit 1 + doctor hint) — the case `test-packages/e2e-tests/src/docker-source/device-add.test.ts` documents as blocked "until the harness can mount a synthetic iPod volume" — plus **hard-error-on-generic** (`device add`/`sync` against a generic FAT lacking authoritative identity → refuse, never mutate). The default `verified` tier needs USB/SCSI firmware inquiry → stays Tier 5 (see doc-046). Tracked by **task-450**.

### Tier 5 — Image + daemon e2e (Lima VM, synthesized USB iPod) → canonical **E2E** · `vm-docker-image` · `local-dir` · `usb-synth`
The **shipped Docker image** run **inside the Linux Lima VM**, against a **synthesized USB iPod** from `device-testing-daemon`, with real device passthrough to the container. This is the only stage that exercises the USB *setup* path (`device add` → firmware inquiry → SIE write) **and** the daemon's USB-gated *steady-state* path — detect → mount → sync → eject, SIGTERM graceful-drain, and Apprise notification — against a device the harness fully controls (daemon steady-state e2e is tracked by **task-474**, re-homed here from the loopback stage).

Key reuse: the VM harness **already** synthesizes USB iPods with vendor/product descriptors, serves SysInfoExtended over the vendor read, and has e2e scenarios for `device add`, discovery, and `doctor --repair sysinfo-extended` (`e2e-vm-tests` + `device-testing-daemon`). Tier 5 re-points those existing personas at the Docker image rather than the host binary — it is adaptation, not new device infrastructure.

Constraint: **macOS Docker Desktop cannot pass USB to containers**, so Tier 5 must run the container inside the Linux VM (which has `dummy_hcd` and can pass `/dev/bus/usb` through), not on the dev host's Docker Desktop. (This is the USB path — both the *setup* path and the daemon's USB-gated *detection*. The Tier-4 `loopback-fat` cell needs only a block device, which a host container provides, but it exercises the CLI, not the daemon.)

**Local run:**

```bash
bun run test:e2e:docker-dist
```

Prerequisites: the `podkit-device-harness` VM must be up (`bun run harness:status`; bring it up with `bun run harness:start` / `bun run harness:setup`) and the musl binaries must exist (built via `@podkit/device-testing#build:musl-binary`; if absent, `bunx turbo run build:musl-binary --filter @podkit/device-testing`). The stage builds the real Alpine/musl image in the VM (multi-minute) and drives it against a synthesized USB iPod, so it is **local-only** — excluded from `test:vm` and the `quality` DAG. It codifies four container gotchas: path-based addressing (not UUID), `PUID=0` + `--device <blockDevice>`, wiping the stale on-disk SIE before `device add`, and PID-filtered node resolution to dodge the VZ-HID trap. See `agents/docker.md` → "Running the vm-docker-image e2e locally".

Persona caveat: the scaffold uses the 5G Video persona (`ipod-video-5g-iflash-1tb`), which binds both FunctionFS (live USB SIE inquiry) and mass-storage. It proves the **USB-inquiry code path + sync pipeline**, not 5G-over-USB realism (a real 5G Video uses SCSI inquiry). A USB-native syncable persona is the realism refinement, deferred to the full persona matrix (**DRAFT-021**).

## Coverage map

| Concern | Owning stage | Canonical coordinates |
|---|---|---|
| Onboarding decision logic (registry, readiness, generic-guard, ENV map, access probe) | 1 | Unit |
| Entrypoint command routing / parity / PUID-PGID / injection / privilege | 2 | Integration |
| Image boots, binaries + ffmpeg present, command-parity vs running binary | 3 | E2E · `host-docker-image` · `none` |
| CLI `device add` trust-disk verification (`--no-verify`) + hard-error-on-generic, against a mounted loopback iPod volume | 4 | E2E · `host-docker-image` · `loopback-fat` |
| USB setup path (`device add` → SIE write) | 5 | E2E · `vm-docker-image` · `usb-synth` |
| Daemon steady-state (detect→mount→sync→eject), SIGTERM drain, Apprise notify, against a controlled USB device | 5 | E2E · `vm-docker-image` · `usb-synth` |

## Build-now vs later

- **Now (m-22, this release):** stage-1 gating, stage 2, stage 3, and stage 4 (CLI loopback — task-450). Stage 5 **scaffolded** (image runnable in the VM against one synthesized persona) — enough to prove the wiring; broaden personas later.
- **Later (Draft / m-21):** daemon steady-state e2e in stage 5 (task-474); full stage-5 persona matrix; multi-arch image execution validation; SCSI-passthrough device scenarios (blocked on TASK-296).

## Prior art to follow

- `e2e-vm-tests/src/*.e2e.test.ts` — structure, expectations, persona/matrix pattern.
- `test-packages/device-testing-daemon/` — synthesized USB gadget + SysInfoExtended serving.
- `test-packages/e2e-tests/src/docker/` — container lifecycle management helpers (currently Navidrome-only) worth generalising for running the podkit image.
- `packages/podkit-daemon/src/*.test.ts` — existing daemon unit tests to gate and extend.
