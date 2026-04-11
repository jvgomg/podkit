# @podkit/docker

## 0.2.4

### Patch Changes

- Updated dependencies [[`0f3e4dd`](https://github.com/jvgomg/podkit/commit/0f3e4ddae134228b5e874b21db33f74547867b6c), [`036b107`](https://github.com/jvgomg/podkit/commit/036b1077748253385b6f4ff873a7cdb52c54b004), [`89ff40c`](https://github.com/jvgomg/podkit/commit/89ff40c2adedd9fec38ae5ad0eb89b75525642f2), [`c5c0236`](https://github.com/jvgomg/podkit/commit/c5c0236c232cc3fa086fd3937b0e2fbe0f326185), [`0ef210b`](https://github.com/jvgomg/podkit/commit/0ef210be6e5fc38203e5501d33cc1bb978ecc0c6), [`56c7ec3`](https://github.com/jvgomg/podkit/commit/56c7ec36fb00b6996beffdce76eb17a23211c628), [`513173d`](https://github.com/jvgomg/podkit/commit/513173d1832bf9ca2894214e97d9d65cf02c52a5), [`7534c2f`](https://github.com/jvgomg/podkit/commit/7534c2f19d81087413af8abbf764fe20cef61384), [`8bc3126`](https://github.com/jvgomg/podkit/commit/8bc3126ec415aa836b746ec921b6738abdd9e538), [`03f1046`](https://github.com/jvgomg/podkit/commit/03f1046b70898b0282d0c96927bca60ee0d55eeb), [`3db3d88`](https://github.com/jvgomg/podkit/commit/3db3d887ae2cd19d01ba2c1f00b8682e783fac84), [`7ebb7c5`](https://github.com/jvgomg/podkit/commit/7ebb7c5c0e1c7c3d549196347029d9ce660fcb8b), [`1caab19`](https://github.com/jvgomg/podkit/commit/1caab1991d43739aaba3d9ae2e4a5dd6575f331a), [`3fe7853`](https://github.com/jvgomg/podkit/commit/3fe785330f8b92c21159ae253456942a92e7c8e2), [`26733cc`](https://github.com/jvgomg/podkit/commit/26733cc77fd56681387b29e4241ad05e4d1fd348), [`e58ae80`](https://github.com/jvgomg/podkit/commit/e58ae806a494e3f526a828d4b72dab558ae4b121), [`94c85d2`](https://github.com/jvgomg/podkit/commit/94c85d2a9d6c85875432a0ebecab540a9ebd67d7), [`efa14c6`](https://github.com/jvgomg/podkit/commit/efa14c623e7bda81066bd77142cddb28e4de615d), [`455e115`](https://github.com/jvgomg/podkit/commit/455e115d5f724411f970ed49dda2cca57c7aff2f), [`f72fa01`](https://github.com/jvgomg/podkit/commit/f72fa0170872fc0a6e5719b4509abae24e6414cd), [`1c3ebc3`](https://github.com/jvgomg/podkit/commit/1c3ebc381276accdb8361f50454b90c75f2391df), [`17eac11`](https://github.com/jvgomg/podkit/commit/17eac114719f93cef40beb58381e534a28ebc35f)]:
  - podkit@0.7.0
  - @podkit/daemon@0.3.0

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
