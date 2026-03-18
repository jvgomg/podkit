---
title: Other Devices
description: Rockbox iPods, standalone DAPs, and podkit's future device support plans.
sidebar:
  order: 2
---

podkit's primary focus is Apple's stock iPod firmware — the hardest sync target due to the iTunesDB database format and its authentication requirements. By solving that problem first, podkit builds a foundation that can extend to easier targets in the future.

## Rockbox

iPods running [Rockbox](https://www.rockbox.org/) firmware can play music synced by podkit, but Rockbox doesn't read the iTunesDB — you'll need to enable Rockbox's Database feature to browse your library. See the [Rockbox compatibility guide](/devices/rockbox) for setup steps and caveats.

Native Rockbox support (folder-based sync without iTunesDB) is a [planned feature](https://github.com/jvgomg/podkit/discussions/34).

## Standalone DAPs

Standalone digital audio players (DAPs) that use simple file-based music libraries are natural future targets for podkit. These devices typically just need music files organized in a directory structure — no proprietary database format required.

There is no timeline for DAP support, but the architecture is designed to accommodate it.

## See Also

- [Supported Devices](/devices/supported-devices) - Stock firmware iPod compatibility
- [Roadmap](/project/roadmap) - Planned features and priorities
- [Feedback](/project/feedback) - Request device support
