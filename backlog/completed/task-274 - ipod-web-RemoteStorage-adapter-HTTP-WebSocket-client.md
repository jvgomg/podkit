---
id: TASK-274
title: 'ipod-web: RemoteStorage adapter (HTTP/WebSocket client)'
status: Done
assignee: []
created_date: '2026-04-03 20:18'
updated_date: '2026-04-03 21:02'
labels:
  - ipod-web
  - storage
  - networking
milestone: m-17
dependencies:
  - TASK-266
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the `RemoteStorage` class that connects ipod-web to the virtual-ipod-server running in the Lima VM.

**Implements `StorageProvider` interface:**

```typescript
class RemoteStorage implements StorageProvider {
  constructor(baseUrl: string)  // e.g. "http://localhost:3456"
  
  async loadDatabase(): Promise<IpodReader>
  // GET /database → receives iTunesDB + ArtworkDB + SysInfo binary data
  // Passes to IpodReader.fromFiles()
  
  async getAudioUrl(ipodPath: string): Promise<string>
  // Returns: `${baseUrl}/audio/${encodeURIComponent(ipodPath)}`
  // Browser's <audio> element fetches directly with range request support
  
  connected: boolean
  // Tracks WebSocket connection state
  
  onConnectionChange(cb: (connected: boolean) => void): () => void
  // Returns unsubscribe function
  
  async reload(): Promise<IpodReader>
  // Same as loadDatabase() — re-fetches after podkit sync
}
```

**WebSocket connection:**
- Connects to `ws://${baseUrl}/events` on construction
- Listens for events: `plugged`, `unplugged`, `database-changed`
- On `database-changed`: triggers `reload()` and notifies subscribers
- On `plugged`/`unplugged`: updates `connected` state, notifies subscribers
- Auto-reconnect with exponential backoff on disconnect

**Database transfer format:**
- Server sends iTunesDB, ArtworkDB, SysInfo, and ithmb files
- Options: multipart response, zip archive, or separate fetches
- Choose simplest approach — separate fetches for each file is fine for v1
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 loadDatabase fetches and parses iTunesDB from server
- [x] #2 getAudioUrl returns correct URL for audio streaming
- [x] #3 WebSocket connects and receives plug/unplug/database-changed events
- [x] #4 Auto-reconnect on WebSocket disconnect
- [x] #5 reload() re-fetches database after sync notification
- [x] #6 connected property reflects current state
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full RemoteStorage: loadDatabase fetches iTunesDB/ArtworkDB/SysInfo in parallel via Promise.allSettled, constructs IpodReader. getAudioUrl returns direct URL for browser audio. WebSocket with exponential backoff (1s→30s cap), handles plugged/unplugged/database-changed events. destroy() prevents reconnect cycle. 17 tests.
<!-- SECTION:NOTES:END -->
