# podkit

## 0.2.0

### Minor Changes

- [`d3b8eb2`](https://github.com/jvgomg/podkit/commit/d3b8eb25fc2f453689a5d2e38eb6acb9fe70b1e1) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve `podkit device add` to detect and handle unmounted iPods, including iFlash-modified devices that macOS refuses to automount.
  - Scans for both mounted and unmounted iPods — no longer requires the device to be pre-mounted
  - Assesses unmounted devices before attempting to mount: reads block size and capacity from diskutil, queries USB product ID via system_profiler, and resolves it to a model name (e.g. "iPod Classic 6th generation")
  - Confirms iFlash adapters via two independent signals: 2048-byte block size (iFlash emulates optical media sectors) and capacity exceeding the original iPod Classic maximum of 160 GB
  - Attempts `diskutil mount` first (no elevated privileges required); falls back to `mount -t msdos` for large FAT32 volumes that macOS refuses to mount through its normal mechanisms
  - When sudo is required, explains exactly why with per-signal detail and shows the exact command to run (`sudo podkit device add <name>`)
  - Exports `DeviceAssessment`, `IFlashAssessment`, `IFlashEvidence`, and `UsbDeviceInfo` types from `@podkit/core`

### Patch Changes

- [`f268d71`](https://github.com/jvgomg/podkit/commit/f268d71a83e9fb31eb15d99348a6d8f7e1b02c2b) Thanks [@jvgomg](https://github.com/jvgomg)! - Extract filesystem validation into a shared utility module for improved testability

- [`b3d530f`](https://github.com/jvgomg/podkit/commit/b3d530ff32fc84647f695e46a833ae17d5e6fb02) Thanks [@jvgomg](https://github.com/jvgomg)! - Add support for PODKIT_CONFIG environment variable to set config file path

- Updated dependencies [[`d3b8eb2`](https://github.com/jvgomg/podkit/commit/d3b8eb25fc2f453689a5d2e38eb6acb9fe70b1e1)]:
  - @podkit/core@0.2.0

## 0.1.0

### Minor Changes

- [`83743dd`](https://github.com/jvgomg/podkit/commit/83743dda91e34d1ca2fa313e6f773096243b9a07) Thanks [@jvgomg](https://github.com/jvgomg)! - Add device validation and capability communication
  - Detect unsupported devices (iPod Touch, iPhone, iPad, buttonless Shuffles, Nano 6th gen) with clear error messages explaining why they won't work
  - Warn when iPod model cannot be identified, with instructions to fix SysInfo
  - Show device capability indicators (+/-) in `podkit device info` output
  - Block `podkit device add` for unsupported devices and show capabilities during confirmation
  - Add sync pre-flight checks that block unsupported devices and warn about incompatible content types
  - Include structured capabilities and validation data in JSON output

- [`39e3129`](https://github.com/jvgomg/podkit/commit/39e31298517688bcd3feb98233e584d5ed2e4507) Thanks [@jvgomg](https://github.com/jvgomg)! - Add stats, albums, and artists views to content listing commands
  - `device music`, `device video`, `collection music`, and `collection video` now show summary stats by default (track/album/artist counts and file type breakdown)
  - Add `--tracks` flag to list all tracks (previous default behavior)
  - Add `--albums` flag to list albums with track counts
  - Add `--artists` flag to list artists with album/track counts
  - `--tracks --json` on device commands now includes all iPod metadata fields (play stats, timestamps, video fields, etc.)

### Patch Changes

- Updated dependencies [[`83743dd`](https://github.com/jvgomg/podkit/commit/83743dda91e34d1ca2fa313e6f773096243b9a07)]:
  - @podkit/core@0.1.0

## 0.0.3

### Patch Changes

- [`3c2c3e8`](https://github.com/jvgomg/podkit/commit/3c2c3e8ad1baf7a92fe65c2e3570b9a6a674fa41) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix `--version` to show the correct version number instead of 0.0.0

## 0.0.2

### Patch Changes

- [`168a9d2`](https://github.com/jvgomg/podkit/commit/168a9d2577b447cff75c75897c7a834f0ccd7114) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix release pipeline to correctly detect version merges

## 0.0.1

### Patch Changes

- [`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653) Thanks [@jvgomg](https://github.com/jvgomg)! - Initial release with CLI for syncing music collections to iPod devices. Includes directory and Subsonic source adapters, FLAC-to-AAC transcoding, metadata and artwork transfer, and video sync support.

- Updated dependencies [[`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653)]:
  - @podkit/core@0.0.1
