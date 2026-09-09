---
id: TASK-503
title: A false-dead isAlive probe can still reap a live sync's scratch directory
status: To Do
assignee: []
created_date: '2026-09-09 19:41'
labels:
  - sync
  - correctness
  - concurrency
dependencies:
  - TASK-501
references:
  - packages/podkit-core/src/lib/pid-file.ts
  - packages/podkit-core/src/diagnostics/scanners/transcode-tmp-walker.ts
  - docs/architecture/sync/planning.md
priority: medium
type: bug
ordinal: 282000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Recorded but not chased while fixing task-501. That fix closed the window where a live scratch directory has **no** `.owner` marker. This is the remaining door into the same corruption: a directory that *has* a valid marker pointing at a *live* process, which `isAlive` nonetheless reports as dead.

## The mechanism

`isAlive` (`lib/pid-file.ts`) is `kill(pid, 0)` plus a start-time tuple match within ±2s, guarding against PID reuse. The recorded start time comes from `getOwnIdentity()` as `Date.now() - process.uptime() * 1000`; the probe recomputes it from `/proc/<pid>/stat` field 22 plus `/proc/stat`'s `btime`. Any of these makes the two disagree by more than 2s while the owner is alive:

- **A wall-clock step between write and read.** `Date.now()` moves with NTP; the `/proc` derivation is anchored to boot time and does not. A step of >2s — an NTP correction on a freshly-booted VM, a suspended laptop resuming, a container host adjusting time — desynchronises them for a live process.
- **`clkTck` is assumed to be 100.** `readLinuxStartTime` hardcodes it because Node exposes no `sysconf`. The existing comment reasons that a mismatch means "contention, not corruption" — true for the *lock* consumer, false for this one.
- **macOS reads `ps -o etime=`**, whole seconds only, so its own resolution eats into the ±2s budget.

## Why it matters more here than for the lock

`pid-file.ts` has two consumers and the same false-negative has opposite consequences for them:

- **The sync lock** — a false-dead means a second process takes over a lock that is still held. Bad, but the lock's own `LockHandle.release()` re-reads ownership before unlinking, and the blast radius is contention.
- **The transcode-tmp walker** — a false-dead means `rm -rf` on a **live sibling's output directory**, which is precisely the task-501 failure: every subsequent transcode exits 254 and the sync reports a partial failure with nothing transferred.

The `.owner` design treats "dead" as unambiguous and reaps on sight. That is right when the answer is trustworthy, and this is the case where it isn't.

## No evidence it has fired

Every task-501 occurrence is explained by the missing-marker window, which is fixed. This is reasoning about a path, not a reported failure — which is why it was left out of that task rather than folded into it. It is filed because it is now the *only* known route to that corruption, and because a fix that closes one door and leaves an identical one open is worth being deliberate about.

## Directions, none settled

- **Make the walker's dead-owner branch as conservative as its ownerless one.** The mtime grace already protects a recently-touched directory; extending it to a dead-*owner* verdict would cost only that a SIGKILLed session's debris survives one extra sweep, which the ownerless branch already accepts.
- **Fail closed on an unreadable start time.** `readProcessStartTimeMs` returns `null` on any error and the caller treats that as dead. For the walker, "I could not tell" and "definitely dead" should probably not be the same answer.
- **Read `clkTck` honestly** rather than assuming it, if a cheap route exists.
- **Use a monotonic anchor** so a wall-clock step cannot desynchronise the comparison.
- Or decide the risk is acceptable and say so in `pid-file.ts`, so the next reader does not have to re-derive this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The conditions under which `isAlive` returns false for a live process are enumerated and each is judged reachable or not on the platforms podkit supports
- [ ] #2 A decision is recorded on whether the transcode-tmp walker should trust a dead-owner verdict as readily as it does today, given that acting on it deletes a live process's output directory
- [ ] #3 If the verdict is kept, the reasoning is written where a reader of `pid-file.ts` or the walker will find it, rather than only in this task
- [ ] #4 If it is changed, a test pins the new behaviour — including that a genuinely dead owner's debris is still reclaimed rather than accumulating
- [ ] #5 The distinction between the two consumers is documented: the same false negative costs the lock contention and costs the walker a live directory
<!-- AC:END -->
