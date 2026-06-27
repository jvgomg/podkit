---
id: doc-052
title: 'PRD: podkit-docker alignment'
type: specification
created_date: '2026-06-27 19:02'
tags:
  - docker
  - daemon
  - device-capability-architecture
  - m-22
---
> Milestone: m-22 (podkit-docker alignment). Companion doc: "podkit-docker testing strategy" (the layered harness that proves this PRD). Related: TASK-296 (SCSI-in-container), doc-030 (PRD: Device Capability Architecture).

## Problem Statement

podkit has changed a great deal recently — a device-capability architecture, USB + SCSI firmware inquiry (`@podkit/ipod-firmware`), an identity cascade, the `doctor` command, and sync hygiene work — but the shipped Docker image and daemon were built before most of that landed and have drifted. We do not actually know that the image we ship is compatible with current podkit, and the testing harness around it is effectively non-existent: the `*.docker.test.ts` files dockerize *Navidrome source servers* and test the host CLI; nothing builds or runs the podkit image, entrypoint, or daemon-in-container; CI builds and pushes the image with zero smoke checks.

Concretely the user — someone running podkit in Docker on a Linux home server — faces:

- **A live blocker:** `docker run podkit doctor` falls through to the raw-shell branch and fails, because `doctor` was never added to the entrypoint's command list. This is the visible tip of a "the entrypoint doesn't know the current CLI" class of drift.
- **No clear onboarding story.** It is not obvious how a Docker user adds their first device — particularly an iPod that must be *set up* (its authoritative identity file written) before it syncs correctly. The host flow (`device scan` → `device add`) is built on USB enumeration, and it is unclear whether that even works inside the Alpine container.
- **A silent-degradation footgun.** When podkit can't resolve an iPod's model from its on-disk identity, it falls back to a "generic iPod" and syncs anyway, risking the wrong artwork format or database incompatibility. A user can sit in this state unaware.
- **A daemon that doesn't behave as expected.** The daemon syncs *any* block device that looks like an iPod (FAT32 + Apple vendor ID), config-blind: it never loads config, never checks whether the device was added, ignores per-device settings, and syncs by raw mount path. There is no handling for a freshly-detected device that needs setup or initialisation.
- **A config story that stops at one shape.** ENV configuration covers the music source and global settings but cannot declare a device/preset, so a user with a single mass-storage player is forced into a config file purely to name a preset.

## Solution

Align the Docker image and daemon with current podkit, and make the device-onboarding story explicit and honest. The guiding model that came out of design:

**Docker onboarding is path-based; USB enumeration is the one-time *setup* tier.**

- **Steady state needs no USB.** An iPod that already carries authoritative on-disk identity (SysInfoExtended) resolves its model from the mounted filesystem. Sync — and the daemon — work purely on a mounted path. No libusb, no SCSI, no passthrough.
- **First-time setup may need USB, once.** An iPod lacking authoritative identity must have its SysInfoExtended written. That requires firmware inquiry (USB control transfers). So `device add` with `--device /dev/bus/usb` is the one-time setup step; it writes SIE to the device, after which every later sync is path-based. Documentation frames this as: *"pass USB through once to set the iPod up; afterwards a plain volume mount is enough."*
- **USB inquiry is blessed inside the container; SCSI inquiry is not (yet).** USB inquiry is one clean flag and covers the common case. SCSI inquiry (the fallback for older iPods that stall on USB) needs `/dev/sg*` exposure via cgroup-rule + `/dev` bind or `--privileged` — a real privilege/security cost — and is deferred to a backlog task whose scope is described in terms of *which devices it unlocks*.
- **Generic-iPod sync becomes a hard error.** Rather than silently degrade, sync refuses an unknown/unresolved model and tells the user how to fix it (one-time USB setup / `doctor --repair sysinfo-extended`). This is the universal backstop that also makes the daemon correct for free.
- **The daemon gates on identity, not registration.** Because `sync` now hard-errors on generic, the daemon (which shells out to `sync`) automatically stops syncing unsetup devices and can surface actionable guidance — with no rewrite and without ever writing SIE itself. Separately, when a writable/declared config entry matches the detected UUID, the daemon passes the device *name* so per-device settings apply.
- **ENV reaches toward config parity.** Single mass-storage device via ENV (`type` + `path` + `preset`) lands now, giving iPod and mass-storage symmetric single-device daemon lanes. Full ENV↔config parity (lists of devices and collections) is a stated direction but out of scope here.

## User Stories

1. As a Docker user, I want `docker run podkit doctor` to actually run the diagnostics, so that I can troubleshoot my setup inside the container.
2. As a Docker user, I want every current podkit subcommand to work through the image, so that the container isn't silently behind the CLI I read about in the docs.
3. As a first-time Docker user with an iPod already initialised by iTunes, I want to mount it and sync with zero device-setup ceremony, so that the happy path is trivial.
4. As a Docker user with an iPod that lacks authoritative identity, I want a clear one-time setup step (`device add` with USB passthrough) that writes its identity, so that subsequent syncs are correct and need no USB.
5. As a Docker user, I want it documented exactly which iPods and mass-storage devices the USB setup approach supports, so that I know up front whether my device works.
6. As a Docker user whose iPod can't be identified, I want sync to stop with an actionable error rather than silently sync as a "generic iPod", so that I never get the wrong artwork format or a broken database without knowing.
7. As a Docker user, I want the container to tell me at startup what device access it has (is `/ipod` mounted? is `/dev/bus/usb` present? `/dev/sg*`?) and what to do about it, so that I can fix passthrough before hitting a confusing failure.
8. As a daemon user, I want the daemon to refuse to sync a device that needs setup and tell me to run `device add` once, so that it never silently fails or mangles an unsetup device.
9. As a daemon user, I want the daemon to never auto-write identity/SysInfo to a freshly-detected device, so that a misdetected or wrong device is never mutated automatically.
10. As a daemon user with a freshly-wiped iPod (no database), I want a clear "needs init" notification rather than a generic "sync failed", so that I know the next step.
11. As a daemon user with devices declared in my config, I want the daemon to apply my per-device settings (matched by UUID), so that the daemon respects the same configuration the CLI does.
12. As a Docker user with a single iPod and no config file, I want ENV-only daemon mode to just work, so that I don't have to manage a config file for the common case.
13. As a Docker user with a single cheap USB mass-storage player and no config file, I want to declare it (type + path + preset) via ENV, so that I get the same zero-config daemon lane as a single-iPod user.
14. As a Docker user with multiple or differentiated devices, I want it documented that I need a config file, so that I understand why ENV alone is insufficient.
15. As a Docker user, I want the canonical one-shot and daemon `docker run`/compose invocations documented for each onboarding path, so that I can copy a known-good recipe.
16. As a Docker user coming from the host setup, I want it documented that the host udev rule is irrelevant inside the container, so that I don't waste time on it.
17. As a maintainer, I want the entrypoint's command list to stay in lockstep with the CLI, so that future commands don't silently break in the image.
18. As a maintainer, I want the daemon's device-decision logic extracted into pure, testable modules, so that onboarding behavior is verifiable without spinning a container.
19. As an owner of an older iPod that stalls on USB inquiry, I want a clearly-described backlog path (SCSI-in-container) for setting it up in Docker, so that I know it's acknowledged even though it isn't supported yet.
20. As a maintainer, I want the exact USB/SCSI device-support model documented in the codebase, so that the support boundary is a source of truth, not tribal knowledge.

## Implementation Decisions

**Entrypoint / image**

- Add `doctor` to the entrypoint command list, and make command-parity robust rather than a hand-maintained list that drifts (derive/validate against the CLI's known commands).
- Verify firmware inquiry works inside the Alpine image (the `usb` native prebuild, plus SG_IO via koffi). Add runtime system packages (e.g. libusb) only if verification shows they're needed; otherwise document why none are required.
- Add a **container device-access probe** at startup: a pure module that, given the container's filesystem/proc view, reports whether `/ipod` is mounted, whether `/dev/bus/usb` is present, whether `/dev/sg*` is present, and emits actionable guidance. Keep the bash entrypoint thin; put the logic where it can be unit-tested.

**Core sync behavior**

- **Unknown-model sync guard:** convert the current unknown/generic-model *warning* into a hard, typed error at the sync boundary, with remediation text pointing at the one-time USB setup / `doctor --repair sysinfo-extended`. This is a deliberate behavior change affecting host and Docker alike. Extract the decision as a pure function over the resolved identity so it is table-testable.

**Daemon**

- **Device-registry resolver** (pure): given a detected UUID and the loaded config, resolve to a registered device name or "unregistered". Drives whether the daemon invokes the CLI by name (per-device settings apply) or by path (global/ENV settings).
- **Readiness classifier** (pure): given a detected device, classify `ready | needs-setup | needs-init | unsupported`, driving notify-and-skip. The daemon never auto-mutates a detected device (never writes SIE, never auto-inits a blank DB).
- The daemon continues to shell out to the CLI; the hard-error-on-generic change means the daemon inherits correct behavior without a core rewrite. The daemon gains the ability to consult config for the registry match (today it explicitly does not load config — this is the scoped change).

**Config / ENV**

- **Mass-storage ENV mapper** (pure): map a single mass-storage device declaration (`type` + `path` + `preset`, preset defaulting to generic) from ENV into the same `DeviceConfig` shape the config file produces. First slice of the broader ENV↔config parity direction.
- Document the supported matrix: ENV = single device + global settings; config = multiple/differentiated devices + per-device settings; mass-storage daemon auto-sync requires a declared preset (no identity to resolve).

**Documentation (in-repo + user docs)**

- In-codebase **USB/SCSI device-support matrix**: which iPod generations resolve from on-disk identity vs need the one-time USB setup; which need the SCSI fallback (and are therefore unsupported in-container today); how mass-storage (preset-based, no inquiry) fits.
- User docs: onboarding runbook (path baseline + one-time USB setup), daemon config-mode matrix, canonical `docker run`/compose recipes per path, udev-irrelevance note, `doctor` example.

## Testing Decisions

Full detail lives in the companion **"podkit-docker testing strategy"** doc. Summary of decisions:

- **Good tests assert external behavior, not implementation.** The five extracted modules (unknown-model guard, device-registry resolver, readiness classifier, mass-storage ENV mapper, container device-access probe) are pure and unit-tested in isolation by feeding inputs and asserting outputs/typed errors — no container required.
- **Layered local harness (no CI requirement — local is sufficient):** daemon unit (gate the existing suite into the quality run), entrypoint `bats` tests, an image smoke test (build native-arch → `--version`, `doctor`, command-parity, ffmpeg + both binaries present), daemon integration against a loopback FAT fixture iPod (no USB), and a full image+daemon e2e inside the Lima VM against a synthesized USB iPod.
- **Prior art:** the VM e2e harness (`e2e-vm-tests` + `device-testing-daemon`) already synthesizes USB iPods, serves SysInfoExtended over the vendor read, and tests `device add` / `doctor --repair sysinfo-extended` / discovery against them. The deepest tier re-points these existing personas at the Docker image rather than the host binary. Note: macOS Docker Desktop cannot pass USB to containers, so the image+USB e2e runs inside the Linux VM.

## Out of Scope

Tracked as `Draft` tasks (visible, not this release) under m-22 or deferred to m-21:

- **SCSI inquiry inside the container** (TASK-296), re-scoped around *which devices it unlocks* (older iPods that stall on USB inquiry). Drags in `/dev` bind + cgroup-rule + security review.
- **Full ENV↔config parity:** lists of devices and lists of collections via an indexed ENV convention. Only the single-device mass-storage slice lands now.
- **Deep daemon hotplug** for `/dev/sg*` appearance/disappearance; multi-arch image execution validation.
- **Auto-initialising blank iPods** from the daemon (deliberately rejected — auto-formatting a freshly-detected device is a data-loss footgun; the daemon detects-and-notifies only).

## Further Notes

- The split between *setup* (one-time, may need USB, writes SIE, manual via `device add`) and *steady-state* (path-based, no USB, daemon-driven) is the spine of the whole design; keep documentation organised around it.
- The hard-error-on-generic change is the single highest-leverage item: it makes the daemon correct without a rewrite and closes the silent-degradation footgun.
- Keep the entrypoint bash thin; logic belongs in testable modules invoked from it.
