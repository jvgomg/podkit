---
title: Roadmap
description: Planned features and what's coming next for podkit.
sidebar:
  order: 2
---

This is a living overview of where podkit is headed. Features move through stages as they're prioritised and developed.

I build podkit because I love using classic iPods and I think the software side of the experience deserves to be better. But I can't build the right things without hearing from the people who actually use it. **Your voice genuinely shapes what gets built and how it works.**

Even if your thought is just "I'd use this for..." or "I wish I could..." — that's incredibly valuable. Every use case helps me understand how a feature should actually behave, not just whether it should exist. So please don't hold back — jump into the [discussions](https://github.com/jvgomg/podkit/discussions/categories/ideas), share your story, and help make podkit better for everyone.

:::tip[Beta testers wanted]
podkit is brand new and I'm looking for enthusiastic iPod owners to help test it. You'll need an iPod you're willing to wipe — things might break during testing. Your feedback will directly shape how podkit works before it reaches a wider audience. If that sounds like fun, [join the discussion](https://github.com/jvgomg/podkit/discussions/22) and tell me about your setup.
:::

## Next

Features planned for upcoming development.

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Sync selection and filtering** | Fine-grained control over what gets synced — by genre, artist, playlist, or custom filters | [#16](https://github.com/jvgomg/podkit/discussions/16) |
| **npm distribution** | Install podkit via `npm install -g podkit` or `npx podkit` | [#20](https://github.com/jvgomg/podkit/discussions/20) |

Even features in **Next** benefit from your input. If you have thoughts on how any of these should work — what your ideal workflow looks like, what would make it click for you — please share them in the discussion thread.

## Later

These features are on the roadmap but not yet scheduled. Votes and comments help me understand what matters most and decide what to work on next.

### Content Types

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Podcast sync** | Sync podcast episodes with podcast-specific metadata and iPod features | [#2](https://github.com/jvgomg/podkit/discussions/2) |
| **Audiobook sync** | Sync audiobooks with chapter markers and bookmarks | [#3](https://github.com/jvgomg/podkit/discussions/3) |
| **Music video sync** | Sync music videos as a distinct content type with artist/album metadata | [#4](https://github.com/jvgomg/podkit/discussions/4) |
| **Video podcast sync** | Sync video podcasts with podcast-specific playback features | [#5](https://github.com/jvgomg/podkit/discussions/5) |

### Library Sync

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Playlist sync** | Sync playlists from local files (M3U) or media servers to iPod | [#23](https://github.com/jvgomg/podkit/discussions/23) |
| **Star rating sync** | Sync star ratings between your collection and iPod | [#24](https://github.com/jvgomg/podkit/discussions/24) |
| **Play count and scrobble sync** | Sync play counts back from iPod, scrobble to Last.fm or ListenBrainz | [#25](https://github.com/jvgomg/podkit/discussions/25) |
| **Sound Check (volume normalization)** | Read ReplayGain tags from source files and set iPod Sound Check values during sync | [#32](https://github.com/jvgomg/podkit/discussions/32) |

### Collection Sources

| Feature | Description | Discussion |
|---------|-------------|------------|
| **iTunes / Apple Music** | Sync music from an iTunes or Apple Music library | [#35](https://github.com/jvgomg/podkit/discussions/35) |
| **Plex** | Sync music from Plex media servers | [#6](https://github.com/jvgomg/podkit/discussions/6) |
| **Jellyfin** | Sync music from Jellyfin media servers | [#7](https://github.com/jvgomg/podkit/discussions/7) |
| **Lyrion Music Server** | Sync music from Lyrion (formerly Logitech Media Server) via its JSON-RPC API | [#53](https://github.com/jvgomg/podkit/discussions/53) |

### Platform Support

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Windows** | Full Windows platform support | [#8](https://github.com/jvgomg/podkit/discussions/8) |

### Device Support

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Rockbox and non-iTunesDB devices** | Folder-based sync mode for Rockbox firmware and standalone DAPs | [#34](https://github.com/jvgomg/podkit/discussions/34) |

### Device Management

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Device formatting** | Format iPod devices directly from podkit | [#10](https://github.com/jvgomg/podkit/discussions/10) |

### Security

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Keychain/secret manager** | Secure password storage via OS keychain or secret managers | [#11](https://github.com/jvgomg/podkit/discussions/11) |

### Onboarding

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Configuration wizard** | Interactive guided setup for first-time users | [#21](https://github.com/jvgomg/podkit/discussions/21) |

### Interfaces

| Feature | Description | Discussion |
|---------|-------------|------------|
| **TUI** | Interactive terminal UI for browsing collections and managing devices | [#13](https://github.com/jvgomg/podkit/discussions/13) |
| **Desktop app** | Graphical desktop application | [#14](https://github.com/jvgomg/podkit/discussions/14) |

## Shipped

Features that have been completed and released.

| Feature | Description | Discussion |
|---------|-------------|------------|
| **Daemon mode** | Background service that auto-syncs when an iPod is connected, with notifications via Apprise | [#15](https://github.com/jvgomg/podkit/discussions/15) |
| **Docker distribution** | Official Docker image (`ghcr.io/jvgomg/podkit`) for linux/amd64 and linux/arm64, with musl release binaries | [#12](https://github.com/jvgomg/podkit/discussions/12) |
| **Linux mount/eject** | Native mount and eject commands for Linux (Debian, Ubuntu, Alpine, and more) | [#9](https://github.com/jvgomg/podkit/discussions/9) |
| **Homebrew distribution** | Install podkit via `brew install jvgomg/podkit/podkit` with automatic dependency management | [#19](https://github.com/jvgomg/podkit/discussions/19) |

## Help Shape podkit

This project is built in the open and your input directly influences what gets built next. Here's how you can help:

- **Share your use case** — Tell me how you use your iPod, what your setup looks like, what annoys you. Even small anecdotes help me understand what to build and how it should work. [Join a discussion](https://github.com/jvgomg/podkit/discussions/categories/ideas) and share your story.
- **Vote** — Upvote the features you'd actually use. It helps me see what the community cares about most.
- **Propose something new** — Have an idea that's not listed? [Start a discussion](https://github.com/jvgomg/podkit/discussions/new?category=ideas). There's no wrong way to suggest something.
- **Report bugs** — Found something broken? [Open an issue](https://github.com/jvgomg/podkit/issues). It helps me keep things solid.
