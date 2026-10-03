---
"podkit": patch
"@podkit/core": patch
---

Stop the transcode scratch-directory cleanup from deleting a running sync's files when it can't confirm the owner is alive

Before each sync (and on `podkit doctor --repair debris-transcode-tmp`), podkit removes `podkit-transcode-*` scratch directories left behind by crashed syncs. It decides whether a directory is abandoned by checking whether the process that created it is still running, comparing that process's start time with the start time recorded in the directory.

That comparison can fail for a process that is still running. On Linux, a system clock adjustment (for example an NTP correction shortly after boot, or a VM catching up after its host wakes from sleep) shifts the measured start time. On macOS, a heavily loaded machine can make the measurement too slow to be accurate. When that happened, podkit treated the running sync as dead, deleted its scratch directory, and every remaining transcode in that sync failed.

The cleanup now deletes a directory immediately only when the process that created it no longer exists at all. If the process exists but can't be confirmed as the owner, the directory is removed only after nothing in it has changed for an hour. Leftovers from a crashed sync are still removed by the next sync, as before.
