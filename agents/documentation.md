# Documentation

Guidance for maintaining and creating documentation. See [AGENTS.md](../AGENTS.md) for project overview.

## Documentation Map

Read these documents based on what you're working on:

| Topic | Document |
|-------|----------|
| First time in repo | [docs/index.md](../docs/index.md) |
| User install and first sync | [docs/getting-started/](../docs/getting-started/) |
| Configuration concepts | [docs/user-guide/configuration.md](../docs/user-guide/configuration.md) |
| Config file reference | [docs/reference/config-file.md](../docs/reference/config-file.md) |
| Environment variables | [docs/reference/environment-variables.md](../docs/reference/environment-variables.md) |
| iPod model compatibility | [docs/devices/supported-devices.md](../docs/devices/supported-devices.md) |
| Architecture and design | [docs/developers/architecture.md](../docs/developers/architecture.md) |
| Development environment | [docs/developers/development.md](../docs/developers/development.md) |
| Testing strategy | [docs/developers/testing.md](../docs/developers/testing.md) |
| ADRs | [adr/](../adr/) |
| Contributing | [docs/developers/contributing.md](../docs/developers/contributing.md) |
| libgpod integration | [docs/developers/libgpod.md](../docs/developers/libgpod.md) |
| Device management | [docs/user-guide/devices/](../docs/user-guide/devices/) |
| Transcoding (audio) | [docs/user-guide/transcoding/audio.md](../docs/user-guide/transcoding/audio.md) |
| Codec preferences | [docs/user-guide/transcoding/codec-preferences.md](../docs/user-guide/transcoding/codec-preferences.md) |
| Transcoding (video) | [docs/user-guide/transcoding/video.md](../docs/user-guide/transcoding/video.md) |
| Directory source | [docs/user-guide/directory-source.md](../docs/user-guide/directory-source.md) |
| Subsonic source | [docs/user-guide/subsonic-source.md](../docs/user-guide/subsonic-source.md) |
| iPod internals | [docs/devices/ipod-internals.md](../docs/devices/ipod-internals.md) |
| Troubleshooting | [docs/troubleshooting/](../docs/troubleshooting/) |
| iPod health checks (doctor) | [docs/user-guide/devices/doctor.md](../docs/user-guide/devices/doctor.md) |
| Compilation albums | [docs/user-guide/syncing/compilation-albums.md](../docs/user-guide/syncing/compilation-albums.md) |
| Artwork | [docs/user-guide/syncing/artwork.md](../docs/user-guide/syncing/artwork.md) |
| Sound Check | [docs/user-guide/syncing/sound-check.md](../docs/user-guide/syncing/sound-check.md) |
| Track upgrades | [docs/user-guide/syncing/upgrades.md](../docs/user-guide/syncing/upgrades.md) |
| Clean Artists | [docs/reference/clean-artists.md](../docs/reference/clean-artists.md) |
| Show Language (video) | [docs/reference/show-language.md](../docs/reference/show-language.md) |
| Sync tags | [docs/reference/sync-tags.md](../docs/reference/sync-tags.md) |
| Demo GIF package | [packages/demo/README.md](../packages/demo/README.md) |
| Lima VMs (cross-platform testing) | [tools/lima/README.md](../tools/lima/README.md) |
| Config migrations | [docs/developers/config-migrations.md](../docs/developers/config-migrations.md) |
| Device hardware testing | [docs/developers/device-hardware-testing.md](../docs/developers/device-hardware-testing.md) |
| Package READMEs | `packages/*/README.md` |
| Feature requests | [agents/feature-requests.md](feature-requests.md) |
| About the project | [docs/project/about.md](../docs/project/about.md) |
| Rockbox compatibility | [docs/devices/rockbox.md](../docs/devices/rockbox.md) |
| Similar projects | [docs/project/similar-projects.md](../docs/project/similar-projects.md) |
| Roadmap | [docs/project/roadmap.md](../docs/project/roadmap.md) |
| Feedback & feature requests (user-facing) | [docs/project/feedback.md](../docs/project/feedback.md) |
| Docker | [docs/getting-started/docker.md](../docs/getting-started/docker.md) |
| Docker daemon mode | [docs/getting-started/docker-daemon.md](../docs/getting-started/docker-daemon.md) |
| Config migrations | [docs/developers/config-migrations.md](../docs/developers/config-migrations.md) |
| Config migration examples | `packages/podkit-cli/src/config/migrations/examples/` |
| LLM documentation system | [docs/developers/llm-documentation.md](../docs/developers/llm-documentation.md) |

## Documentation Maintenance

**Continuously improve documentation as you work:**

1. **Fix errors:** If docs are wrong or outdated, fix them
2. **Fill gaps:** If you needed information that wasn't documented, add it
3. **Clarify ambiguity:** If you had to guess or ask for clarification, improve the docs
4. **Update status:** Keep ADR statuses, feature flags, and roadmaps current

## File Conventions

All markdown files in `docs/` must have Starlight-compatible frontmatter:

```yaml
---
title: Page Title
description: Brief SEO description (1-2 sentences)
sidebar:
  order: N  # Lower numbers appear higher in navigation
---
```

**When creating new docs:**
- Place in the appropriate subdirectory (`getting-started/`, `user-guide/`, `devices/`, `reference/`, `troubleshooting/`, or `developers/`)
- Use lowercase filenames with hyphens (e.g., `my-new-guide.md`)
- Add frontmatter with title, description, and sidebar order
- Update the Documentation Map in this file
- Keep docs focused and modular (one topic per file)

**When editing existing docs:**
- Preserve frontmatter format
- Keep sidebar order consistent within a section
- Update links if you rename or move files

## Directory Structure

| Directory | Purpose | Audience |
|-----------|---------|----------|
| `getting-started/` | Installation, quick start, first sync | New users |
| `user-guide/` | Configuration, sources, transcoding, video | All users |
| `devices/` | Supported devices, iPod internals | Users + developers |
| `reference/` | CLI commands, config file, quality presets | All users |
| `troubleshooting/` | Common issues, macOS mounting | Users with problems |
| `developers/` | Architecture, development, testing | Contributors |

## LLM Documentation

The docs site generates machine-readable documentation for LLM agents via the `starlight-llms-txt` plugin. Configuration is in `packages/docs-site/config/llms-txt.ts`.

**When adding or moving docs pages:**
- New pages within existing directories are automatically included in the right custom documentation sets (glob patterns use `**` wildcards).
- If you create a new top-level docs section, add it to the appropriate custom set in the plugin config.
- If you change common workflows, install methods, or the config format, update the `description` and `details` in the plugin config — this is the entry point agents always read.

See [docs/developers/llm-documentation.md](../docs/developers/llm-documentation.md) for the full guide.
