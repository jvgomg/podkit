# @podkit/core

## 0.1.0

### Minor Changes

- [`83743dd`](https://github.com/jvgomg/podkit/commit/83743dda91e34d1ca2fa313e6f773096243b9a07) Thanks [@jvgomg](https://github.com/jvgomg)! - Add device validation and capability communication
  - Detect unsupported devices (iPod Touch, iPhone, iPad, buttonless Shuffles, Nano 6th gen) with clear error messages explaining why they won't work
  - Warn when iPod model cannot be identified, with instructions to fix SysInfo
  - Show device capability indicators (+/-) in `podkit device info` output
  - Block `podkit device add` for unsupported devices and show capabilities during confirmation
  - Add sync pre-flight checks that block unsupported devices and warn about incompatible content types
  - Include structured capabilities and validation data in JSON output

## 0.0.1

### Patch Changes

- [`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653) Thanks [@jvgomg](https://github.com/jvgomg)! - Initial release with CLI for syncing music collections to iPod devices. Includes directory and Subsonic source adapters, FLAC-to-AAC transcoding, metadata and artwork transfer, and video sync support.

- Updated dependencies [[`3cf3843`](https://github.com/jvgomg/podkit/commit/3cf384380d5c46d7c70ff9121b9b6ca0d9ae0653)]:
  - @podkit/libgpod-node@0.0.1
