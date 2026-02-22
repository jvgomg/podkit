# ADR-003: Transcoding Backend

## Status

**Proposed**

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
- Users may already have it installed

**Cons:**
- External dependency
- CLI parsing complexity
- Process spawning overhead

**Quality:** Excellent (native AAC or libfdk_aac)

### Option B: GStreamer

Use GStreamer pipeline for transcoding.

**Pros:**
- Plugin architecture
- Native Linux support
- Used by Strawberry

**Cons:**
- Complex pipeline configuration
- Less portable (especially on macOS/Windows)
- Multiple encoder options with different quality

**Quality:** Variable (depends on encoder plugin)

### Option C: faac

Use faac encoder directly.

**Pros:**
- Simple, focused tool
- Lightweight

**Cons:**
- Outdated, lower quality than alternatives
- Not maintained
- Limited format support (AAC only, no metadata)

**Quality:** Acceptable but dated

### Option D: fluent-ffmpeg (Node wrapper)

Use the fluent-ffmpeg npm package.

**Pros:**
- Programmatic API
- Promise-based
- Progress events
- Uses FFmpeg under the hood

**Cons:**
- Still requires FFmpeg installed
- Additional dependency
- Abstraction may limit advanced options

**Quality:** Same as FFmpeg (uses it internally)

### Option E: WebCodecs API

Use browser/Deno WebCodecs for encoding.

**Pros:**
- No external dependencies (in supported runtimes)
- Modern API

**Cons:**
- Limited codec support
- Not available in Node.js
- No AAC encoder in current implementations

**Quality:** N/A (AAC not supported)

## Decision

**Option A: FFmpeg (CLI) - Recommended**

### Rationale

1. **Quality** - FFmpeg's native AAC encoder is excellent; libfdk_aac is even better
2. **Availability** - Pre-installed on many systems, easy to install on others
3. **Documentation** - Extensive guides for AAC encoding
4. **Flexibility** - Full control over encoding parameters
5. **Metadata** - Complete metadata preservation support

### Implementation

```typescript
interface Transcoder {
  // Detect FFmpeg and capabilities
  detect(): Promise<TranscoderInfo>;

  // Transcode with progress reporting
  transcode(
    input: string,
    output: string,
    options: TranscodeOptions
  ): AsyncIterable<TranscodeProgress>;
}

interface TranscoderInfo {
  available: boolean;
  version: string;
  path: string;
  encoders: {
    aac: boolean;       // Native encoder
    libfdk_aac: boolean; // Fraunhofer (if compiled in)
    aac_at: boolean;     // AudioToolbox (macOS)
  };
  preferredEncoder: string;
}
```

## Encoder Selection Strategy

```typescript
function selectEncoder(info: TranscoderInfo): string {
  // Prefer in order of quality
  if (info.encoders.libfdk_aac) return 'libfdk_aac';
  if (info.encoders.aac_at) return 'aac_at';  // macOS only
  if (info.encoders.aac) return 'aac';

  throw new Error('No AAC encoder available');
}
```

## Quality Presets

| Preset | Encoder Args | Approximate Bitrate |
|--------|--------------|---------------------|
| high | `-b:a 256k` | 256 kbps CBR |
| medium | `-b:a 192k` | 192 kbps CBR |
| low | `-b:a 128k` | 128 kbps CBR |
| custom | User-defined | Variable |

## Platform Notes

### Debian/Ubuntu

```bash
# Install FFmpeg (includes native AAC)
sudo apt install ffmpeg

# For libfdk_aac (must build from source)
# Due to licensing, not included in Debian packages
```

### macOS

```bash
# Install via Homebrew (includes aac_at)
brew install ffmpeg
```

### Windows

```powershell
# Install via winget
winget install FFmpeg

# Or download from https://www.gyan.dev/ffmpeg/builds/
```

## Consequences

### Positive

- Best available AAC quality
- Consistent behavior across platforms
- Extensive community support
- Future codec support if needed

### Negative

- External dependency
- Users must install FFmpeg
- Version variations may cause issues

### Mitigation

- Document FFmpeg installation for each platform
- Detect FFmpeg version and warn on old versions
- Provide clear error messages when FFmpeg missing
- Consider bundling FFmpeg in future releases

## Related Decisions

- ADR-001: Runtime choice - FFmpeg works with both Node and Bun
- ADR-002: libgpod binding - Transcoding is independent

## References

- [FFmpeg AAC Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/AAC)
- [Hydrogenaudio AAC Encoder Comparison](https://wiki.hydrogenaud.io/index.php?title=AAC_encoders)
- [fluent-ffmpeg npm package](https://www.npmjs.com/package/fluent-ffmpeg)
