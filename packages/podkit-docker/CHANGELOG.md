# @podkit/docker

## 0.2.3

### Patch Changes

- [`a71f2d0`](https://github.com/jvgomg/podkit/commit/a71f2d08b1e78412fd8a537f67894934ea50436c) Thanks [@jvgomg](https://github.com/jvgomg)! - Optimise Docker image layers by using `COPY --chmod=755` instead of separate `RUN chmod` steps, reducing the total layer count

- Updated dependencies [[`632f360`](https://github.com/jvgomg/podkit/commit/632f3605370dbb50b0be5ffada0460f1aa9792d7), [`67d1357`](https://github.com/jvgomg/podkit/commit/67d1357672016fcf6a55a20187bf8d5dbe4d3f31), [`4dd7b44`](https://github.com/jvgomg/podkit/commit/4dd7b443c9bdeaa98507d5439dd1223bbd2f82e1), [`d19d6e3`](https://github.com/jvgomg/podkit/commit/d19d6e305cd864d188f3de377873b5a44df7e02f), [`120a7b1`](https://github.com/jvgomg/podkit/commit/120a7b1a8899ed48515bd98ce731231e94d3409f), [`b698a07`](https://github.com/jvgomg/podkit/commit/b698a0765a039d130c6f913e2608f0fc00320ca0), [`3f56a1b`](https://github.com/jvgomg/podkit/commit/3f56a1b063f821e7a0d399a497521358331577a6), [`3db2bbb`](https://github.com/jvgomg/podkit/commit/3db2bbb2381a01107602380a8017624581548ecc), [`1c98ac2`](https://github.com/jvgomg/podkit/commit/1c98ac273e5eb3b78aa02dbc649c2f8086e5af2e), [`143e314`](https://github.com/jvgomg/podkit/commit/143e31442a40489390d45d74ee953facdc243706), [`2873f14`](https://github.com/jvgomg/podkit/commit/2873f14aad6493d2d7dafbe344e8b5db0abc3551), [`7624265`](https://github.com/jvgomg/podkit/commit/762426537af1d3d7b29c6d6e1f878abd5c0474eb)]:
  - @podkit/daemon@0.2.2
  - podkit@0.6.0

## 0.2.2

### Patch Changes

- [`854c663`](https://github.com/jvgomg/podkit/commit/854c663d627a2817b5464af412461114fc6d5a98) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix daemon not detecting iPods on Synology NAS where lsblk does not probe filesystem types by default

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - podkit@0.5.1
  - @podkit/daemon@0.2.1

## 0.2.0

### Minor Changes

- [`0aed896`](https://github.com/jvgomg/podkit/commit/0aed89634488ce604b90ee86ad97bf747b6356e0) Thanks [@jvgomg](https://github.com/jvgomg)! - Initial release of `@podkit/docker` and `@podkit/daemon` as versioned packages.

  **`@podkit/daemon`** is a long-running service that polls for iPod devices and automatically syncs them. It detects when an iPod is plugged in, mounts it, runs a full podkit sync, and ejects it — hands-free. Designed for always-on setups like NAS devices running Docker. Supports configurable poll intervals (`PODKIT_POLL_INTERVAL`) and Apprise notifications (`PODKIT_APPRISE_URL`). Handles graceful shutdown, waiting for any in-progress sync to complete before exiting.

  **`@podkit/docker`** is the Docker distribution of podkit, published as a multi-arch image (linux/amd64, linux/arm64) to `ghcr.io/jvgomg/podkit`. Bundles the CLI and daemon binaries in an Alpine-based image following LinuxServer.io conventions (PUID/PGID, /config volume). Supports two modes: CLI (default, run `sync` on demand) and daemon (opt-in, auto-detect and sync iPods on plug-in). Component versions are inspectable via OCI image labels and `/usr/local/share/podkit-versions.json`.

### Patch Changes

- Updated dependencies [[`6b90ef7`](https://github.com/jvgomg/podkit/commit/6b90ef7972c42a4def206b15584ea7caa549b4d2), [`0aed896`](https://github.com/jvgomg/podkit/commit/0aed89634488ce604b90ee86ad97bf747b6356e0), [`8dddd29`](https://github.com/jvgomg/podkit/commit/8dddd2945071f3aac3c018cc05138ef51386529c), [`0019607`](https://github.com/jvgomg/podkit/commit/00196072d68bdbf8a7dabb64fb53dc968aebfdbb), [`4edadde`](https://github.com/jvgomg/podkit/commit/4edadde979cbe780ff455df3f98310988961fe6e)]:
  - podkit@0.5.0
  - @podkit/daemon@0.2.0
