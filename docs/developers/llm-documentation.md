---
title: LLM Documentation
description: How the LLM documentation system works and how to maintain it.
sidebar:
  order: 8
---

The docs site generates machine-readable documentation for LLM agents using the [`starlight-llms-txt`](https://github.com/delucis/starlight-llms-txt) plugin. This page explains how the system works and how to keep it working well.

## How It Works

The plugin generates text files from the same Markdown sources as the human docs site. Agents use these files to understand podkit and help users.

**Progressive disclosure** — agents don't need to load everything at once:

1. **`llms.txt`** — Entry point. Contains a project summary, key concepts, common commands, a minimal config example, and links to documentation sets. Designed so agents can answer basic questions without loading anything else.
2. **Custom documentation sets** (`_llms-txt/<slug>.txt`) — Targeted subsets for specific agent tasks (setup, Docker, syncing, development). Agents load only the set relevant to the user's question.
3. **`llms-small.txt`** — Abridged version of all user-facing docs. A fallback when the question doesn't fit a single custom set.
4. **`llms-full.txt`** — Complete documentation including developer pages.

All files are generated at build time and deployed alongside the docs site.

## Documentation Sets

Each custom set bundles docs for a specific agent mission. The table below shows what each set contains and when an agent should load it.

| Set | Slug | Contents | When to load |
|-----|------|----------|--------------|
| Setup Guide | `setup-guide` | Getting started, configuration, collections, config file reference, environment variables, CLI commands | Installation, first config, adding collections |
| Docker & NAS Guide | `docker--nas-guide` | Docker setup, Docker daemon mode, environment variables, config file reference, common issues | Docker, Docker Compose, daemon mode, Synology, Proxmox |
| Syncing & Devices | `syncing--devices` | Syncing, devices, transcoding, quality presets, clean artists, show language, sync tags, device compatibility, troubleshooting | Sync issues, device problems, quality settings, troubleshooting |
| Developer Guide | `developer-guide` | All developer docs | Contributing, architecture, testing, libgpod |

Some docs appear in multiple sets (e.g. environment variables is in both Setup and Docker). This is intentional — agents working in either context need them, and the duplication is small.

## Configuration

The plugin is configured in `packages/docs-site/astro.config.mjs` inside the `starlightLlmsTxt()` call.

Key options:

| Option | Purpose |
|--------|---------|
| `description` | Project summary shown at the top of `llms.txt`. Should answer "what is this?" |
| `details` | Extended context below the description. Contains install commands, workflows, key concepts, common commands, and routing guidance |
| `customSets` | Array of `{ label, paths, description }`. Each generates a `_llms-txt/<slug>.txt` file |
| `promote` | Glob patterns for pages sorted to the top of generated files |
| `demote` | Glob patterns for pages sorted to the bottom |
| `exclude` | Glob patterns for pages omitted from `llms-small.txt` |
| `optionalLinks` | Individual page links shown in `llms.txt` for standalone lookups |

**Content IDs** are file paths relative to `docs/`, including the extension (e.g. `getting-started/docker.md`). Glob patterns use [micromatch](https://github.com/micromatch/micromatch) syntax — `getting-started/**` matches all files in that directory, `user-guide/configuration*` matches `user-guide/configuration.md`.

## When to Update

### New docs page created

Check if the new page falls within an existing custom set's glob patterns. Most patterns use `**` wildcards, so new pages within existing directories are included automatically.

If the page is in a new directory not covered by any set, decide which set it belongs to and add a glob pattern.

### Docs page moved or renamed

Same principle — `**` wildcards handle files within existing directories. Only update patterns if a page moves to a different top-level section.

### New docs section added

Add a glob pattern to the appropriate custom set. Creating a new custom set should be rare — prefer adding to existing sets unless the new section serves a fundamentally different agent mission.

### Entry point (description/details) changed

The `description` and `details` fields in the plugin config form the `llms.txt` entry point. Update them when:

- New features ship that change common workflows
- The project status changes (e.g. leaving beta)
- Install methods change
- The config format changes significantly
- Common commands are added or removed

The entry point is the most critical piece — it's the document agents always read first.

## Writing Docs for Both Humans and LLMs

These practices improve docs for human readers and LLM agents alike.

**Front-load key information.** Put the most important content (commands, config examples, key concepts) at the top of each page. Agents benefit from the same clear structure that helps humans scan.

**Use concrete examples.** Code blocks with realistic values are more useful than abstract descriptions. A config example with `path = "/Volumes/Media/music"` is better than "set the path to your music directory."

**Keep pages focused.** One topic per page. Agents in custom sets receive all pages matching the set's globs — a page that mixes Docker setup with general configuration will appear in multiple sets, wasting context.

**Use descriptive headings.** Agents use headings to navigate concatenated documents. "Configuration" is less useful than "Subsonic Source Configuration" when many pages are concatenated together.

**Put critical content in plain Markdown.** Starlight components like Tabs, Cards, and FileTree are stripped or simplified during LLM text generation. If critical information is only inside a `<TabItem>`, it may not appear in the LLM output. Use interactive components for supplementary presentation, not as the only way to access key content.

## Verifying LLM Docs

After making changes to docs or the plugin config, build the site and inspect the output:

```bash
cd packages/docs-site
bun run build
```

Check the generated files:

```bash
# Entry point — should read well as a standalone document
cat dist/podkit/llms.txt

# Custom sets — verify each contains expected pages
ls dist/podkit/_llms-txt/
cat dist/podkit/_llms-txt/setup-guide.txt | head -30
cat dist/podkit/_llms-txt/docker-nas-guide.txt | head -30
cat dist/podkit/_llms-txt/syncing-devices.txt | head -30
cat dist/podkit/_llms-txt/developer-guide.txt | head -30

# File sizes — llms-small.txt should be under ~250KB, custom sets under ~100KB
wc -c dist/podkit/llms.txt dist/podkit/llms-small.txt dist/podkit/llms-full.txt dist/podkit/_llms-txt/*.txt
```

### What to check

- The `llms.txt` entry point answers basic questions (install, first sync, common commands) without needing additional files
- Each custom set contains the pages you expect — look for the `<SYSTEM>` header and page titles
- Excluded pages (`project/**`, `developers/**`, `reference/changelog*`) don't appear in `llms-small.txt`
- File sizes are reasonable for agent context windows

### Troubleshooting

**New page not appearing in a custom set:** Check that the glob pattern matches the content collection ID. Content IDs include the file extension, so a pattern like `getting-started/**` matches `getting-started/docker.md`.

**Page excluded unexpectedly from llms-small.txt:** Check the `exclude` patterns. Pages matching any exclude pattern are omitted entirely from the abridged version.

**Custom set slug doesn't match expected URL:** Slugs are auto-generated from the `label` field using GitHub's slugger — lowercased with spaces replaced by hyphens. Special characters like `&` are removed but produce double hyphens: "Docker & NAS Guide" becomes `docker--nas-guide`.
