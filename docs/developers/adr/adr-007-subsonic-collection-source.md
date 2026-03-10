---
title: "ADR-007: Subsonic Collection Source"
description: Decision to use standard Subsonic API for server-based music collection sources.
sidebar:
  order: 8
---

# ADR-007: Subsonic Collection Source

## Status

**Accepted**

## Context

Users want to sync music from Navidrome (and other Subsonic-compatible servers) to their iPods. This requires a new adapter for the Subsonic API and interface changes to support remote file access.

### Why Subsonic API?

Navidrome implements the Subsonic API (v1.16.1), as do other servers like Airsonic, Gonic, and the original Subsonic. Targeting the standard API provides compatibility across multiple server implementations.

## Decision Drivers

- **Compatibility**: Work with Navidrome, Airsonic, Gonic, and other Subsonic servers
- **Consistency**: Integrate cleanly with existing adapter pattern (ADR-004)
- **Simplicity**: MVP should focus on core sync functionality
- **Reliability**: Sync should fail cleanly rather than produce partial results

## Decision

**Generic Subsonic API**

Use the standard Subsonic API (`/rest/*`) for maximum compatibility.

### Interface Changes

Extend `CollectionAdapter` to support remote file access:

```typescript
export type FileAccess =
  | { type: 'path'; path: string }
  | { type: 'stream'; getStream: () => Promise<ReadableStream>; size?: number };

export interface CollectionAdapter {
  getFileAccess(track: CollectionTrack): FileAccess | Promise<FileAccess>;
  // ... existing methods
}
```

### Configuration

```toml
[music.navidrome]
type = "subsonic"
url = "https://music.example.com"
username = "james"
# password via PODKIT_MUSIC_NAVIDROME_PASSWORD env var
```

### Error Handling

**Strict failure mode**: If any track download fails during sync, the entire sync fails. This ensures users get all tracks or a clear error.

### Scope

MVP scope:
- Single Subsonic server per sync operation
- Track sync only (no playlists)
- Fresh catalog fetch each sync

Future enhancements:
- Playlist sync
- Local catalog caching
- Multiple server support

## Consequences

### Positive

- Users can sync from Navidrome, Airsonic, Gonic, and other Subsonic servers
- Clean interface extension preserves existing functionality
- Generic Subsonic support maximizes compatibility

### Negative

- Network dependency introduces new failure modes
- Large libraries will have slower initial catalog fetch

## Related Decisions

- [ADR-004](/developers/adr/adr-004-collection-sources): Collection Source Abstraction
- [ADR-008](/developers/adr/adr-008-multi-collection-device-config): Multi-Collection Configuration

## References

- [Navidrome Subsonic API Compatibility](https://www.navidrome.org/docs/developers/subsonic-api/)
- [Subsonic API Documentation](https://www.subsonic.org/pages/api.jsp)
