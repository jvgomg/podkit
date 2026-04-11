# @podkit/daemon

## 0.3.0

### Minor Changes

- [#58](https://github.com/jvgomg/podkit/pull/58) [`efa14c6`](https://github.com/jvgomg/podkit/commit/efa14c623e7bda81066bd77142cddb28e4de615d) Thanks [@jvgomg](https://github.com/jvgomg)! - Add mass-storage device support for non-iPod portable music players.

  **Supported device types:** Echo Mini, Rockbox, and generic mass-storage DAPs. iPod support is unchanged.

  **New in CLI (`podkit`):**
  - `podkit device add --type <type>` registers mass-storage devices by type and mount path
  - `podkit device info/music/video` work with mass-storage devices via `DeviceAdapter` interface
  - `podkit device scan` shows configured path-based devices alongside auto-detected iPods
  - `podkit sync` routes to the correct adapter (iPod or mass-storage) based on device config
  - Video sync now uses capabilities-based gating instead of iPod-only checks
  - Safety gates on `device init/reset/clear` (iPod-only commands) for mass-storage devices
  - Mount and eject commands show device-appropriate messaging
  - Config validation rejects capability overrides on iPod devices (capabilities are auto-detected from generation)
  - Shared `openDevice()` function eliminates duplicated device-opening logic across commands

  **New in core (`@podkit/core`):**
  - `DeviceAdapter` interface — generic abstraction over device databases (iPod, mass-storage)
  - `MassStorageAdapter` — filesystem-based track management with `.podkit/state.json` manifest
  - `IpodDeviceAdapter` — thin wrapper making `IpodDatabase` implement `DeviceAdapter`
  - Device capability presets for Echo Mini, Rockbox, and generic devices
  - `resolveDeviceCapabilities()` merges preset defaults with user config overrides
  - `DeviceTrack` type used throughout sync engine (replaces `IPodTrack` casts in execution paths)
  - Configurable content path prefixes (`musicDir`, `moviesDir`, `tvShowsDir`) with device-type defaults
  - Device presets include default content paths (Echo Mini: root for music; generic/Rockbox: `Music/`, `Video/Movies/`, `Video/Shows/`)
  - Manifest v2 stores active content paths; files automatically moved when prefixes change
  - Root path support (`/`, `.`, or empty string all normalize to device root)
  - Content path duplicate validation (no two content types can share the same prefix)
  - Video scanning support for mass-storage devices (.m4v, .mp4, .mov, .avi, .mkv)

  **New in daemon (`@podkit/daemon`):**
  - Mass-storage device polling via `PODKIT_MASS_STORAGE_PATHS` env var (colon/comma separated)
  - Second `DevicePoller` + `SyncOrchestrator` pair for mass-storage devices
  - No-op mount/eject runners (mass-storage devices are externally managed)
  - Graceful shutdown handles both iPod and mass-storage sync pipelines

  **Configuration:**

  ```toml
  [devices.echo]
  type = "echo-mini"
  path = "/Volumes/ECHO"

  # Optional capability overrides (mass-storage only)
  artworkMaxResolution = 800
  supportedAudioCodecs = ["aac", "mp3", "flac"]

  # Optional content path overrides (mass-storage only)
  musicDir = "/"           # Place music at device root
  moviesDir = "Films"      # Custom movies directory
  tvShowsDir = "TV Shows"  # Custom TV shows directory
  ```

  **Environment variables for content paths:**
  - `PODKIT_MUSIC_DIR` — global default music directory
  - `PODKIT_MOVIES_DIR` — global default movies directory
  - `PODKIT_TV_SHOWS_DIR` — global default TV shows directory

- [`455e115`](https://github.com/jvgomg/podkit/commit/455e115d5f724411f970ed49dda2cca57c7aff2f) Thanks [@jvgomg](https://github.com/jvgomg)! - Support multiple iPods plugged in simultaneously. Each device gets a unique mount point and devices appearing during a sync are queued and synced sequentially after the current sync completes.

### Patch Changes

- Updated dependencies [[`0f3e4dd`](https://github.com/jvgomg/podkit/commit/0f3e4ddae134228b5e874b21db33f74547867b6c), [`036b107`](https://github.com/jvgomg/podkit/commit/036b1077748253385b6f4ff873a7cdb52c54b004), [`89ff40c`](https://github.com/jvgomg/podkit/commit/89ff40c2adedd9fec38ae5ad0eb89b75525642f2), [`c5c0236`](https://github.com/jvgomg/podkit/commit/c5c0236c232cc3fa086fd3937b0e2fbe0f326185), [`513173d`](https://github.com/jvgomg/podkit/commit/513173d1832bf9ca2894214e97d9d65cf02c52a5), [`7534c2f`](https://github.com/jvgomg/podkit/commit/7534c2f19d81087413af8abbf764fe20cef61384), [`8bc3126`](https://github.com/jvgomg/podkit/commit/8bc3126ec415aa836b746ec921b6738abdd9e538), [`03f1046`](https://github.com/jvgomg/podkit/commit/03f1046b70898b0282d0c96927bca60ee0d55eeb), [`3db3d88`](https://github.com/jvgomg/podkit/commit/3db3d887ae2cd19d01ba2c1f00b8682e783fac84), [`7ebb7c5`](https://github.com/jvgomg/podkit/commit/7ebb7c5c0e1c7c3d549196347029d9ce660fcb8b), [`94c85d2`](https://github.com/jvgomg/podkit/commit/94c85d2a9d6c85875432a0ebecab540a9ebd67d7), [`efa14c6`](https://github.com/jvgomg/podkit/commit/efa14c623e7bda81066bd77142cddb28e4de615d), [`208e482`](https://github.com/jvgomg/podkit/commit/208e482db9730064a25e53e03121bdcfcbea6341), [`bb96778`](https://github.com/jvgomg/podkit/commit/bb96778dde9063267188b2b83535ec279cd5c550), [`f72fa01`](https://github.com/jvgomg/podkit/commit/f72fa0170872fc0a6e5719b4509abae24e6414cd), [`c9c268e`](https://github.com/jvgomg/podkit/commit/c9c268ea4b25b39543e5c53a1928e72b4c31e0c8), [`1c3ebc3`](https://github.com/jvgomg/podkit/commit/1c3ebc381276accdb8361f50454b90c75f2391df)]:
  - @podkit/core@0.7.0

## 0.2.2

### Patch Changes

- [`632f360`](https://github.com/jvgomg/podkit/commit/632f3605370dbb50b0be5ffada0460f1aa9792d7) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve daemon graceful shutdown: forward SIGINT to the sync child process on SIGTERM so it drains and saves within Docker's 10-second timeout, instead of waiting for the full sync to complete.

- Updated dependencies [[`8e11397`](https://github.com/jvgomg/podkit/commit/8e11397501861930cf0827913003f8afe2afd943), [`8fdf618`](https://github.com/jvgomg/podkit/commit/8fdf618d95f3fad88f3738baf03dbda313a5a2d5), [`d19d6e3`](https://github.com/jvgomg/podkit/commit/d19d6e305cd864d188f3de377873b5a44df7e02f), [`3f56a1b`](https://github.com/jvgomg/podkit/commit/3f56a1b063f821e7a0d399a497521358331577a6), [`120a7b1`](https://github.com/jvgomg/podkit/commit/120a7b1a8899ed48515bd98ce731231e94d3409f), [`143e314`](https://github.com/jvgomg/podkit/commit/143e31442a40489390d45d74ee953facdc243706), [`2873f14`](https://github.com/jvgomg/podkit/commit/2873f14aad6493d2d7dafbe344e8b5db0abc3551), [`66560a9`](https://github.com/jvgomg/podkit/commit/66560a9158c777f2f25ca24c047204afa78f187e), [`7624265`](https://github.com/jvgomg/podkit/commit/762426537af1d3d7b29c6d6e1f878abd5c0474eb), [`632f360`](https://github.com/jvgomg/podkit/commit/632f3605370dbb50b0be5ffada0460f1aa9792d7)]:
  - @podkit/core@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`2e7ba81`](https://github.com/jvgomg/podkit/commit/2e7ba81085166b47ab08d07bb739f04d3d9e46d1), [`e1b0fbc`](https://github.com/jvgomg/podkit/commit/e1b0fbc679dca9516011a211adad255b9deb140f)]:
  - @podkit/core@0.5.1

## 0.2.0

### Minor Changes

- [`0aed896`](https://github.com/jvgomg/podkit/commit/0aed89634488ce604b90ee86ad97bf747b6356e0) Thanks [@jvgomg](https://github.com/jvgomg)! - Initial release of `@podkit/docker` and `@podkit/daemon` as versioned packages.

  **`@podkit/daemon`** is a long-running service that polls for iPod devices and automatically syncs them. It detects when an iPod is plugged in, mounts it, runs a full podkit sync, and ejects it — hands-free. Designed for always-on setups like NAS devices running Docker. Supports configurable poll intervals (`PODKIT_POLL_INTERVAL`) and Apprise notifications (`PODKIT_APPRISE_URL`). Handles graceful shutdown, waiting for any in-progress sync to complete before exiting.

  **`@podkit/docker`** is the Docker distribution of podkit, published as a multi-arch image (linux/amd64, linux/arm64) to `ghcr.io/jvgomg/podkit`. Bundles the CLI and daemon binaries in an Alpine-based image following LinuxServer.io conventions (PUID/PGID, /config volume). Supports two modes: CLI (default, run `sync` on demand) and daemon (opt-in, auto-detect and sync iPods on plug-in). Component versions are inspectable via OCI image labels and `/usr/local/share/podkit-versions.json`.
