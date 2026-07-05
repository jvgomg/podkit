---
"podkit": minor
"@podkit/core": minor
"@podkit/device-types": patch
---

Replace `[bitrate].sync` policy with down-only lossy reduction (`[bitrate].reduce`)

This is a clean-break config change (ADR-023). The five-mode `[bitrate].sync` key (`match-cap`, `match-all`, `up-only`, `down-only`, `off`) and the `toleranceUp` / `toleranceDown` fields are **removed**. Using them now produces a config error with a pointer to the replacement.

## What changed

### New config keys

```toml
[bitrate]
reduce = "auto"      # auto | always | never  (default: auto)
tolerance = 0.25     # source-proximity fraction  (default: 0.25)
```

`reduce = "auto"` follows the transfer mode: `optimized` converts (reduces over-cap device-native lossy sources); `fast` and `portable` preserve (copy them as-is). `always` always converts; `never` always preserves.

`tolerance = 0.25` is the source-proximity damper on the **add path** only — a device-native lossy source is reduced only when `source > cap × (1 + tolerance)`. The default 0.25 means a source within 25% of the cap is copied as-is. The recorded-vs-cap comparison on re-sync always uses tolerance 0 (exact), because the sync tag records what podkit encoded — there is no ffprobe wobble to damp.

### New CLI flags

- `--bitrate-reduce <auto|always|never>` — override `[bitrate].reduce` for one run.
- `--bitrate-tolerance <fraction>` — override `[bitrate].tolerance` for one run.

### New env vars

- `PODKIT_BITRATE_REDUCE` — override `[bitrate].reduce`.
- `PODKIT_BITRATE_TOLERANCE` — override `[bitrate].tolerance`.

### Lossy reduction is down-only

Re-encoding a lossy track up cannot recover discarded information, so podkit never does it automatically. When you **raise the cap**, tracks previously reduced to a lower preset sit below the new target and are surfaced as a `below-cap` report:

```
N tracks below your quality target — re-sync with --force-transcode to lift them
```

Use `--force-transcode` to explicitly re-lift them to the current cap.

Lossy tracks that were never reduced (copied with `quality=copy` in their sync tag) are not surfaced as `below-cap` — they were never capped, so raising the cap is not a meaningful event for them.

### Removed: lossy `cap-up` and `source-improved`

The `cap-up` reason is now lossless-source only (a higher preset or ALAC upgrade). It is never produced for a lossy track. `source-improved` (a lossy source whose bitrate climbed above the device copy triggering an upward re-encode) is removed entirely — a changed source folds into ordinary content-change detection (self-healing).

### Report-only signals (unchanged behaviour, new reason)

- `source-down-suppressed` — source re-ripped to a lower bitrate than the device copy; the better copy is kept and reported.
- `below-cap` (new) — a previously-reduced track now sits below a raised cap; surfaced so the user can `--force-transcode` to lift it.

### Capability seam (`@podkit/device-types`)

`DeviceCapabilities` gains an optional `maxAudioBitrate` (kbps) field — a device-declared ceiling for lossy audio, consumed by the reduction seam. It is additive and unpopulated (no device profile sets it yet), so behaviour is unchanged; the field exists so a future per-device ceiling is a non-breaking addition.

## Migrating

| Old config | New equivalent |
|---|---|
| `[bitrate].sync = "match-cap"` | `[bitrate].reduce = "always"` (convert any over-cap source) |
| `[bitrate].sync = "down-only"` | `[bitrate].reduce = "always"` (down-only is the only direction now) |
| `[bitrate].sync = "off"` | `[bitrate].reduce = "never"` |
| `[bitrate].sync = "up-only"` | No equivalent — upward re-encoding is removed |
| `[bitrate].sync = "match-all"` | No equivalent — following source down is removed |
| `[bitrate].toleranceUp = 0.1` | `[bitrate].tolerance = 0.1` (single direction) |
| `--bitrate-sync <mode>` | `--bitrate-reduce <auto\|always\|never>` |

Per the project's minor-bump policy for CLI-breaking changes.
