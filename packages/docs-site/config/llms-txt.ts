import type { StarlightLllmsTextOptions } from 'starlight-llms-txt/types';

export const llmsTxtConfig = {
  description: `podkit is a TypeScript CLI for syncing music and video collections to classic iPod devices. It handles automatic transcoding (FLAC to AAC, MKV to M4V), full metadata preservation, album artwork, intelligent duplicate detection, and incremental syncs. It works with all classic iPod models including iFlash-modded devices.

**Status:** podkit is in early development (beta). Users should only use it with an iPod they are willing to wipe, as database corruption is possible.

**Supported devices:** iPod Classic (all generations), iPod Video (5th/5.5th gen), iPod Nano (1st-5th gen), iPod Mini (1st-2nd gen), iPod Shuffle (1st-2nd gen). iOS devices (iPod Touch, iPhone, iPad) are NOT supported.

**Platforms:** macOS and Linux. Windows is not yet supported.`,
  details: `**Install (macOS):**
\`\`\`bash
brew install jvgomg/podkit/podkit
\`\`\`

Manual download and Docker are also available — see the Setup Guide documentation set for details.

**Quick workflow:**
\`\`\`bash
podkit init                                            # Create config file
podkit collection add -t music -c main --path ~/Music  # Add music source
podkit device add -d myipod                            # Register connected iPod
podkit sync --dry-run                                  # Preview changes
podkit sync                                            # Sync to iPod
podkit device eject                                    # Safely eject
\`\`\`

**Key concepts:**
- **Collections** are named music or video sources. Each points to a local directory or a Subsonic-compatible server (Navidrome, Airsonic, Gonic). Define multiple and sync independently with \`-c <name>\`.
- **Devices** are named iPods in your config. Each can have independent quality and artwork settings. Auto-detected via \`podkit device add\`.
- **Quality presets**: \`max\` (lossless ALAC on supported devices), \`high\` (~256 kbps AAC, default), \`medium\` (~192 kbps), \`low\` (~128 kbps). Set globally, per device, or per sync via \`--quality\`.
- **Transcoding** is automatic — lossless files (FLAC, WAV) are transcoded to AAC; compatible lossy files (MP3, AAC) are copied as-is.
- **Clean Artists** moves "Artist feat. X" credits from Artist to Title field for cleaner iPod browsing. Enable with \`cleanArtists = true\` in config.
- **Incremental sync** — only new, changed, or removed tracks are touched. Re-syncing a large library takes seconds.
- **Configuration** is a TOML file at \`~/.config/podkit/config.toml\`. Generate with \`podkit init\`. Override with \`--config <path>\` or \`PODKIT_CONFIG\` env var.
- **Docker** is available at \`ghcr.io/jvgomg/podkit:latest\` for linux/amd64 and linux/arm64. Supports env-var-only config (no TOML file needed) and a daemon mode for automatic sync on iPod plug-in.

**Common commands:**
- \`podkit sync\` — sync default collection to default device
- \`podkit sync -t music -c main -d myipod\` — sync specific collection to specific device
- \`podkit sync --delete\` — remove tracks not in source
- \`podkit sync --eject\` — eject after sync
- \`podkit device info\` — show device status and storage
- \`podkit device scan\` — discover connected iPods
- \`podkit device music\` — list music on iPod
- \`podkit collection list\` — list configured collections

**Minimal config example:**
\`\`\`toml
version = 2

[music.main]
path = "/path/to/your/music"

[devices.myipod]
volumeUuid = "ABC-123"
volumeName = "IPOD"

[defaults]
device = "myipod"
music = "main"
\`\`\`

When helping users, load the appropriate documentation set below for detailed information. The "Setup Guide" covers installation and configuration. The "Docker & NAS Guide" covers containerised deployments. The "Syncing & Devices" set covers device management, quality tuning, and troubleshooting.`,
  customSets: [
    {
      label: 'Setup Guide',
      paths: [
        'getting-started/**',
        'user-guide/configuration*',
        'user-guide/collections/**',
        'reference/config-file*',
        'reference/environment-variables*',
        'reference/cli-commands*',
      ],
      description:
        'Installation, first sync, configuration, collections, and CLI reference. Load this when helping a user install podkit, set up collections, or configure their first sync.',
    },
    {
      label: 'Docker & NAS Guide',
      paths: [
        'getting-started/docker*',
        'getting-started/docker-daemon*',
        'reference/environment-variables*',
        'reference/config-file*',
        'troubleshooting/common-issues*',
      ],
      description:
        'Docker image setup, Docker Compose, daemon mode, Synology NAS instructions, Proxmox, environment variable configuration, and troubleshooting. Load this when helping a user run podkit in Docker or on a NAS.',
    },
    {
      label: 'Syncing & Devices',
      paths: [
        'user-guide/syncing/**',
        'user-guide/devices/**',
        'user-guide/transcoding/**',
        'reference/quality-presets*',
        'reference/clean-artists*',
        'reference/show-language*',
        'reference/sync-tags*',
        'devices/**',
        'troubleshooting/**',
      ],
      description:
        'Device management, syncing workflows, transcoding, quality presets, artwork, troubleshooting, and iPod compatibility. Load this when helping with sync issues, device problems, quality settings, or troubleshooting.',
    },
    {
      label: 'Developer Guide',
      paths: ['developers/**'],
      description:
        'Architecture, development setup, testing, libgpod bindings, and contributing. Load this when helping someone contribute to podkit or understand its internals.',
    },
  ],
  optionalLinks: [
    {
      label: 'GitHub Repository',
      url: 'https://github.com/jvgomg/podkit',
      description: 'Source code, issues, and discussions',
    },
    {
      label: 'Supported Devices',
      url: 'https://jvgomg.github.io/podkit/devices/supported-devices',
      description: 'Full iPod model compatibility matrix with generation details',
    },
    {
      label: 'Quality Presets',
      url: 'https://jvgomg.github.io/podkit/reference/quality-presets',
      description: 'Detailed audio and video quality preset specifications and encoder settings',
    },
    {
      label: 'Roadmap',
      url: 'https://jvgomg.github.io/podkit/project/roadmap',
      description: 'Planned features and development priorities',
    },
  ],
  promote: ['index*', 'getting-started/**', 'user-guide/configuration*'],
  demote: ['developers/**', 'project/**'],
  exclude: ['developers/**', 'project/**', 'reference/changelog*'],
} satisfies StarlightLllmsTextOptions;
