---
title: "ADR-003: Transcoding Backend"
description: Decision to use FFmpeg CLI for audio transcoding.
sidebar:
  order: 4
---

# ADR-003: Transcoding Backend

## Status

**Accepted** (2026-02-22)

## Context

podkit must transcode lossless audio (FLAC, ALAC, WAV) to iPod-compatible AAC format. Several transcoding backends are available.

## Decision Drivers

- Audio quality (transparency to source)
- Cross-platform availability
- Ease of integration
- User configurability
- Metadata preservation
- Performance

## Options Considered

### Option A: FFmpeg (CLI)

Execute FFmpeg as a child process.

**Pros:**
- Ubiquitous (available on all platforms)
- Excellent AAC encoder (native or libfdk_aac)
- Full metadata support
- Well-documented

**Cons:**
- External dependency
- CLI parsing complexity

### Option B: GStreamer

Use GStreamer pipeline for transcoding.

**Pros:**
- Plugin architecture
- Native Linux support

**Cons:**
- Complex pipeline configuration
- Less portable

### Option C: faac

Use faac encoder directly.

**Pros:**
- Simple, focused tool

**Cons:**
- Outdated, lower quality
- Limited format support

## Decision

**Option A: FFmpeg (CLI)**

### Rationale

1. **Quality** - FFmpeg's native AAC encoder is excellent; libfdk_aac is even better
2. **Availability** - Pre-installed on many systems, easy to install on others
3. **Documentation** - Extensive guides for AAC encoding
4. **Flexibility** - Full control over encoding parameters
5. **Metadata** - Complete metadata preservation support

## Encoder Selection Strategy

Quality ranking (per FFmpeg Wiki):
```
aac_at >= libfdk_aac > native aac
```

Platform availability:
- **macOS (Homebrew):** `aac`, `aac_at` - no custom build needed
- **Linux (apt/dnf):** `aac` only - `libfdk_aac` requires custom build

## Quality Presets

| Preset | Mode | Target | Description |
|--------|------|--------|-------------|
| high | VBR | ~256 kbps | Transparent quality (default) |
| medium | VBR | ~192 kbps | Excellent quality |
| low | VBR | ~128 kbps | Good quality, space-efficient |

## Consequences

### Positive

- Best available AAC quality
- Consistent behavior across platforms
- Extensive community support

### Negative

- External dependency
- Users must install FFmpeg
- Version variations may cause issues

## Related Decisions

- [ADR-001](/developers/adr/adr-001-runtime): Runtime choice - FFmpeg works with both Node and Bun
- [ADR-002](/developers/adr/adr-002-libgpod-binding): libgpod binding - Transcoding is independent

## References

- [FFmpeg AAC Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/AAC)
- [Hydrogenaudio AAC Encoder Comparison](https://wiki.hydrogenaud.io/index.php?title=AAC_encoders)
