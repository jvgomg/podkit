# ADR-007: Subsonic Collection Source

## Status

**Proposed**

## Context

Users want to sync music from Navidrome (and other Subsonic-compatible servers) to their iPods. Currently, podkit only supports local filesystem directories as collection sources (ADR-004). Adding remote server support requires:

1. A new adapter implementation for the Subsonic API
2. Interface changes to support remote file access (streaming vs local paths)
3. Configuration for server credentials
4. Decisions about how to handle network-specific concerns (downloads, verification, errors)

### Why Subsonic API?

Navidrome implements the Subsonic API (v1.16.1), as do other servers like Airsonic, Gonic, and the original Subsonic. Targeting the standard Subsonic API provides compatibility across multiple server implementations.

## Decision Drivers

- **Compatibility**: Work with Navidrome, Airsonic, Gonic, and other Subsonic servers
- **Consistency**: Integrate cleanly with existing adapter pattern (ADR-004)
- **Simplicity**: MVP should focus on core sync functionality
- **Reliability**: Sync should fail cleanly rather than produce partial results
- **Extensibility**: Design should allow future enhancements (playlists, caching, multi-server)

## Options Considered

### Option A: Navidrome Native API Only

Use Navidrome's native REST API (`/api/*`) with JWT authentication.

**Pros:**
- Full Navidrome feature set
- Potentially better performance

**Cons:**
- Navidrome-only, excludes Airsonic/Gonic/Subsonic users
- Less documentation and community tooling

### Option B: Generic Subsonic API (Chosen)

Use the standard Subsonic API (`/rest/*`) which Navidrome implements.

**Pros:**
- Works with all Subsonic-compatible servers
- Well-documented API with existing TypeScript client (`subsonic-api` npm package)
- Large ecosystem of compatible clients validates the API

**Cons:**
- May miss some Navidrome-specific features
- API has some quirks (pagination limits, ID formats)

### Option C: Hybrid Approach

Use Subsonic API by default, with optional Navidrome-native enhancements.

**Pros:**
- Best of both worlds
- Future extensibility

**Cons:**
- More complexity
- Maintenance burden of two code paths

## Decision

**Option B: Generic Subsonic API**

Use the standard Subsonic API for maximum compatibility. The `subsonic-api` npm package provides a well-maintained TypeScript client that supports all required endpoints.

### Interface Changes

Extend `CollectionAdapter` interface to support remote file access:

```typescript
/**
 * Unified file access - supports both local and remote sources
 */
export type FileAccess =
  | { type: 'path'; path: string }
  | { type: 'stream'; getStream: () => Promise<ReadableStream>; size?: number };

export interface CollectionAdapter {
  // ... existing methods unchanged

  /**
   * Get file access for a track
   *
   * Local adapters return { type: 'path', path: '/absolute/path.flac' }
   * Remote adapters return { type: 'stream', getStream: () => ... }
   */
  getFileAccess(track: CollectionTrack): FileAccess | Promise<FileAccess>;

  // getFilePath() retained for backwards compatibility, throws for remote sources
  getFilePath(track: CollectionTrack): string;
}
```

The sync engine will be updated to handle both access types:
- For `path`: Use existing file-based transcoding/copying
- For `stream`: Pipe stream to transcoder or write to temp file

### CLI Source Detection

Source type determined by URL scheme:

```bash
# Local directory (existing behavior)
podkit sync --source ~/Music
podkit sync --source /Volumes/Media/music

# Subsonic server (new)
podkit sync --source subsonic://user@navidrome.local
podkit sync --source subsonic://user:pass@192.168.1.100:4533

# With environment variable for password
SUBSONIC_PASSWORD=secret podkit sync --source subsonic://user@server.local
```

### Configuration

Support both config file and environment variables:

```yaml
# ~/.config/podkit/config.yaml
sources:
  navidrome:
    type: subsonic
    url: https://music.example.com
    username: james
    # password can be in config or SUBSONIC_PASSWORD env var
```

Environment variables:
- `SUBSONIC_URL` - Server URL
- `SUBSONIC_USERNAME` - Username
- `SUBSONIC_PASSWORD` - Password (recommended over config file)

### Track Matching

Use existing matching strategy (ADR-004, `matching.ts`): normalized `(artist, title, album)` tuple. Subsonic API returns all required metadata fields.

### Error Handling

**Strict failure mode**: If any track download fails during sync, the entire sync operation fails. This ensures sync integrity - users get all tracks or a clear error, never a partial sync that might go unnoticed.

### File Verification

After downloading a track, verify the file size matches the server-reported size. This catches truncated downloads without the overhead of checksums.

### Scope

MVP scope (this ADR):
- Single Subsonic server per sync operation
- Track sync only (no playlists)
- Fresh catalog fetch each sync (no local caching)

Future enhancements (separate tasks):
- Playlist sync (read-only, then bidirectional)
- Local catalog caching for faster subsequent syncs
- Multiple server support (see TASK-062)
- Incremental sync (only fetch changed items)

## Implementation Plan

### Phase 1: Interface Extension

1. Add `FileAccess` type and `getFileAccess()` to `CollectionAdapter` interface
2. Update `DirectoryAdapter` to implement `getFileAccess()` returning `{ type: 'path' }`
3. Update sync engine to use `getFileAccess()` instead of `getFilePath()`
4. Add stream-to-file utility for transcoder input

### Phase 2: Subsonic Adapter

1. Add `subsonic-api` dependency
2. Implement `SubsonicAdapter` class
3. Implement catalog fetching (paginate through albums, extract tracks)
4. Implement `getFileAccess()` returning stream from `download` endpoint
5. Add size verification after download

### Phase 3: CLI Integration

1. Add URL scheme detection for `--source` argument
2. Add credential handling (config file + env vars)
3. Add connection validation on `connect()`
4. Update help text and documentation

### Phase 4: Testing

1. Unit tests with mocked Subsonic API responses
2. Integration tests against a local Navidrome instance (Docker)
3. E2E tests in `packages/e2e-tests` using test Navidrome server

## Consequences

### Positive

- Users can sync from Navidrome, Airsonic, Gonic, and other Subsonic servers
- Clean interface extension preserves existing local adapter functionality
- Strict error handling ensures sync reliability
- Generic Subsonic support maximizes compatibility

### Negative

- Network dependency introduces new failure modes (timeouts, connection drops)
- Large libraries will have slower initial catalog fetch (no caching in MVP)
- Single server limitation (multi-server deferred to TASK-062)

### Technical Debt

- `getFilePath()` becomes semi-deprecated; remote adapters must throw
- Sync engine gains complexity handling both path and stream access

## Related Decisions

- [ADR-004: Collection Source Abstraction](ADR-004-collection-sources.md) - Adapter pattern this extends
- [TASK-062: Multi-library workflows](../backlog/tasks/) - Future multi-server support

## References

- [Navidrome Subsonic API Compatibility](https://www.navidrome.org/docs/developers/subsonic-api/)
- [Subsonic API Documentation](https://www.subsonic.org/pages/api.jsp)
- [subsonic-api npm package](https://github.com/explodingcamera/subsonic-api)
- [OpenSubsonic](https://opensubsonic.netlify.app/docs/)
