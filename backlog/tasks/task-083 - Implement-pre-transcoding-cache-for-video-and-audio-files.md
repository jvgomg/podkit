---
id: TASK-083
title: Implement pre-transcoding cache for video and audio files
status: To Do
assignee: []
created_date: '2026-03-09 23:07'
labels:
  - enhancement
  - transcoding
  - video
  - cache
  - ux
dependencies: []
references:
  - docs/TRANSCODING.md
  - docs/VIDEO-TRANSCODING.md
  - packages/podkit-core/src/diff/
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Transcoding video files during sync takes a long time, requiring the iPod to stay connected for the entire duration. If the sync is interrupted, transcoding must restart from scratch.

## Proposed Solution

Implement a pre-transcoding cache system that allows users to transcode files ahead of time before connecting their iPod. The system should:

1. **Manual trigger**: `podkit prepare` command
2. **User-configured cache location**: Configurable storage directory for transcoded files
3. **Smart targeting**: Based on last sync state to determine what files to prepare
4. **Portable design**: Works for both video (FLAC→AAC) and music (various→M4V)

## Architecture Overview

### Core Components

**Transcoding Cache Service**
- Hash-based cache keys (detect source file changes)
- Metadata tracking (source path, hash, transcode options, timestamp)
- Invalidation on source changes
- User-configured storage location

**Sync State Persistence**
- Track what files were synced per device
- Store in `~/.podkit/state/` or similar
- Use to determine what to prepare for next sync

**`podkit prepare` Command**
```bash
podkit prepare --device /Volumes/iPod        # Based on last sync
podkit prepare --source ~/Videos             # Explicit source
podkit prepare --force                       # Re-transcode everything
```

**Modified Sync Workflow**
- Check cache before transcoding (hash-based lookup)
- Use cached file if valid
- Fall back to fresh transcode on cache miss
- Report cache hit rate in progress

### Implementation Phases

1. **Cache Infrastructure** - Storage abstraction, hash-based keys, metadata tracking
2. **State Persistence** - Track and persist sync state per device
3. **Prepare Command** - CLI command to populate cache
4. **Sync Integration** - Use cache during sync, report statistics

### Portability Considerations

The cache should work generically for any transcode operation:
```typescript
interface CacheKey {
  sourceHash: string;
  targetFormat: string;
  transcodeOptions: object;  // Encoder settings
}
```

This allows the same infrastructure to work for:
- Video: FLAC → AAC, MP3 → AAC, etc.
- Audio: various video formats → M4V

## Open Questions

- Cache eviction policy (LRU, max size, max age)?
- Should prepare show progress/ETA like sync does?
- Handle multiple devices with different transcode requirements?
- Parallel transcoding during prepare (utilize multiple cores)?

## Related

- See `docs/TRANSCODING.md` for audio transcoding
- See `docs/VIDEO-TRANSCODING.md` for video transcoding
- Sync diffing logic in `packages/podkit-core/src/diff/`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User can run `podkit prepare` to transcode files before device is connected
- [ ] #2 Cache uses hash-based keys to detect source file changes
- [ ] #3 Cache is stored in user-configured location
- [ ] #4 Prepare command determines files to transcode based on last sync state
- [ ] #5 During sync, system checks cache before transcoding
- [ ] #6 Cache hit rate is reported in sync progress
- [ ] #7 Cache system works for both audio and video transcoding
- [ ] #8 Stale cache entries (source changed) are detected and invalidated
- [ ] #9 User can manage cache (view status, clear, prune old entries)
<!-- AC:END -->
