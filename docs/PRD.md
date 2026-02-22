# Product Requirements Document: podkit

**Version:** 1.0
**Last Updated:** 2025-02-22
**Status:** Draft

## Executive Summary

podkit is a command-line tool and TypeScript library for synchronizing music collections to iPod devices. It addresses limitations in existing solutions by providing scriptable, automated sync with high-quality transcoding, proper metadata handling, and album artwork support.

## Problem Statement

### Current State

Users managing iPod devices (particularly classic/modded iPods) face these challenges:

1. **No scriptable sync** - Existing tools (Strawberry, gtkpod) require GUI interaction
2. **Poor duplicate detection** - Strawberry uses filename-only matching; transcoded files aren't matched to originals
3. **Metadata loss** - Transcoded files on iPod often lack embedded tags
4. **Quality control** - Limited control over transcoding quality settings
5. **No automation** - Cannot trigger sync on device connection

### Existing Solutions

| Tool | Pros | Cons |
|------|------|------|
| **Strawberry** | Full-featured GUI, artwork support | No CLI, filename-based dedup, GStreamer complexity |
| **gnupod** | CLI-based, Perl scripts | Unmaintained, doesn't use libgpod, limited codec support |
| **gtkpod** | Direct libgpod usage | GTK GUI only, no scripting |
| **iTunes** | Official Apple tool | Windows/old macOS only, no Linux |
| **Rockbox** | Open firmware | Requires firmware replacement, not compatible with all iPods |

### Why Now?

- Classic iPods remain popular for dedicated music players
- Modded iPods (SD card, large storage) need reliable sync tools
- Modern JavaScript/TypeScript tooling makes native bindings accessible
- libgpod is stable and well-documented

## Goals

### Primary Goals

1. **Reliable sync** - Correctly identify and transfer new music to iPod
2. **High-quality audio** - Produce excellent-sounding AAC files
3. **Metadata preservation** - Maintain all tags and artwork through sync
4. **Scriptability** - Full CLI support for automation
5. **Extensibility** - Support multiple collection sources via adapters

### Non-Goals (v1.0)

1. Fetching artwork from external services (MusicBrainz, Discogs)
2. Playlist management beyond basic sync
3. Play count / rating sync back to collection
4. Video or podcast sync
5. iOS device support (uses different protocols)
6. GUI interface

## User Stories

### Primary User: Music Enthusiast with Modded iPod

> As a user with a large FLAC collection and a modded iPod, I want to sync new music automatically when I plug in my iPod, so that my portable library stays current without manual intervention.

#### Acceptance Criteria
- CLI command syncs all new tracks
- Duplicate tracks are detected and skipped
- FLAC files are transcoded to high-quality AAC
- Album artwork is transferred
- Process completes without GUI interaction

### Secondary User: Audiophile with Quality Concerns

> As an audiophile, I want control over transcoding quality settings, so that I can balance file size against audio quality for my specific needs.

#### Acceptance Criteria
- Quality presets available (high/medium/low)
- Advanced users can specify exact encoder settings
- Documentation explains quality tradeoffs
- Default settings produce transparent audio quality

### Secondary User: Multi-Source Collector

> As a user with music in multiple applications (Strawberry, beets), I want to sync from any source, so that I'm not locked into one music manager.

#### Acceptance Criteria
- Adapter system supports multiple sources
- Strawberry adapter works in v1.0
- Clear documentation for adding adapters
- Consistent behavior across sources

### Developer User: Integration Builder

> As a developer, I want to use podkit as a library in my own tools, so that I can build custom sync workflows.

#### Acceptance Criteria
- Core functionality exposed as importable modules
- TypeScript types for all public APIs
- Documented programmatic usage
- Stable API surface

## Functional Requirements

### FR-1: Collection Source Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Support Strawberry SQLite database as collection source | P0 |
| FR-1.2 | Abstract collection interface for future sources | P0 |
| FR-1.3 | Support beets database as collection source | P1 |
| FR-1.4 | Support directory scanning as collection source | P1 |
| FR-1.5 | Filter tracks by artist, album, genre, date added | P1 |

### FR-2: iPod Device Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Detect mounted iPod devices | P0 |
| FR-2.2 | Read existing tracks from iPod database | P0 |
| FR-2.3 | Add new tracks to iPod database | P0 |
| FR-2.4 | Remove tracks from iPod database | P1 |
| FR-2.5 | Support multiple connected iPods | P2 |

### FR-3: Sync Engine

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Compare collection to iPod by artist/title/album | P0 |
| FR-3.2 | Identify tracks in collection but not on iPod | P0 |
| FR-3.3 | Identify tracks on iPod but not in collection | P1 |
| FR-3.4 | Dry-run mode showing planned changes | P0 |
| FR-3.5 | Progress reporting during sync | P0 |
| FR-3.6 | Resume interrupted sync | P2 |

### FR-4: Transcoding

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Transcode FLAC to AAC | P0 |
| FR-4.2 | Transcode other lossless formats (ALAC, WAV) | P1 |
| FR-4.3 | Pass through compatible formats (MP3, AAC) | P1 |
| FR-4.4 | Quality presets (high/medium/low) | P0 |
| FR-4.5 | Custom encoder settings | P1 |
| FR-4.6 | Preserve metadata during transcode | P0 |

### FR-5: Artwork

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | Extract embedded artwork from source files | P0 |
| FR-5.2 | Transfer artwork to iPod in correct format | P0 |
| FR-5.3 | Support external artwork files (cover.jpg) | P1 |
| FR-5.4 | Resize artwork to iPod-supported dimensions | P0 |

### FR-6: CLI Interface

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | `podkit sync` command | P0 |
| FR-6.2 | `podkit status` command (show iPod info) | P0 |
| FR-6.3 | `podkit list` command (show tracks) | P1 |
| FR-6.4 | `--dry-run` flag for all commands | P0 |
| FR-6.5 | `--verbose` flag for detailed output | P0 |
| FR-6.6 | JSON output mode for scripting | P1 |
| FR-6.7 | Configuration file support | P1 |

## Non-Functional Requirements

### NFR-1: Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1.1 | Sync 100 tracks | < 10 minutes |
| NFR-1.2 | Database comparison (10k tracks) | < 5 seconds |
| NFR-1.3 | Memory usage during sync | < 500 MB |

### NFR-2: Compatibility

| ID | Requirement |
|----|-------------|
| NFR-2.1 | Node.js 20+ runtime support |
| NFR-2.2 | Bun runtime support |
| NFR-2.3 | Debian 12+ (bookworm) support |
| NFR-2.4 | macOS 13+ support |
| NFR-2.5 | iPod Classic (5th-7th gen) support |
| NFR-2.6 | iPod Nano support |
| NFR-2.7 | iPod Mini support |

### NFR-3: Reliability

| ID | Requirement |
|----|-------------|
| NFR-3.1 | Graceful handling of disconnected iPod |
| NFR-3.2 | Atomic database writes (no corruption on failure) |
| NFR-3.3 | Validation of transcoded files before adding |

### NFR-4: Developer Experience

| ID | Requirement |
|----|-------------|
| NFR-4.1 | Full TypeScript type coverage |
| NFR-4.2 | Comprehensive API documentation |
| NFR-4.3 | Example code for common use cases |
| NFR-4.4 | Unit test coverage > 80% |

## Technical Constraints

### Must Use

- **libgpod** - De facto standard for iPod database management
- **FFmpeg** - Most capable and available transcoding tool
- **TypeScript** - Type safety and developer experience
- **Bun** - Development runtime (Node.js compatible for distribution)

### Platform Dependencies

| Dependency | Debian Package | macOS (Homebrew) |
|------------|---------------|------------------|
| libgpod | `libgpod-dev` | `libgpod` |
| FFmpeg | `ffmpeg` | `ffmpeg` |
| GLib | `libglib2.0-dev` | (included with libgpod) |

## Milestones

### Milestone 1: Foundation (v0.1.0)

- [ ] libgpod-node package with basic bindings
- [ ] Read iPod track list
- [ ] Write single track to iPod
- [ ] Basic CLI scaffold

### Milestone 2: Core Sync (v0.2.0)

- [ ] Strawberry collection adapter
- [ ] Collection/iPod diff engine
- [ ] FFmpeg transcoding integration
- [ ] `podkit sync --source strawberry`

### Milestone 3: Production Ready (v1.0.0)

- [ ] Album artwork support
- [ ] Quality presets
- [ ] Dry-run mode
- [ ] Progress reporting
- [ ] Error handling and recovery
- [ ] Documentation complete

### Milestone 4: Extended Sources (v1.1.0)

- [ ] beets adapter
- [ ] Directory scan adapter
- [ ] Filter/query support

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| libgpod binding complexity | Medium | High | Start with ffi-napi for quick validation; document all approaches |
| FFmpeg AAC quality variability | Low | Medium | Document encoder configuration; test on multiple systems |
| iPod model compatibility | Medium | Medium | Test with multiple iPod generations; use libgpod's device detection |
| Cross-platform build issues | Medium | Medium | CI testing on Linux + macOS; document build requirements |

## Success Metrics

| Metric | Target |
|--------|--------|
| Successful sync rate | > 99% |
| User-reported audio quality issues | < 1% of syncs |
| Time to sync 100 new tracks | < 10 minutes |
| CLI command success rate | > 99% |

## Open Questions

1. **Playlist sync** - Should v1.0 include playlist management, or defer to v1.1?
2. **Watch mode** - Should podkit support watching for iPod connection and auto-syncing?
3. **Multiple iPod profiles** - Should configuration support different settings per iPod?
4. **Sync direction** - Should we support syncing play counts/ratings back to collection?

## Appendices

### Appendix A: Glossary

| Term | Definition |
|------|------------|
| **libgpod** | C library for reading/writing iPod databases |
| **iTunesDB** | Binary database format used by iPod firmware |
| **Collection** | User's music library (local files with metadata) |
| **Adapter** | Plugin that reads from a specific collection source |
| **Transcoding** | Converting audio from one format to another |

### Appendix B: Related Documents

- [Architecture](ARCHITECTURE.md)
- [libgpod Research](LIBGPOD.md)
- [Transcoding Guide](TRANSCODING.md)
- [Collection Sources](COLLECTION-SOURCES.md)
- [iPod Internals](IPOD-INTERNALS.md)
