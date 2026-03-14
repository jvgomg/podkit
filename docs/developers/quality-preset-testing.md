---
title: Quality Preset Device Testing
description: Methodology and results for testing quality preset change detection with real iPod hardware.
sidebar:
  order: 6
---

Quality preset change detection (TASK-137) compares iPod track bitrate against the current preset target to detect when a user has changed their quality setting. Because VBR encoding produces content-dependent bitrates, this feature requires real-device testing beyond what unit and E2E tests can verify.

## Why Device Testing Is Needed

- **VBR variance is content-dependent.** The `aac_at` encoder on macOS produces bitrates that vary by track content. The ±50 kbps tolerance was chosen based on empirical data, but new content or encoder versions could shift the ranges.
- **Dummy iPod bitrates are unreliable.** The libgpod-based test iPods store very low bitrate values (~14-17 kbps) for short test fixtures, making automated E2E preset detection testing impractical. Unit tests cover the detection logic; device tests verify it end-to-end.
- **Encoder mapping correctness.** The `aac_at` encoder uses an inverted quality scale (0=best, 14=worst) compared to the native `aac` encoder (5=best). This was discovered through device testing and would not have been caught by unit tests alone.

## Observed VBR Ranges (aac_at on macOS)

Measured across CHVRCHES, Foals, and Mk.gee (44 tracks, diverse genres):

| Preset | Target | aac_at `-q:a` | Observed range | Average |
|--------|--------|---------------|---------------|---------|
| low | 128 kbps | 6 | 111-161 kbps | 139 kbps |
| medium | 192 kbps | 4 | 154-225 kbps | 189 kbps |
| high | 256 kbps | 2 | 212-305 kbps | 253 kbps |
| max | 320 kbps | 0 | 284-386 kbps | 339 kbps |

Adjacent presets (e.g., medium and high) have overlapping VBR ranges. This means:

- **Jumps of 2+ preset levels** (e.g., low to high, low to max) are always detected
- **Single-step transitions** between adjacent VBR presets may miss some tracks in the overlap zone
- **CBR presets** (`low-cbr`, `high-cbr`, etc.) produce exact bitrates and are always detected

## Test Methodology

### Setup

1. **Create a local test collection** with FLAC files from 3+ albums across different genres (electronic, rock, indie). Different genres produce different VBR bitrates for the same quality setting.

2. **Create a test config** pointing at the local collection with a starting quality preset:

```bash
mkdir /tmp/podkit-preset-test
cp -r "/path/to/Artist1/Album" /tmp/podkit-preset-test/
cp -r "/path/to/Artist2/Album" /tmp/podkit-preset-test/
cp -r "/path/to/Artist3/Album" /tmp/podkit-preset-test/

cat > /tmp/podkit-preset-test-config.toml << 'EOF'
[music.test]
path = "/tmp/podkit-preset-test"

[devices.myipod]
volumeUuid = "YOUR-UUID-HERE"
quality = "low"
artwork = true

[defaults]
music = "test"
device = "myipod"
EOF
```

3. **Clear the iPod** by syncing an empty directory with `--delete`, then sync the test collection.

### Stress Test Sequence

Run through each step, verifying after each:

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Sync at `low` | All tracks added, 112-163 kbps |
| 2 | Change to `high`, dry-run | All 44 tracks: `preset-upgrade` |
| 3 | Sync at `high` | Re-transcoded to 212-305 kbps |
| 4 | Dry-run at `high` | **0 updates** (idempotent) |
| 5 | Change to `max`, dry-run | Most tracks: `preset-upgrade` (some in overlap zone) |
| 6 | Sync at `max` | Re-transcoded to 284-386 kbps |
| 7 | Dry-run at `max` | **0 updates** (idempotent) |
| 8 | Change to `low`, dry-run | All 44 tracks: `preset-downgrade` |
| 9 | Sync at `low` | Re-transcoded to 112-163 kbps |
| 10 | Dry-run at `low` | **0 updates** (idempotent) |
| 11 | Change to `high` with `--skip-upgrades`, dry-run | **0 updates** (suppressed) |
| 12 | Change to `low-cbr`, dry-run | 0 updates (same target bitrate) |
| 13 | Change to `high-cbr`, dry-run | All tracks: `preset-upgrade` |

### Key Assertions

At each step, verify:

- **Track count never changes** — preset changes produce upgrades, not adds/removes
- **Same-preset re-runs are idempotent** — 0 updates when quality hasn't changed
- **`--skip-upgrades` suppresses** all preset change detection
- **Bitrate distribution** matches expected range for the active preset
- **No infinite loops** — re-transcoding at the same preset produces bitrates within tolerance

### Running with JSON Output

Use `--dry-run --json` to inspect planned operations:

```bash
podkit --config /tmp/podkit-preset-test-config.toml sync --dry-run --json
```

Check `plan.updateBreakdown` for `preset-upgrade` and `preset-downgrade` counts. Check `plan.tracksExisting` to verify idempotency.

## Test Results (March 2026)

Tested on iPod Video 5th Generation (60GB) with 44 FLAC tracks (CHVRCHES, Foals, Mk.gee):

| Transition | Detected | Missed | Notes |
|-----------|----------|--------|-------|
| low → high | 44/44 | 0 | 100% detection |
| high → high | 0/44 | — | Idempotent |
| high → max | 35/44 | 9 | 9 tracks in VBR overlap zone (220-290 kbps) |
| max → max | 0/44 | — | Idempotent |
| max → low | 44/44 | 0 | 100% detection |
| low → low | 0/44 | — | Idempotent |
| low → high (skip-upgrades) | 0/44 | — | Correctly suppressed |
| low VBR → low-cbr | 0/44 | — | Same target bitrate, no re-transcode |
| low → high-cbr | 44/44 | 0 | 100% detection |

## See Also

- [Testing](/developers/testing) - Overall testing strategy
- [Quality Presets](/reference/quality-presets) - Preset specifications
- [Track Upgrades](/user-guide/syncing/upgrades) - User-facing upgrade documentation
