# @podkit/docker

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
