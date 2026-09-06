# @podkit/daemon

## 0.3.0

### Minor Changes

- [`484fb0e`](https://github.com/jvgomg/podkit/commit/484fb0ea63eea297f19217d1acb96163a6754b05) Thanks [@jvgomg](https://github.com/jvgomg)! - Cross-process sync coordination: per-device lock, transcode owner-liveness, phantom auto-prune.

  **Per-device sync lock.** `podkit sync` now acquires a per-device PID-file lock at `.podkit/sync.lock` (mass-storage) or `iPod_Control/.podkit-sync.lock` (iPod) immediately after opening the device. A second concurrent `podkit sync` against the same device exits with the new `LOCK_HELD` code (exit code **4**) and a message naming the holding PID:

  ```
  Error: Another podkit process is already syncing /Volumes/TERAPOD (pid 12345). Wait for it to finish or kill it.
  ```

  Crash-safe: the lock file is unlinked in `finally`; if a process is SIGKILLed mid-sync, the next attempt detects the dead PID via liveness probe and takes over cleanly. `podkit sync --dry-run` does **not** take the lock (read-only by design). The daemon (`@podkit/daemon`) detects `LOCK_HELD` from the CLI subprocess and skips that cycle (no retry-spin). Read commands (`device scan`, `device info`, `device music`) are unaffected — writes only.

  **Transcode-tmp owner-liveness.** Each `podkit-transcode-<uuid>/` scratch directory now writes a small `.owner` file at creation. The pre-sync sweep walker reaps dirs whose owner is dead or whose `.owner` is missing; live owners are left alone. This replaces the previous session-start-time floor, which missed the most common interruption case for the long-running daemon: its own prior cycle.

  **Phantom manifest auto-prune.** When the pre-sync sweep detects manifest rows whose backing audio file has vanished (mass-storage devices), it now prunes them atomically as part of the sweep. Previously the sweep emitted an advisory warning recommending `podkit doctor --repair orphan-files`; the advisory now fires only if the auto-prune itself fails. `doctor --repair orphan-files` remains as a backstop and is unchanged.

  **Filesystem support.** The shared liveness primitive uses only `O_CREAT|O_EXCL`, `unlink`, `rename`, `readFile`, `writeFile`, and `process.kill(pid, 0)` — stable across exFAT, FAT32, HFS+, APFS, ext4, and NTFS. We deliberately avoided `flock(2)` because its semantics on FAT-family filesystems (common for iPods) are platform-dependent.

  **Internal API additions** (`@podkit/core`): `acquireLock`, `LockHandle`, `LockHeldError`, `LockContestedError`, `getOwnIdentity`, `readOwnership`, `writeOwnership`, `isAlive`, `PidFileEntry` — all from a new `lib/pid-file.ts` primitive. `DeviceAdapter` gains an optional `prunePhantomManifest?(paths)` method (implemented on mass-storage, intentionally omitted on iPod).

  **Removed internals:** `SESSION_START_MS` constant and `sessionStartMsOverride` plumbing in `pre-sync-sweep.ts` are gone — replaced wholesale by the PID-file liveness probe.

  See `documents/architecture/sync/planning.md` §6 for the cross-process coordination design.

- [`419ce94`](https://github.com/jvgomg/podkit/commit/419ce94fa52f27b51809af48870593f547af953e) Thanks [@jvgomg](https://github.com/jvgomg)! - Daemon applies per-device config settings by matching detected iPods against the device registry

  When an iPod appears, the daemon now consults the config device registry (via `podkit --json device list`) and matches the detected volume UUID against your configured devices. A registered iPod is synced by its device name, so its per-device settings (quality, collections, artwork, transforms) apply exactly as they do on the CLI. An unregistered iPod — including the ENV-only single-device lane — keeps the existing path-based sync with global/ENV settings, and any registry-lookup failure degrades to path-based sync rather than failing the cycle.

- [`e6e36af`](https://github.com/jvgomg/podkit/commit/e6e36afda3069aabc0ce6dbd23926ff12de7eb3c) Thanks [@jvgomg](https://github.com/jvgomg)! - Declare a single mass-storage device entirely via environment variables

  `PODKIT_DEVICE_PATH` (+ optional `PODKIT_DEVICE_TYPE`, default `generic`, and `PODKIT_DEVICE_NAME`, default `default`) declares a mass-storage device with no config file, exactly as a `[devices.<name>]` entry would — and makes it the default device. `PODKIT_DEVICE_TYPE=ipod` is rejected: iPods are auto-detected and need no declaration. In daemon mode the declared path is polled automatically, giving iPod and mass-storage users symmetric ENV-only single-device lanes.

  Path-based syncs (`-d /path`) now also match mass-storage devices declared in config by their `path` — previously matching was volume-UUID-only, which folder-based players without a filesystem UUID could never satisfy — so the declared preset and per-device settings apply.

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

- [`c0cf379`](https://github.com/jvgomg/podkit/commit/c0cf3795564dc438131bf03104b621b5b149c682) Thanks [@jvgomg](https://github.com/jvgomg)! - Daemon sends "Device Needs Init" guidance for a blank iPod

  With `podkit sync` now emitting the distinct `IPOD_NEEDS_INIT` code, the daemon's dormant needs-init path is active: a freshly-wiped iPod gets a clear "run `podkit device init`" notification and a clean skip instead of a generic sync failure. The notification copy also now names the real command (`podkit device init`, not `podkit init`). The daemon never initialises a device automatically.

- [`de596e0`](https://github.com/jvgomg/podkit/commit/de596e09e0afc2843c73e6c0323e09463cf3726c) Thanks [@jvgomg](https://github.com/jvgomg)! - Daemon gives actionable guidance for devices that need setup instead of a generic "Sync Error"

  When `podkit sync` refuses a device (for example an unidentified iPod that needs its one-time USB setup, or an unsupported model), the daemon now classifies the outcome and sends a clear, actionable notification — "Device Needs Setup" with the exact `podkit device add` / `doctor --repair sysinfo-extended` steps — and skips the device without mutating it, rather than reporting a generic sync failure. Clean skips are no longer logged as "completed with errors".

- [`d336154`](https://github.com/jvgomg/podkit/commit/d3361548c992eda2406723ebaff73a92edb6cab7) Thanks [@jvgomg](https://github.com/jvgomg)! - Detect whole-disk-formatted iPods in the daemon poller

  The daemon's device poller only recognised an iPod on a partition (lsblk `type: "part"`), so an iPod whose filesystem is written to a bare whole disk with no partition table — e.g. an iPod shuffle — was never detected and the daemon polled indefinitely without syncing it. This brings the daemon poller in line with the device scan/enumeration path, which already surfaces partitionless whole-disk iPods. The poller now also accepts a whole-disk volume (`type: "disk"` carrying a filesystem with no partition children), still preferring partitions over their parent disk when both are present and excluding loop devices; the iPod match (vfat + Apple vendor id) is unchanged.

- Updated dependencies [[`0f3e4dd`](https://github.com/jvgomg/podkit/commit/0f3e4ddae134228b5e874b21db33f74547867b6c), [`036b107`](https://github.com/jvgomg/podkit/commit/036b1077748253385b6f4ff873a7cdb52c54b004), [`621b10a`](https://github.com/jvgomg/podkit/commit/621b10abbec3a8e369da9620733210fef4b76f99), [`89ff40c`](https://github.com/jvgomg/podkit/commit/89ff40c2adedd9fec38ae5ad0eb89b75525642f2), [`c5c0236`](https://github.com/jvgomg/podkit/commit/c5c0236c232cc3fa086fd3937b0e2fbe0f326185), [`0d4a4c2`](https://github.com/jvgomg/podkit/commit/0d4a4c2bd98667989b9631d981e609bc72e604af), [`513173d`](https://github.com/jvgomg/podkit/commit/513173d1832bf9ca2894214e97d9d65cf02c52a5), [`248f5cc`](https://github.com/jvgomg/podkit/commit/248f5ccd45949a7ab9b773e81f0da537b57c85db), [`679bec8`](https://github.com/jvgomg/podkit/commit/679bec8b0c0e40fc8c6ae253ceaaba87f7ebfd2b), [`0cc39d3`](https://github.com/jvgomg/podkit/commit/0cc39d3c62343591127d5c79deed2478f8dc4f60), [`22dddf4`](https://github.com/jvgomg/podkit/commit/22dddf4803f4cfd7b004d80dffd83878a68b10f2), [`484fb0e`](https://github.com/jvgomg/podkit/commit/484fb0ea63eea297f19217d1acb96163a6754b05), [`348f2c5`](https://github.com/jvgomg/podkit/commit/348f2c53cec06598903b5cf128663d5121c46865), [`7534c2f`](https://github.com/jvgomg/podkit/commit/7534c2f19d81087413af8abbf764fe20cef61384), [`d1147e4`](https://github.com/jvgomg/podkit/commit/d1147e4a65ac103608da3730f530f6deab3cd0b6), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`6747667`](https://github.com/jvgomg/podkit/commit/6747667049cd793fdb13e3d1bc1092651f8e969c), [`8bc3126`](https://github.com/jvgomg/podkit/commit/8bc3126ec415aa836b746ec921b6738abdd9e538), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`87cb87a`](https://github.com/jvgomg/podkit/commit/87cb87aef59ad366b4c6c2b4c22f897f0b84a54a), [`01ecedd`](https://github.com/jvgomg/podkit/commit/01ecedde623ff99e94c5cbda75ff9f9c9ecef632), [`667d66b`](https://github.com/jvgomg/podkit/commit/667d66b90e0979aaff381968358f2cfc78c8e581), [`03f1046`](https://github.com/jvgomg/podkit/commit/03f1046b70898b0282d0c96927bca60ee0d55eeb), [`78b0c71`](https://github.com/jvgomg/podkit/commit/78b0c71b9866306aecbb96f2a0e372a86564f2fc), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`d68fccd`](https://github.com/jvgomg/podkit/commit/d68fccdcb53ac2b8bc3340570f83fece9c81d5a6), [`14d83e5`](https://github.com/jvgomg/podkit/commit/14d83e5e59eb0a8a801850de775f9fdb4c0e7aa9), [`a78e5fe`](https://github.com/jvgomg/podkit/commit/a78e5fee4e47293c1935395bb157cb6574782625), [`e0f65f4`](https://github.com/jvgomg/podkit/commit/e0f65f4b0cf4fce28138849b7a85f2c3a7c1a613), [`785ad57`](https://github.com/jvgomg/podkit/commit/785ad57af6627059fe3a6d7e1fef475e82c34764), [`4efa15c`](https://github.com/jvgomg/podkit/commit/4efa15c7e42874e9dd88ef2731230d5314d83f20), [`3db3d88`](https://github.com/jvgomg/podkit/commit/3db3d887ae2cd19d01ba2c1f00b8682e783fac84), [`7ebb7c5`](https://github.com/jvgomg/podkit/commit/7ebb7c5c0e1c7c3d549196347029d9ce660fcb8b), [`10c4317`](https://github.com/jvgomg/podkit/commit/10c4317273add0a3ade533cc13aa4949eb99295b), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`34e8bf2`](https://github.com/jvgomg/podkit/commit/34e8bf2341111df1e8f85361b8047eed9f31665a), [`3e95baf`](https://github.com/jvgomg/podkit/commit/3e95baffc65b683b5e3f80906e9a342245a6e4ce), [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4), [`09c4acd`](https://github.com/jvgomg/podkit/commit/09c4acdec349f200a649b2db15fe05345e380a7b), [`30638f5`](https://github.com/jvgomg/podkit/commit/30638f5e1a51dfe935154c62367e530383e13d14), [`c0cc659`](https://github.com/jvgomg/podkit/commit/c0cc659e5b442bcc1a78fddf637fed8f40a407c3), [`fa3bb22`](https://github.com/jvgomg/podkit/commit/fa3bb2257b971e1696aa6caf469d9ec784e7e73f), [`56013ce`](https://github.com/jvgomg/podkit/commit/56013ce78864a9d6fd39455f9628f8a4cd1b638f), [`151152a`](https://github.com/jvgomg/podkit/commit/151152ae835529730b3235a780550ec35ad685e2), [`94c85d2`](https://github.com/jvgomg/podkit/commit/94c85d2a9d6c85875432a0ebecab540a9ebd67d7), [`efa14c6`](https://github.com/jvgomg/podkit/commit/efa14c623e7bda81066bd77142cddb28e4de615d), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`208e482`](https://github.com/jvgomg/podkit/commit/208e482db9730064a25e53e03121bdcfcbea6341), [`0f53385`](https://github.com/jvgomg/podkit/commit/0f53385dff1222f4d9bcf0e4dcdfac5b9f24e13b), [`1f83c68`](https://github.com/jvgomg/podkit/commit/1f83c685753c1ab28be36155eab5e3fa78b83a22), [`480d751`](https://github.com/jvgomg/podkit/commit/480d7510ed9953a06047c848b514dbc688048932), [`2a644af`](https://github.com/jvgomg/podkit/commit/2a644afa386dd091e8268c8db7dac906c48e44d8), [`f5d0082`](https://github.com/jvgomg/podkit/commit/f5d00829f3b1a80453bdc4f7e6599566f7f02bb3), [`4ee5e2b`](https://github.com/jvgomg/podkit/commit/4ee5e2be470a93a54c2d54bc0aab257d7b92babe), [`303c35a`](https://github.com/jvgomg/podkit/commit/303c35aea57c0f35f64481e12e5cb9298e9a5631), [`bb96778`](https://github.com/jvgomg/podkit/commit/bb96778dde9063267188b2b83535ec279cd5c550), [`7517a24`](https://github.com/jvgomg/podkit/commit/7517a2444abf629f8e032faf29c938eb74b9b51b), [`947ee3c`](https://github.com/jvgomg/podkit/commit/947ee3cdd7ac57e40202f0c725c0e70c42a6ca1a), [`275c972`](https://github.com/jvgomg/podkit/commit/275c97295462547037e2c911c139654eb50d4af7), [`cac7fc1`](https://github.com/jvgomg/podkit/commit/cac7fc123861e97b10d31c83728a1e3f0431934e), [`f72fa01`](https://github.com/jvgomg/podkit/commit/f72fa0170872fc0a6e5719b4509abae24e6414cd), [`7bf7127`](https://github.com/jvgomg/podkit/commit/7bf7127d3141ce4b91138e3284b18aa5e8ea5984), [`de325a3`](https://github.com/jvgomg/podkit/commit/de325a3fb4227a6c8b02b2cf7c8ab6c6564b89fa), [`c9c268e`](https://github.com/jvgomg/podkit/commit/c9c268ea4b25b39543e5c53a1928e72b4c31e0c8), [`9b5fabb`](https://github.com/jvgomg/podkit/commit/9b5fabb5a356cbaea52ed6f802d15099516ace0d), [`1ec30ac`](https://github.com/jvgomg/podkit/commit/1ec30acca1109178012db3913a60967a2087fb5b), [`80fe65a`](https://github.com/jvgomg/podkit/commit/80fe65a022c65da512f571a8abf83f9385a649e6), [`63a69d1`](https://github.com/jvgomg/podkit/commit/63a69d11160770bcc5e251c7faf14d5c8887af13), [`52894c1`](https://github.com/jvgomg/podkit/commit/52894c1977bccd51a86929debfbaa7028a19dd61), [`c5cba69`](https://github.com/jvgomg/podkit/commit/c5cba6998283663b42659f02b17b194ab256c137), [`1c3ebc3`](https://github.com/jvgomg/podkit/commit/1c3ebc381276accdb8361f50454b90c75f2391df), [`cdebfb3`](https://github.com/jvgomg/podkit/commit/cdebfb3512f347356bc661722d2236b359776372), [`ec8dc85`](https://github.com/jvgomg/podkit/commit/ec8dc8549447b0178a8746b8cda2b8b7908b9d04), [`f61a83b`](https://github.com/jvgomg/podkit/commit/f61a83b3a2d13612730f174759fd3b86edd42e82), [`6000868`](https://github.com/jvgomg/podkit/commit/6000868830d9437a6fff3c1a77adb254d9579fe7), [`e825ee1`](https://github.com/jvgomg/podkit/commit/e825ee1dd4933ecbfd070dda27f96f43056f0baf)]:
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
