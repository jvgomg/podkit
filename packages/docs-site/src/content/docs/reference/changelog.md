---
title: Changelog
description: Release history and version information
sidebar:
  order: 40
---

## Releases

All releases are published on [GitHub Releases](https://github.com/jvgomg/podkit/releases), including release notes, binaries, and checksums.

## Versioning

podkit is a monorepo with independently versioned packages. The version that matters to most users is the **CLI version** — this is what `podkit --version` reports and what Homebrew tracks.

Internal packages (`@podkit/core`, `@podkit/libgpod-node`, etc.) have their own version numbers that advance independently. You generally don't need to track these unless you're using podkit as a library.

## Release Process

Releases are managed with [Changesets](https://github.com/changesets/changesets). Each pull request that changes user-facing behavior includes a changeset describing the change. When changesets accumulate on the main branch, a release PR is opened automatically. Merging that PR publishes new versions and updates the GitHub Release notes.
