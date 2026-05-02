---
id: TASK-070.04
title: Implement SubsonicAdapter
status: Done
assignee: []
created_date: '2026-03-08 16:16'
updated_date: '2026-03-09 20:09'
labels:
  - core
  - adapter
  - subsonic
dependencies:
  - TASK-070.01
parent_task_id: TASK-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Implement the core SubsonicAdapter that fetches tracks from Subsonic-compatible servers and provides stream-based file access.

## Implementation

### 1. Add Dependency

```bash
bun add subsonic-api
```

### 2. Create Adapter

Create `packages/podkit-core/src/adapters/subsonic.ts`:

```typescript
import { SubsonicAPI } from 'subsonic-api';
import type { CollectionAdapter, CollectionTrack, FileAccess } from './interface.js';
import type { TrackFilter } from '../types.js';

export interface SubsonicAdapterConfig {
  url: string;
  username: string;
  password: string;
}

export class SubsonicAdapter implements CollectionAdapter {
  readonly name = 'subsonic';
  private api: SubsonicAPI;
  private tracks: CollectionTrack[] | null = null;

  constructor(private config: SubsonicAdapterConfig) {
    this.api = new SubsonicAPI({
      url: config.url,
      auth: {
        username: config.username,
        password: config.password,
      },
    });
  }

  async connect(): Promise<void> {
    // Validate connection
    await this.api.ping();
  }

  async getTracks(): Promise<CollectionTrack[]> {
    if (this.tracks) return this.tracks;
    
    this.tracks = [];
    let offset = 0;
    const pageSize = 500;
    
    while (true) {
      const { albumList2 } = await this.api.getAlbumList2({
        type: 'alphabeticalByName',
        size: pageSize,
        offset,
      });
      
      if (!albumList2?.album?.length) break;
      
      for (const album of albumList2.album) {
        const { album: fullAlbum } = await this.api.getAlbum({ id: album.id });
        if (fullAlbum?.song) {
          for (const song of fullAlbum.song) {
            this.tracks.push(this.mapSongToTrack(song));
          }
        }
      }
      
      offset += pageSize;
      if (albumList2.album.length < pageSize) break;
    }
    
    return this.tracks;
  }

  async getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]> {
    const tracks = await this.getTracks();
    // Apply in-memory filtering (same as DirectoryAdapter)
    return this.applyFilter(tracks, filter);
  }

  getFilePath(_track: CollectionTrack): string {
    throw new Error('SubsonicAdapter does not support direct file paths. Use getFileAccess().');
  }

  getFileAccess(track: CollectionTrack): FileAccess {
    return {
      type: 'stream',
      getStream: async () => {
        const response = await this.api.download({ id: track.id });
        return response.body as ReadableStream;
      },
      size: track.sourceData?.size as number | undefined,
    };
  }

  async disconnect(): Promise<void> {
    this.tracks = null;
  }

  private mapSongToTrack(song: SubsonicSong): CollectionTrack {
    // Map Subsonic song fields to CollectionTrack
    // Handle codec detection from suffix/contentType
  }
}
```

### 3. Export from Index

Update `packages/podkit-core/src/adapters/index.ts`.

## Key Considerations

- Subsonic IDs are strings (MD5/UUID) - store in `track.id`
- Duration in Subsonic is seconds - convert to milliseconds
- Detect lossless from `suffix` (flac, wav) or `contentType`
- Store `size` in `sourceData` for verification

## Files to Create/Modify

- `packages/podkit-core/src/adapters/subsonic.ts` (new)
- `packages/podkit-core/src/adapters/index.ts` (export)
- `package.json` (add subsonic-api dependency)

## Testing

Covered by separate test subtasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SubsonicAdapter class implemented
- [x] #2 connect() validates server connection via ping
- [x] #3 getTracks() paginates through all albums and extracts songs
- [x] #4 getFileAccess() returns stream from download endpoint
- [x] #5 Metadata correctly mapped (duration in ms, lossless detection)
- [x] #6 Exported from podkit-core
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Note:** Implementation details above are suggestions. Developers may choose different approaches as long as acceptance criteria are met.

This task can be developed in parallel with TASK-070.03 once the interface (070.01) is complete.
<!-- SECTION:NOTES:END -->
