# podkit

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
