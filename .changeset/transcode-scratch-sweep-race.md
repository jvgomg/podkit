---
"podkit": patch
"@podkit/core": patch
---

Stop a concurrent sync's debris sweep from deleting another sync's in-flight transcodes.

Every sync creates a scratch directory under the system temp dir and stamps it with an `.owner` marker so the debris sweep can tell a live session from a crashed one. The marker cannot be written in the same operation as the directory, so there is always a brief window where a live scratch directory carries no marker — and a second podkit process sweeping in that window treated it as abandoned and removed it. The first process then wrote every remaining transcode into a directory that no longer existed, so FFmpeg failed with `No such file or directory` on all of them at once and the sync reported a partial failure with nothing transferred.

An unmarked scratch directory is now left alone until it has gone a minute untouched, which no live session ever does. A directory whose owner is a *dead* process is still reclaimed on sight, so a killed sync's leftovers are cleared by the next run exactly as before.

Transcode failures also now carry FFmpeg's own diagnostic — `FFmpeg exited with code 254: Error opening output /tmp/…: No such file or directory` rather than the bare exit code, which could not distinguish an unreadable source from an unwritable destination.
