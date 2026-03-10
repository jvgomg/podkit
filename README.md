# podkit

A TypeScript toolkit for syncing music collections to iPod devices.

## Overview

podkit is a CLI tool and library that synchronizes music from various collection sources (Strawberry, beets, local files) to iPod devices. It handles:

- **Collection diffing** - Determines what needs to be synced
- **Transcoding** - Converts FLAC/other formats to iPod-compatible AAC
- **Metadata management** - Preserves tags during sync
- **Album artwork** - Transfers embedded artwork to iPod
- **Duplicate detection** - Prevents re-syncing existing tracks

## Supported Devices

podkit supports iPod Classic, Video, Nano (1st-5th gen), Mini, and Shuffle (1st-2nd gen). iOS devices (iPod Touch, iPhone, iPad) are **not supported**.

**[View full device compatibility list](docs/SUPPORTED-DEVICES.md)**

## Project Structure

```
podkit/
├── packages/
│   ├── libgpod-node/     # Node.js bindings for libgpod
│   ├── podkit-core/      # Core sync logic and abstractions
│   └── podkit-cli/       # Command-line interface
├── docs/
│   ├── PRD.md            # Product Requirements Document
│   ├── ARCHITECTURE.md   # Technical architecture
│   ├── LIBGPOD.md        # libgpod research and API
│   ├── TRANSCODING.md    # FFmpeg AAC encoding guide
│   ├── COLLECTION-SOURCES.md
│   ├── IPOD-INTERNALS.md
│   └── adr/              # Architecture Decision Records
└── examples/
```

## Status

**Active development** - Core functionality is implemented. See [SUPPORTED-DEVICES.md](docs/SUPPORTED-DEVICES.md) for device compatibility.

## Documentation

| Document | Description |
|----------|-------------|
| [Supported Devices](docs/SUPPORTED-DEVICES.md) | iPod model compatibility and verification status |
| [PRD](docs/PRD.md) | Product requirements and user stories |
| [Architecture](docs/ARCHITECTURE.md) | Technical design and component overview |
| [libgpod Research](docs/LIBGPOD.md) | libgpod API, binding approaches |
| [Transcoding](docs/TRANSCODING.md) | FFmpeg AAC encoding configuration |
| [Collection Sources](docs/COLLECTION-SOURCES.md) | Strawberry, beets, file adapters |
| [iPod Internals](docs/IPOD-INTERNALS.md) | iTunesDB format, artwork, device quirks |
| [Device Testing](docs/DEVICE-TESTING.md) | How device compatibility is verified |

### Architecture Decision Records

See [docs/adr/README.md](docs/adr/README.md) for the full ADR index and workflow.

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](docs/adr/ADR-001-runtime.md) | Runtime Choice (Bun/Node) | Proposed |
| [ADR-002](docs/adr/ADR-002-libgpod-binding.md) | libgpod Binding Approach | Proposed |
| [ADR-003](docs/adr/ADR-003-transcoding.md) | Transcoding Backend | Proposed |
| [ADR-004](docs/adr/ADR-004-collection-sources.md) | Collection Source Abstraction | Proposed |

## Requirements

### Runtime
- [Bun](https://bun.sh/) (development)
- Node.js 20+ (production compatibility)

### System Dependencies
- libgpod (iPod database management)
- FFmpeg with AAC encoder (audio transcoding)
- GLib (libgpod dependency)

### Supported Platforms
- Linux (Debian/Ubuntu primary)
- macOS
- Windows (future consideration)

## Quick Start

> **Note:** Implementation not yet available. This shows intended usage.

```bash
# Install
npm install -g podkit

# Check iPod connection
podkit status

# Preview what would be synced
podkit sync --dry-run --source strawberry

# Sync with default settings (high quality AAC)
podkit sync --source strawberry

# Sync specific albums
podkit sync --source strawberry --filter "artist:CHVRCHES"
```

## Development

```bash
# Clone repository
git clone https://github.com/your-org/podkit
cd podkit

# Install dependencies
bun install

# Build all packages
bun run build

# Run tests
bun test
```

## Background

This project emerged from investigating limitations in existing iPod sync solutions:

- **Strawberry Music Player** - GUI-only sync, filename-based duplicate detection, transcoded files lose metadata tags
- **gnupod** - Perl scripts, unmaintained, separate implementation from libgpod
- **gtkpod** - GTK GUI, no CLI scripting support

podkit aims to provide a modern, scriptable solution using libgpod (the de facto standard library) with TypeScript for maintainability and extensibility.

## License

MIT

## Contributing

Development guidelines will be documented as the project matures. For now, see [docs/README.md](docs/README.md) for documentation structure and [AGENTS.md](AGENTS.md) for working in this codebase.
