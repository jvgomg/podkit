---
title: Additional Sources
description: Planned media sources and how to request or build your own.
sidebar:
  order: 4
---

podkit currently supports [directory](/user-guide/collections/directory) and [Subsonic](/user-guide/collections/subsonic) media sources. Additional sources are planned for the future.

## Planned Sources

### iTunes / Apple Music

Support for using an [iTunes or Apple Music](https://www.apple.com/apple-music/) library as a collection source is planned. This would read your existing library database to discover tracks, metadata, playlists, and artwork — no need to restructure your files or set up a media server. Vote or comment on the [discussion](https://github.com/jvgomg/podkit/discussions/35).

### Plex

Support for syncing music from [Plex](https://www.plex.tv/) media servers is planned. This would allow you to sync your Plex music library directly to your iPod without needing local files. Vote or comment on the [discussion](https://github.com/jvgomg/podkit/discussions/6).

### Jellyfin

Support for [Jellyfin](https://jellyfin.org/) media servers is also planned. Like the Subsonic source, this would stream and cache tracks from your Jellyfin server for syncing. Vote or comment on the [discussion](https://github.com/jvgomg/podkit/discussions/7).

### Lyrion Music Server

Support for [Lyrion Music Server](https://lyrion.org/) (formerly Logitech Media Server / Squeezebox Server) is planned. Lyrion's JSON-RPC API provides full library enumeration, rich metadata, artwork, and original-quality audio file downloads. Vote or comment on the [discussion](https://github.com/jvgomg/podkit/discussions/53).

## Request a Source

If there's a music source you'd like to see supported, [start a discussion on GitHub](https://github.com/jvgomg/podkit/discussions/new?category=ideas) describing the source and your use case. You can also vote on planned sources: [iTunes / Apple Music](https://github.com/jvgomg/podkit/discussions/35), [Plex](https://github.com/jvgomg/podkit/discussions/6), [Jellyfin](https://github.com/jvgomg/podkit/discussions/7), [Lyrion](https://github.com/jvgomg/podkit/discussions/53).

## Build Your Own

podkit's media source system uses an adapter pattern that makes it possible to add new sources. If you're interested in building a source adapter, see the [Developer Guide](/developers/architecture) for an overview of the adapter interface and how media sources work.

## See Also

- [Directory Source](/user-guide/collections/directory) - Local directory source
- [Subsonic Source](/user-guide/collections/subsonic) - Subsonic/Navidrome server source
