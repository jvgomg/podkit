# @podkit/daemon

## 0.3.0

### Minor Changes

- [`455e115`](https://github.com/jvgomg/podkit/commit/455e115d5f724411f970ed49dda2cca57c7aff2f) Thanks [@jvgomg](https://github.com/jvgomg)! - Support multiple iPods plugged in simultaneously. Each device gets a unique mount point and devices appearing during a sync are queued and synced sequentially after the current sync completes.

### Patch Changes

- Updated dependencies [[`03f1046`](https://github.com/jvgomg/podkit/commit/03f1046b70898b0282d0c96927bca60ee0d55eeb), [`1c3ebc3`](https://github.com/jvgomg/podkit/commit/1c3ebc381276accdb8361f50454b90c75f2391df)]:
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
