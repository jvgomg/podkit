---
"podkit": patch
"@podkit/core": patch
---

Enforce the quality preset's bitrate ceiling on hosts without `aac_at` or `libfdk_aac`.

FFmpeg's native `aac` encoder was being handed podkit's internal 1-5 quality number as `-q:a`, which on that encoder is a `global_quality` index with no bitrate meaning — the resolved target bitrate was discarded entirely. On every host that resolves to native `aac` (all stock Linux, the mise-pinned conda FFmpeg, `ubuntu-latest` CI), that silently produced files above the preset the user asked for: `low` landed at ~190 kbps against a 128 kbps cap and `medium` at ~230 kbps against 192 kbps, contradicting ADR-023 §2's promise that a quality preset is a hard ceiling. The overshoot was invisible, because the sync tag records the preset *name*, so re-sync saw nothing to fix.

Native `aac` is now driven in average-bitrate mode at the resolved target, whose rate control tracks the request within a kbps even on incompressible content.

`libfdk_aac` had a milder form of the same defect — it ignored the target too, so a planner-reduced target (a lossy source capped below the preset) still got the full preset's `-vbr` level. It now picks the richest VBR level whose published bitrate band fits under the target. This also changes the `low` preset on that encoder, from `-vbr 2` to `-vbr 3`: `low` was landing around 64-80 kbps against a 128 kbps preset, so files transcoded at `low` on a libfdk build will now be somewhat larger and better, matching what the preset always claimed. `high` and `medium` are unchanged there.

`aac_at` already mapped from the target and is unchanged. Its quality scale is coarse enough that its output can still sit a few percent either side of the preset bitrate; on that encoder the figure remains a target rather than a hard cap.

Tracks transcoded by an affected build stay as they are until something else re-syncs them; `--force-transcode` re-encodes them at the correct ceiling.
