---
"podkit": minor
"@podkit/core": minor
---

Add a per-device bitrate-change policy for audio quality syncing.

A new `[devices.<name>.bitrate]` config block (also settable globally as `[bitrate]`) chooses how syncs re-encode existing tracks when their quality drifts from the device target:

- `match-cap` (default) — hold the cap in both directions, but keep a better device copy when the source was re-ripped lower (reported, not destroyed).
- `match-all` — follow the source in every direction, including down.
- `up-only` / `down-only` — only ever grow, or only ever shrink, existing tracks.
- `off` — freeze bitrates entirely; format and encoding-mode corrections still apply.

The new `--bitrate-sync <mode>` flag overrides the device policy for a single sync run. Optional `toleranceUp` / `toleranceDown` ratios damp trivial source-bitrate drift so re-rips with tiny bitrate wobble don't churn a re-encode (default 0 = exact). Switching the device encoding mode (CBR↔VBR) now re-encodes to correct the encoding even when the bitrate is unchanged and even under `bitrate.sync = off`, because it is a correctness fix rather than a bitrate preference.
