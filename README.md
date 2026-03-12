# podkit

Modern sync for classic iPods.

**[Documentation](https://jvgomg.github.io/podkit)** | **[Getting Started](https://jvgomg.github.io/podkit/getting-started/installation)** | **[Roadmap](https://jvgomg.github.io/podkit/roadmap)**

---

If you're rocking an old-school iPod on stock firmware and wondering why syncing music to it is still so painful — podkit is for you. No more booting into Windows for iTunes, no more duplicated tracks, no more artwork that refuses to show up. Just point podkit at your music collection, run `podkit sync`, and walk away.

> **Beta software** — podkit is in early development and things may break. Only use it with an iPod you're willing to wipe. If you're up for that, I'd love your help — [join as a beta tester](https://github.com/jvgomg/podkit/discussions/22) and help shape the project.

<!-- TODO: Add terminal recording / GIF / screenshot of a sync in action here -->

## Features

- **One command, zero thinking** — Run `podkit sync` and your iPod is up to date. No GUI, no clicking, no babysitting
- **Incremental sync** — only new, changed, or removed tracks are touched. Re-syncing a large library after tweaking tags takes seconds
- **Automatic transcoding** — FLAC and lossless files converted to AAC on the fly. Lossy files that are already iPod-compatible are copied directly — nothing is re-encoded unnecessarily
- **Full metadata and artwork** — All tags and album artwork preserved through transcoding
- **Clean artist lists** — iPods don't respect album artist tags, so "Artist feat. X" splits across dozens of entries. podkit automatically cleans this up on sync — your source files stay untouched
- **Multiple sources** — Sync from local directories or Subsonic-compatible servers like [Navidrome](https://www.navidrome.org/)
- **Video support** — Sync movies and TV shows to video-capable iPods
- **Non-destructive** — Your music collection is never modified. Transforms, transcoding, and format conversion only affect what lands on the iPod
- **Scriptable** — CLI-first design for automation with cron, scripts, and pipelines

## Supported Devices

iPod Classic, Video, Nano (1st–5th gen), Mini, and Shuffle (1st–2nd gen). Stock firmware, no Rockbox required. Modded iPods with iFlash SD adapters work too.

iOS devices (iPod Touch, iPhone, iPad) are **not supported**.

See [Device Compatibility](https://jvgomg.github.io/podkit/devices/supported-devices) for the full list.

## Install

```bash
brew install jvgomg/podkit/podkit
```

This installs podkit and its only runtime dependency (FFmpeg) in a single command. All native dependencies are bundled — nothing else to install.

Other install methods (manual download, building from source) are covered in the [Installation guide](https://jvgomg.github.io/podkit/getting-started/installation).

Platform support: **macOS** and **Linux**. Windows is [on the roadmap](https://github.com/jvgomg/podkit/discussions/8).

## Quick Start

```bash
# Create config file
podkit init

# Add your music collection
podkit collection add music main ~/Music/library

# Connect iPod and register it
podkit device add myipod

# Preview what would be synced
podkit sync --dry-run

# Sync your music
podkit sync

# Safely eject
podkit device eject
```

See the [Quick Start guide](https://jvgomg.github.io/podkit/getting-started/quick-start) for a full walkthrough.

## Why podkit?

The software for syncing iPods hasn't kept up. iTunes is gone on Mac, gtkpod is abandoned, and the tools that remain are clunky, GUI-only, or broken in subtle ways. Under the hood, most of them depend on [libgpod](https://sourceforge.net/projects/gtkpod/files/libgpod/) — a C library last updated in 2015. It still works, but nobody has built a modern tool on top of it. Until now.

podkit wraps libgpod in [native Node.js bindings](https://jvgomg.github.io/podkit/developers/libgpod) and layers on everything that's been missing: incremental sync, automatic transcoding, metadata preservation, and a CLI-first workflow that's easy to script and automate. The goal is to be the go-to project for syncing music to iPod devices.

It's also more than a CLI. podkit is structured as a [core library](https://jvgomg.github.io/podkit/developers/architecture) that other developers can build on — a TUI, a desktop app, or something entirely different. The CLI is just the first interface.

Read the [full story](https://jvgomg.github.io/podkit/about).

## Get Involved

podkit is a one-person project and community input directly shapes what gets built. Here's how you can help:

- **[Become a beta tester](https://github.com/jvgomg/podkit/discussions/22)** — Try podkit on your iPod and share your experience
- **[Vote on features](https://github.com/jvgomg/podkit/discussions/categories/ideas)** — The [roadmap](https://jvgomg.github.io/podkit/roadmap) is driven by what the community cares about
- **[Report bugs](https://github.com/jvgomg/podkit/issues)** — Found something broken? Let me know
- **[Say hello](https://github.com/jvgomg/podkit/discussions)** — Share your iPod setup, your use case, or just introduce yourself

## Documentation

Full documentation at **[jvgomg.github.io/podkit](https://jvgomg.github.io/podkit)**:

- [Getting Started](https://jvgomg.github.io/podkit/getting-started/installation) — Installation and first sync
- [User Guide](https://jvgomg.github.io/podkit/user-guide/configuration) — Configuration, sources, transcoding
- [CLI Reference](https://jvgomg.github.io/podkit/reference/cli-commands) — All commands and options
- [Developer Guide](https://jvgomg.github.io/podkit/developers/architecture) — Architecture and contributing

## Development

```bash
git clone https://github.com/jvgomg/podkit
cd podkit
bun install
bun run build
bun run test
```

See [Development Setup](https://jvgomg.github.io/podkit/developers/development) and [Contributing](https://jvgomg.github.io/podkit/developers/contributing) for details.

## License

MIT
