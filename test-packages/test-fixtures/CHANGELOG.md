# @podkit/test-fixtures

## 0.1.0

### Minor Changes

- [`52894c1`](https://github.com/jvgomg/podkit/commit/52894c1977bccd51a86929debfbaa7028a19dd61) Thanks [@jvgomg](https://github.com/jvgomg)! - `@podkit/test-fixtures`: expose synthetic-track generators as a library

  Adds a library entry (`src/lib.ts`) exposing `generateMiniFlac`, `generateMiniMp3`, `generateMiniM4a`, `generateMiniOggVorbis`, and `generateMiniOggOpus`. Each helper writes a single short sine-tone file in the requested codec/container with optional metadata. Integration tests that need real audio for tag round-trip coverage now import these from `@podkit/test-fixtures` rather than re-implementing the ffmpeg invocation inline.

  Each generator calls a new `requireEncoder()` guard before invoking ffmpeg. If the host's ffmpeg is missing the codec's encoder, the helper throws a clear error with platform-aware install hints. There is also an explicit `bun run --filter @podkit/test-fixtures check-ffmpeg` script that verifies the full set of required encoders against the host environment in one shot.

  The mass-storage tag writer integration test (`packages/podkit-core/src/device/mass-storage-tag-writer.integration.test.ts`) drops its inline `generateOgg`, `generateOpus`, `generateFlac`, `generateM4a`, `generateMp3` helpers and the `HAS_LIBVORBIS` skip predicate. The OGG Vorbis tests now run unconditionally — they fail loudly with an install hint when libvorbis is absent rather than skipping silently.

  Developer docs (`docs/developers/development.md`) updated to point macOS contributors at the `homebrew-ffmpeg/ffmpeg` tap for full encoder coverage.
