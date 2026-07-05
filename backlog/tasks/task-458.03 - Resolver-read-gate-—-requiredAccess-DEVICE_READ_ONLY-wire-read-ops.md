---
id: TASK-458.03
title: 'Resolver read-gate — requiredAccess + DEVICE_READ_ONLY, wire read-ops'
status: Done
assignee: []
created_date: '2026-07-05 14:23'
updated_date: '2026-07-05 22:27'
labels:
  - device-capability
  - read-only
  - resolver
milestone: m-18
dependencies:
  - TASK-458.01
parent_task_id: TASK-458
ordinal: 212000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enforce access once, at the resolution seam. `resolveDevice` / `resolveDevicePath` gain a `requiredAccess: 'read' | 'write'` parameter. Add a pure `assertAccess(support, requiredAccess)` encoding the truth table (write on read-only/none → throw; read on none → throw; else pass) and a typed `DEVICE_READ_ONLY` error carrying the generation-specific reason. Wire the read-ops to declare read intent: `music`, `video`, `info`, `scan`, `archive` (incl. `--dump-only`). Path-mode derives access from the USB PID via existing path→USB correlation (not SysInfo).

End-to-end payoff: `archive` on a mounted shuffle 4g works (the exact reported failure, now succeeding). Full demo also relies on TASK-458.02 discovery correlation.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Read-ops work end-to-end on a read-only shuffle — verified live: `device music` lists 89 tracks; `device archive --dump-only` dumps 158 files. No read-gate was needed (reads never checked `supported`; discovery visibility from 458.02 was the only blocker)
- [x] #2 Read-only devices get an honest, access-aware refusal (centralized accessLimitationHeadline): read-only tells the user podkit can read+archive it and only sync is refused; none stays a flat refusal
- [x] #3 Wired through every identify path (usb/sysinfo/serial) + the generation-only resolve path
- [x] #4 Verified live: `sync` on the shuffle now says 'read-only — podkit can read and archive it, but cannot sync to it' instead of the generic 'not supported'
- [x] #5 Unit test for accessLimitationHeadline; devices-ipod (375) + core (3396) + typecheck green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope collapsed after live diagnosis. The planned resolver `requiredAccess` gate turned out largely unnecessary:

- Read-ops (music/video/info/scan/archive) never gated on `supported`, so once 458.02 made the shuffle discoverable, archive+music worked immediately. Verified live (89 tracks; 158-file dump).
- Write refusal already existed: the 458.01 migration routes `access !== 'syncable'` into the identity cascade's unsupportedReason, so `sync` already refused the shuffle.

The real remaining value was HONESTY: read-only devices were refused with the same generic 'not a podkit-supported generation' string as truly-unsupported ones. Added accessLimitationHeadline (build-unsupported-reason.ts) as the single wording source, worded by access tier, wired into identity.ts (3 paths) + resolve.ts. Commit 5d44cbe1.

Note the shuffle's USB-path headline still comes from the PID unsupported table (SHUFFLE_REASON, precedence preserved); the read-only wording flows via the generation-only resolve path that sync uses — which is the path that produced the observed generic message.

Follow-up surfaced (for 458.06 / a path-mode-identity task): path-mode `device info` shows 'Unknown Generation' and nudges 'Needs repair — run doctor' for the shuffle because generationId isn't resolved from the USB PID in path-mode readiness, so the 458.01 Support line doesn't render. Doctor per-invocation gating + this path-mode resolution remain for 458.06.
<!-- SECTION:NOTES:END -->
