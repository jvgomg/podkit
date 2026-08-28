---
id: TASK-487
title: Short in-VM transport and docker-image calls are still unbounded
status: In Progress
assignee: []
created_date: '2026-08-28 01:26'
updated_date: '2026-08-28 17:23'
labels:
  - testing
  - vm
  - reliability
  - tech-debt
dependencies: []
references:
  - test-packages/lima/src/transport.ts
  - test-packages/lima/src/docker-image.ts
  - test-packages/lima/src/lifecycle.ts
priority: low
ordinal: 266000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The VM lifecycle operations were given per-operation bounds, a progress watchdog and a heartbeat (TASK-486). The same treatment was deliberately not extended to the transport and docker-image helpers, which still pass no `timeoutMs` and emit no heartbeat.

**Where.** `test-packages/lima/src/transport.ts` — `copyOut` and `stageSourceTree`; and most of `test-packages/lima/src/docker-image.ts`.

**The distinction that matters.** Some of these are genuinely open-ended and are correctly left unbounded: an rsync staging a multi-GB tree, or a `nerdctl build`, can legitimately run for many minutes, and that is the same carve-out `ensureRunning` has. But others are short operations that should complete in seconds and can hang in exactly the shape TASK-486 fixed:

- `systemctl start` / `systemctl stop` for persona units
- `mkdir -p`, `chmod`, `rm -f` housekeeping
- `nerdctl system prune`

A hang in any of those today produces an indefinitely blocked command with no output and nothing naming what was being waited for — the failure mode that cost real debugging time and produced two false root causes during the harness work.

**Suggested approach.** Do not blanket-bound the module. Classify each call site as "genuinely open-ended" or "should finish in seconds", bound only the latter, and let the open-ended ones inherit the progress-based liveness the streaming runner already provides where they stream. `test-packages/lima/src/lifecycle.ts` is the worked example of that classification, including constants whose derivation is written beside them rather than being round numbers.

**Prerequisite already in place.** `runLimactl` is now the sole owner of the descriptive `timed out after Nms` message, and both the buffered and streaming runners reach it. Two separate defects were code spawning `limactl` directly and losing that message (`runInVm`, fixed in `152c8128`; `runViaLimactl`, fixed in `5123fab3`), so any new bound should go through the wrapper rather than a direct spawn.

Lower priority than TASK-486: these paths are not the ones observed hanging, and several are legitimately long-running. Worth doing before the next person debugs a silent hang in one of them.
<!-- SECTION:DESCRIPTION:END -->
