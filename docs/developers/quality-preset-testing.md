---
title: Quality Preset Device Testing
description: Methodology and results for testing quality preset change detection with real iPod hardware.
sidebar:
  order: 6
---

When a user changes their quality preset, podkit detects that existing tracks don't match the new target and re-transcodes them on the next sync. Because encoding produces content-dependent bitrates (especially audio VBR), detection logic requires real-device testing beyond what automated unit and E2E tests can verify.

## Why Device Testing Is Needed

- **Audio VBR variance is content-dependent.** The `aac_at` encoder on macOS produces bitrates that vary by track content. Detection relies on the sync tag (exact comparison) for tagged tracks; bitrate comparison is only a fallback for pre-tag tracks.
- **Video CRF variance depends on content complexity.** Video uses CRF encoding with a bitrate cap. The actual bitrate is very consistent in practice (±4 kbps observed) but could vary more with extreme content.
- **Dummy iPod bitrates are unreliable.** The libgpod-based test iPods store very low bitrate values (~14-17 kbps) for short test fixtures, making automated E2E detection testing impractical. Unit tests cover the detection logic; device tests verify it end-to-end.
- **Encoder mapping correctness.** The `aac_at` encoder uses an inverted quality scale (0=best, 14=worst) compared to the native `aac` encoder (5=best). This was discovered through device testing and would not have been caught by unit tests alone.

## Detection Approach

**Audio:**

The quality classifier (`classifyQualityChange` in `upgrades.ts`) uses the sync tag as the sole truth:

1. For tagged tracks, compare the sync tag's quality tier and recorded bitrate against the current target — exact, no tolerance.
2. For `max` preset on ALAC-capable devices, use format detection instead of bitrate comparison.
3. Untagged tracks are opted out of bitrate/encoding detection (no DB-bitrate fallback).

Lossy sources (MP3, AAC) take the `classifyLossyDeviceBound` path via the shared `resolveLossyReduction` seam — **down-only**:

- A lossy track whose recorded sync-tag bitrate exceeds the cap is re-encoded **down** to the cap (`cap-down`).
- A lossy track that was previously reduced and sits below a raised cap is surfaced as a `below-cap` report (never auto-lifted; use `--force-transcode`).
- A source that degraded below the device copy is reported as `source-down-suppressed` (kept, not re-encoded).

The DB-bitrate tolerance comparison is not used for lossy tracks.

**Video:**

All videos are transcoded. `detectBitratePresetMismatch()` in `upgrades.ts` compares the stored container bitrate against the current preset target using a percentage-based tolerance (30% for VBR, 10% for CBR). All existing videos need re-transcoding on a preset change (remove + re-add; no user data to preserve).

**Video-specific:** All videos are transcoded, so all existing videos are checked. Videos needing re-transcoding are removed and re-added (no user data to preserve).

## Observed Ranges

### Audio (aac_at VBR on macOS)

Measured across CHVRCHES, Foals, and Mk.gee (44 tracks, diverse genres):

| Preset | Target | aac_at `-q:a` | Observed range | Average |
|--------|--------|---------------|---------------|---------|
| low | 128 kbps | 6 | 111-161 kbps | 139 kbps |
| medium | 192 kbps | 4 | 154-225 kbps | 189 kbps |
| high | 256 kbps | 2 | 212-305 kbps | 253 kbps |

The `max` preset produces ALAC on devices that support it, otherwise falls back to the same quality as `high`.

Adjacent audio presets (e.g., medium and high) have overlapping VBR ranges:
- **Jumps of 2+ preset levels** (e.g., low to high) are always detected
- **Single-step transitions** between adjacent VBR presets may miss some tracks in the overlap zone
- **CBR encoding** (`encoding = "cbr"`) produces exact bitrates and all preset changes are reliably detected

### Video (H.264 CRF + bitrate cap)

Measured on iPod Video 5th Gen with 5 movie clips (varied content):

| Preset | Target (5G) | Observed range | Average |
|--------|------------|---------------|---------|
| low | 396 kbps | 399-400 kbps | 399 kbps |
| medium | 496 kbps | 499-500 kbps | 500 kbps |
| high | 728 kbps | 731-734 kbps | 733 kbps |
| max | 896 kbps | 900-903 kbps | 902 kbps |

Video bitrates are very consistent because CRF + bitrate cap produces predictable output. All adjacent transitions are reliably detected.

### Video Preset Spacing by Device

| Device | low | medium | high | max | Min gap |
|--------|-----|--------|------|-----|---------|
| iPod Classic | 1096 | 1628 | 2128 | 2660 | 500 kbps |
| iPod Video 5G | 396 | 496 | 728 | 896 | 100 kbps |
| iPod Nano 3G+ | 396 | 496 | 728 | 896 | 100 kbps |

The percentage-based tolerance (30% VBR, 10% CBR) works for all device profiles. iPod Classic has very large gaps (500+ kbps). iPod Video 5G/Nano have a minimum gap of 100 kbps (medium to low), which is well within detection range.

## Test Methodology

### Audio Test Setup

1. **Create a local test collection** with FLAC files from 3+ albums across different genres (electronic, rock, indie). Different genres produce different VBR bitrates for the same quality setting.

2. **Create a test config** pointing at the local collection:

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

### Audio Stress Test Sequence

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Sync at `low` | All tracks added, ~112-163 kbps |
| 2 | Change to `high`, dry-run | All lossless-source tracks: `quality-change-up` (`cap-up`); FLAC-sourced AAC tracks at `low` are below the `high` cap — the `cap-up` fires because the preset tier changed |
| 3 | Sync at `high` | Re-transcoded to ~212-305 kbps |
| 4 | Dry-run at `high` | **0 updates** (idempotent) |
| 5a | **Non-ALAC device:** Change to `max`, dry-run | **0 updates** (`max` = same as `high` on non-ALAC devices) |
| 5b | **ALAC-capable device:** Change to `max`, dry-run | All tracks: `quality-change-up` (`cap-up`, lossless-source preset upgrade to ALAC) |
| 6b | Sync at `max` on ALAC device | Re-transcoded to ALAC (lossless) |
| 7b | Dry-run at `max` on ALAC device | **0 updates** (idempotent) |
| 8 | Change to `low`, dry-run | All tracks: `quality-change-down` (`cap-down`) |
| 9 | Sync at `low` | Re-transcoded to ~112-163 kbps |
| 10 | Dry-run at `low` | **0 updates** (idempotent) |
| 11 | `--skip-upgrades` | **0 updates** (suppressed) |
| 12 | Change to `encoding = "cbr"` at `low` | 0 updates (same target bitrate) |
| 13 | Change to `high` with `encoding = "cbr"` | All tracks: `quality-change-up` (`cap-up`) |

### Video Test Setup

1. **Prepare test clips** — slice a movie into 5 × 2-minute segments for varied content:

```bash
mkdir /tmp/podkit-video-test
for i in 1 2 3 4 5; do
  START=$(( (i - 1) * 1200 + 60 ))
  ffmpeg -ss "$START" -i "/path/to/movie.mkv" -t 120 -c copy \
    "/tmp/podkit-video-test/clip-$i.mkv"
done
```

2. **Create a video test config:**

```bash
cat > /tmp/podkit-video-test-config.toml << 'EOF'
[video.test]
path = "/tmp/podkit-video-test"

[devices.myipod]
volumeUuid = "YOUR-UUID-HERE"
videoQuality = "low"

[defaults]
video = "test"
device = "myipod"
EOF
```

### Video Stress Test Sequence

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Sync at `low` | All clips added |
| 2 | Change to `medium`, dry-run | All clips: re-transcode |
| 3 | Sync at `medium` | Re-transcoded |
| 4 | Dry-run at `medium` | **0 changes** (idempotent) |
| 5 | Change to `high`, sync | Re-transcoded |
| 6 | Dry-run at `high` | **0 changes** (idempotent) |
| 7 | Change to `max`, sync | Re-transcoded |
| 8 | Dry-run at `max` | **0 changes** (idempotent) |
| 9 | Change to `low`, sync | Re-transcoded |
| 10 | Dry-run at `low` | **0 changes** (idempotent) |

### Key Assertions

At each step, verify:

- **Track/video count never changes** — preset changes produce upgrades (audio) or remove+re-add (video), not net adds/removes
- **Same-preset re-runs are idempotent** — 0 updates/changes when quality hasn't changed
- **`--skip-upgrades` suppresses** audio preset changes
- **Bitrate distribution** matches expected range for the active preset
- **No infinite loops** — re-transcoding at the same preset produces bitrates within tolerance

### Running with JSON Output

Use `--dry-run --json` to inspect audio planned operations:

```bash
podkit --config /tmp/podkit-preset-test-config.toml sync --dry-run --json
```

Check `plan.updateBreakdown` for `quality-change-up` and `quality-change-down` counts (active re-encodes) and `quality-change-suppressed` (report-only). Sub-reasons in `qualityChanges[].reason`: `lossless-boundary`, `cap-up` (lossless-source only), `cap-down`, `encoding-mismatch` (lossless-source only), `source-down-suppressed` (report-only), `below-cap` (report-only). Check `plan.tracksExisting` to verify idempotency.

## Test Results (March 2026)

### Audio

Tested on iPod Video 5th Generation (60GB) with 44 FLAC tracks (CHVRCHES, Foals, Mk.gee):

| Transition | Detected | Missed | Notes |
|-----------|----------|--------|-------|
| low → high | 44/44 | 0 | 100% detection |
| high → high | 0/44 | — | Idempotent |
| high → low | 44/44 | 0 | 100% detection |
| low → low | 0/44 | — | Idempotent |
| low → high (skip-upgrades) | 0/44 | — | Correctly suppressed |
| low VBR → low CBR | 0/44 | — | Same target bitrate |
| low → high CBR | 44/44 | 0 | 100% detection |

### Video

Tested on iPod Video 5th Generation (60GB) with 5 movie clips (Hot Tub Time Machine, varied scenes):

| Transition | Detected | Idempotent |
|-----------|----------|-----------|
| low → medium | 5/5 | ✓ |
| medium → high | 5/5 | ✓ |
| high → max | 5/5 | ✓ |
| max → low | 5/5 | ✓ |
| low → low | 0/5 | ✓ |

All adjacent video transitions detected. Video CRF + bitrate cap produces highly consistent bitrates with no overlap between presets.

## See Also

- [Testing](/developers/testing) — Overall testing strategy
- [Quality Presets](/reference/quality-presets) — Preset specifications and encoder mapping
- [Track Upgrades](/user-guide/syncing/upgrades) — User-facing upgrade documentation
