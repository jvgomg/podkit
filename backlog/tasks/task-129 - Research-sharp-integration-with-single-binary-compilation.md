---
id: TASK-129
title: Research sharp integration with single-binary compilation
status: To Do
assignee: []
created_date: '2026-03-12 11:11'
labels:
  - phase-0
  - research
  - artwork
milestone: ipod-db Core (libgpod replacement)
dependencies: []
references:
  - doc-003
  - TASK-119
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigate how `sharp` (libvips) can be bundled into podkit's single-binary distribution. The project compiles standalone CLI binaries targeting specific architectures, and sharp's native `.node` addon needs to work within that model.

**Questions to answer:**

1. **How does sharp distribute its native code?** It ships prebuilt `.node` binaries per platform/arch. How does this interact with `bun build --compile` or the current podkit compilation approach?

2. **Can sharp's prebuilt binary be embedded in a single executable?** Bun's `--compile` supports embedding native addons, but what are the limitations? Does it work with sharp specifically?

3. **What's the binary size impact?** sharp's libvips is substantial. How much does it add to each platform binary?

4. **Are there lighter alternatives?** Options to evaluate:
   - `@aspect-run/sharp-wasm` or similar WASM-based sharp alternative
   - `jimp` (pure JS, no native deps, but slower)
   - Minimal custom WASM module for just resize + raw pixel extraction
   - Using FFmpeg (already a dependency) for image resizing via `ffmpeg -i input.jpg -vf scale=128:128 -f rawvideo -pix_fmt rgb565le output.raw`

5. **FFmpeg as image processor?** podkit already requires FFmpeg for transcoding. Could we use FFmpeg for artwork resizing too? This would eliminate sharp entirely. FFmpeg can output raw pixel data in specific formats (rgb565, rgb555, uyvy, yuv420p) which is exactly what we need for .ithmb files.

**Recommendation criteria:**
- Must work in single-binary compilation for macOS arm64, macOS x64, Linux x64, Linux arm64
- Must handle JPEG/PNG input, resize with good quality, EXIF rotation
- Must output raw RGB pixel data for format conversion
- Smaller binary size is better
- Fewer native dependencies is better

**Impact:** This decision affects TASK-119 (artwork) and TASK-128 (photos). Resolve before starting Phase 3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Documented which image processing approach works with single-binary compilation
- [ ] #2 Tested proof-of-concept: resize JPEG to 128x128, extract raw RGB pixels, in compiled binary
- [ ] #3 Binary size impact measured for at least 2 approaches
- [ ] #4 FFmpeg-based approach evaluated as alternative to sharp
- [ ] #5 Decision documented with rationale in doc-003
<!-- AC:END -->
