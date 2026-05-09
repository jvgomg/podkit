---
id: TASK-317.15
title: >-
  Defensive error handling in `device add` when volumeUuid is missing or
  unreadable
status: To Do
assignee: []
created_date: '2026-05-09 20:31'
labels:
  - device-capability-architecture
  - linux
  - ux
  - defensive
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: medium
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`podkit device add` currently falls back to a synthesized `volumeUuid` when udev/blkid don't surface a real one for the partition. The synthesizer takes the parent directory of the mount path and base64-encodes it (e.g. `/media/james/disk` → `manual-L21lZGlhL2phbWVz` which is base64 of `/media/james`, *truncated*). This synthetic value:

- Doesn't survive replug.
- Collides between any two devices mounted under the same parent dir (`/media/james/A` and `/media/james/B` get the identical synthetic UUID).
- Is not printed in `device add` output, so the user has no signal that the entry is broken until something downstream fails.

The dominant trigger today is HFS+ on Linux (no UUID surfaced by udev). Once TASK-317.12 lands (refuse HFS+ on Linux), this code path should rarely fire — but it can still trigger for corrupted FAT32, weird partition layouts, mass-storage devices with unusual filesystems, future filesystems we don't anticipate.

## Fix shape

When `device add` cannot read a real `volumeUuid` from the mounted filesystem:

1. **Refuse to add**, with a clear error explaining why and what to check.
2. **Do not synthesize** a fake UUID. Delete the synthesizer code path entirely.
3. **Print actual identity values** in the `device add` confirmation output regardless of the path — if a real UUID is read, show it (today's FAT32 path already does this); if not, the user should never see "Volume UUID: <some value>" line because the add will have refused before that point.

This is the catch-all defensive layer after TASK-317.12 handles the predictable HFS+ case explicitly.

## Concrete behaviour

### Success (FAT32, nano 3G)

```
podkit device add -d nano3g

Found iPod nano 8GB Black (3rd Generation):
  Name:        IPOD
  Mount:       /media/james/IPOD
  Capacity:    7.4 GB
  Volume UUID: 968A-2063
  Device:      /dev/sdc1
  Tracks:      11
```

(unchanged from today)

### Refuse (corrupted FAT, missing UUID, anything synthetic-fallback would have caught)

```
podkit device add -d <name>

Cannot add iPod: this filesystem does not surface a volume UUID, which podkit needs to identify the device across replugs.

Possible causes:
  - Filesystem corrupted or partially-formatted
  - Unsupported filesystem (HFS+ on Linux is refused; see <docs>)
  - Volume needs reformatting

To diagnose, run:
  lsblk -o NAME,UUID,LABEL,FSTYPE <device>

Exit code non-zero. Same `unsupported-filesystem-on-linux` JSON error code as TASK-317.12 if filesystem is HFS+ on Linux; new code (`missing-volume-uuid` or similar) for the catch-all case.
```

## Cross-references

- **TASK-317.12** (refuse HFS+) handles the dominant case explicitly with platform-specific messaging. This task is the residual defensive layer for everything else.
- **TASK-317.11** (discovery reconciliation) doesn't touch `device add`'s identity-storage path; this task does. Keep them independent.

## Hardware test plan

- linka + nano 3G FAT32: existing happy path unchanged.
- linka + nano 4G HFS+: refused via TASK-317.12 first; if .12 hasn't landed yet, this task's catch-all surfaces a less specific (but still safe) refusal.
- Synthetic test: a mock device-manager fixture that returns a mounted device with no `volumeUuid`. `device add` against it refuses cleanly.
- macOS regression: HFS+ iPods continue to add cleanly because macOS surfaces real volumeUuids.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When `device add`'s identity-resolution path cannot read a real volumeUuid, the command refuses with a clear message naming likely causes and a diagnostic next step (`lsblk -o NAME,UUID,LABEL,FSTYPE`). Exit code non-zero. Structured JSON error code for scripted callers.
- [ ] #2 The synthetic `manual-${base64(parent-dir)}` fallback path is removed from the codebase. Confirmed by grep + tests.
- [ ] #3 On macOS, all inventory iPods (HFS+ and FAT32) continue to add successfully because macOS surfaces real volumeUuids. Verified manually + by regression test.
- [ ] #4 On linka with nano 3G (FAT32), `device add` continues to work and stores `volumeUuid = "968A-2063"` (the real FAT32 serial).
- [ ] #5 When TASK-317.12 has landed, this task's catch-all only fires for non-HFS+ pathological cases. When .12 has not landed, this task still cleanly refuses HFS+ via the more-generic missing-UUID message (acceptable interim state).
- [ ] #6 Tests added: unit tests for the no-UUID case in `device add`, snapshot tests for the refusal output.
<!-- AC:END -->
