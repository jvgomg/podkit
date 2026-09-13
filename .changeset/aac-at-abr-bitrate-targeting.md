---
"podkit": minor
"@podkit/core": minor
---

Make the quality preset a real ceiling on macOS by driving `aac_at` in ABR mode

On macOS, podkit prefers Apple's AudioToolbox AAC encoder (`aac_at`). It used to translate a preset's bitrate into the nearest point on that encoder's `-q:a` quality scale, choosing from five rungs (320→q0, 256→q2, 192→q4, 128→q6, 96→q8). Two consequences, both measured on FFmpeg 9.0.1:

- **The ceiling could be exceeded.** Nearest-point rounding rounds up as readily as down, so a 256 kbps preset picked `q=2` — which measures 282 kbps on incompressible stereo, and up to 305 kbps across a 44-track music sample. A preset bitrate is meant to be a hard ceiling, not a midpoint.
- **Different targets became the same request.** A quality index is not a bitrate axis, so the mapping only held for the material it was calibrated on, and every target below ~112 kbps collapsed onto `q=8`. Two tracks that should have been encoded differently — say an efficiency-matched transcode of an Opus source versus a plain conversion of it — were handed byte-identical encoder arguments.

`aac_at` is now driven in average-bitrate mode (`-aac_at_mode abr -b:a …`), the same approach already used for FFmpeg's native `aac`. Measured tracking is within about 2% on worst-case content (130/196/258 kbps for 128/192/256 requests), against 10% or more over the cap before.

AudioToolbox's ABR mode accepts only a fixed ladder of rates — 64, 72, 80, 96, 112, 128, 144, 160, 192, 224, 256, 288, 320 kbps for stereo — and rounds anything else **upward**, which would reintroduce the same overshoot by another route. podkit therefore asks for the highest rung at or below the target: a `customBitrate` of 200 encodes at 192, and a 171 kbps efficiency-matched target encodes at 160. The one case macOS cannot honour is a target below 64 kbps, which is the lowest rate this encoder offers for stereo.

**What this means for your library:** AAC files transcoded on macOS will differ from those produced by earlier versions — generally slightly smaller at the same preset, and no longer able to overshoot it by the double-digit margins the quality-index mapping allowed. Existing files on a device are not re-encoded; podkit only re-transcodes when its own change detection says a track needs it.
