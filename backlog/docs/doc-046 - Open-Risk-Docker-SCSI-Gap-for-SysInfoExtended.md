---
id: doc-046
title: 'Open Risk: Docker SCSI gap for SysInfoExtended'
type: guide
created_date: '2026-06-21'
tags:
  - open-risk
  - docker
  - scsi
  - sysinfo
  - device-add
  - m-18
---

## Problem

A Docker user whose mounted iPod has no on-disk `SysInfoExtended` is directed by `podkit device add --no-verify` to run `podkit doctor --repair sysinfo-extended`. That repair writes `SysInfoExtended` via SCSI/USB firmware inquiry. SCSI/USB inquiry may not be available inside the container.

Checksum-based iPod generations — those identified via hash58/72/AB model numbers (iPod Classic 6G/7G, Nano 3G+, and others that embed a device-specific checksum in the iTunesDB) — **require** `SysInfoExtended` on disk for sync to write a valid database. Without it, the iPod shows "No Music" after sync regardless of whether the data transfer succeeded. Without SCSI access anywhere in the pipeline, these devices cannot sync at all.

## Current behaviour (TASK-430, doc-045)

| Tier | What happens when SysInfo is absent |
|------|-------------------------------------|
| `--no-verify` (trust-disk) | Refuses with exit 1, message: "run `podkit doctor`" |
| `--no-validate` (config-inject) | Adds the config row successfully; sync will fail later when the checksum cannot be computed |
| default (verify) | Offers to write SysInfoExtended via firmware inquiry; fails if SCSI is unavailable |

The `--no-verify` refusal is the correct defensive behaviour (it prevents silently adding a device that cannot sync), but the remediation hint is only actionable outside the container.

## Current recommended workflow

Run `podkit doctor --repair sysinfo-extended` **once** on a host with SCSI access — macOS with `iPodDriver.kext` loaded, or a Linux host with the `sg` kernel module and the podkit udev rule installed. `SysInfoExtended` is written to `iPod_Control/Device/SysInfoExtended` on the iPod filesystem and persists across remounts. After that, Docker usage via `--no-verify` proceeds normally.

```bash
# On the SCSI-capable host (outside Docker):
podkit doctor --repair sysinfo-extended

# Then from Docker / headless:
podkit device add -d ipod --no-verify --path /mnt/ipod
podkit sync -d ipod
```

## Candidate future directions (none committed)

1. **Synthesize SysInfo from `--type`/generation** — use the `@podkit/devices-ipod` generation tables (which already encode the model-number-to-checksum-algorithm mapping) to write a minimal `SysInfoExtended` from a declared `--type` flag, with zero SCSI required. This ties to the `--no-validate` path and would make the gap disappear for devices whose generation is known at add time. See `packages/devices-ipod/src/` for the tables.

2. **Confirm `SG_IO` under `--privileged`** — empirically check whether SCSI passthrough via `SG_IO` works inside a Docker container run with `--privileged`. If it does, the gap is limited to rootless containers (which cannot pass through raw USB/SCSI) and the existing default-tier flow works in privileged containers without any workaround.

3. **Path-of-least-resistance note** — option (1) is the cleaner long-term fix. Option (2) is a clarification of scope, not a code change. Neither is blocked on any in-flight work.

## Related

- doc-045 §"Further Notes — Docker SCSI gap" — the authoritative origin of this risk item
- [Device Health Checks — Repairing Missing SysInfoExtended](/user-guide/devices/doctor#repairing-missing-sysinfoextended)
- [Adding a Device — Docker SCSI gap](/user-guide/devices/adding-devices#docker-scsi-gap)
- `packages/ipod-firmware/src/inquiry/` — SCSI/USB inquiry implementation
- `packages/devices-ipod/src/` — generation tables (candidate input for option 1)
