import { describe, it, expect } from 'bun:test';
import { migration0002 } from './0002-rename-ogg-codec.js';
import { createTestContext } from './test-utils.js';

const ctx = createTestContext();

describe('migration 0002: rename codec "ogg" → "vorbis"', () => {
  it('rewrites "ogg" to "vorbis" in supportedAudioCodecs', async () => {
    const input = `version = 1

[devices.player]
supportedAudioCodecs = ["aac", "mp3", "flac", "ogg"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('supportedAudioCodecs = ["aac", "mp3", "flac", "vorbis"]');
    expect(result).not.toContain('"ogg"');
    expect(result).toContain('version = 2');
  });

  it('handles multiple devices with "ogg" codec', async () => {
    const input = `version = 1

[devices.echo]
supportedAudioCodecs = ["aac", "ogg"]

[devices.rockbox]
supportedAudioCodecs = ["flac", "ogg", "opus"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('supportedAudioCodecs = ["aac", "vorbis"]');
    expect(result).toContain('supportedAudioCodecs = ["flac", "vorbis", "opus"]');
    expect(result).toContain('version = 2');
  });

  it('leaves other codecs untouched', async () => {
    const input = `version = 1

[devices.player]
supportedAudioCodecs = ["aac", "alac", "mp3", "flac", "ogg", "opus", "wav", "aiff"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain(
      'supportedAudioCodecs = ["aac", "alac", "mp3", "flac", "vorbis", "opus", "wav", "aiff"]'
    );
  });

  it('is a no-op for configs already containing "vorbis"', async () => {
    const input = `version = 1

[devices.player]
supportedAudioCodecs = ["aac", "mp3", "flac", "vorbis"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('supportedAudioCodecs = ["aac", "mp3", "flac", "vorbis"]');
    // No double-replacement
    expect(result.match(/"vorbis"/g)?.length).toBe(1);
    expect(result).toContain('version = 2');
  });

  it('handles configs with no devices section', async () => {
    const input = `version = 1

quality = "high"
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('quality = "high"');
    expect(result).toContain('version = 2');
  });

  it('handles configs with devices but no supportedAudioCodecs', async () => {
    const input = `version = 1

[devices.player]
volumeUuid = "ABC-123"
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('volumeUuid = "ABC-123"');
    expect(result).toContain('version = 2');
  });

  it('does not touch strings outside supportedAudioCodecs', async () => {
    // A device dir or label containing "ogg" should not be rewritten.
    const input = `version = 1

[devices.player]
musicDir = "ogg-only-tracks"
supportedAudioCodecs = ["aac", "ogg"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('musicDir = "ogg-only-tracks"');
    expect(result).toContain('supportedAudioCodecs = ["aac", "vorbis"]');
  });

  it('handles single-quoted strings', async () => {
    const input = `version = 1

[devices.player]
supportedAudioCodecs = ['aac', 'ogg']
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain("supportedAudioCodecs = ['aac', 'vorbis']");
  });

  it('handles quoted device names', async () => {
    const input = `version = 1

[devices."my-player"]
supportedAudioCodecs = ["aac", "ogg"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('supportedAudioCodecs = ["aac", "vorbis"]');
  });

  it('rewrites when sibling array-valued keys precede supportedAudioCodecs', async () => {
    // Regression test: `writer.ts` emits `artworkSources = [...]` before
    // `supportedAudioCodecs = [...]`. An earlier regex-based migration
    // spanned `[^\[]` from the section header and silently failed on
    // this real-world layout. The line scanner must handle it.
    const input = `version = 1

[devices.echo]
type = "echo-mini"
path = "/mnt/echo"
artworkSources = ["embedded"]
supportedAudioCodecs = ["aac", "mp3", "flac", "ogg"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('artworkSources = ["embedded"]');
    expect(result).toContain('supportedAudioCodecs = ["aac", "mp3", "flac", "vorbis"]');
    expect(result).toContain('version = 2');
    expect(result).not.toMatch(/supportedAudioCodecs[^\n]*"ogg"/);
  });

  it('rewrites multi-line arrays', async () => {
    const input = `version = 1

[devices.player]
supportedAudioCodecs = [
  "aac",
  "mp3",
  "ogg",
]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('"vorbis"');
    expect(result).not.toMatch(/"ogg"/);
    expect(result).toContain('version = 2');
  });

  it('does not rewrite "ogg" outside the target array on the same section', async () => {
    const input = `version = 1

[devices.player]
musicDir = "/Music/ogg-tracks"
artworkSources = ["embedded"]
supportedAudioCodecs = ["aac", "ogg"]
`;
    const result = await migration0002.migrate(input, ctx);

    expect(result).toContain('musicDir = "/Music/ogg-tracks"');
    expect(result).toContain('supportedAudioCodecs = ["aac", "vorbis"]');
  });

  it('does not rewrite inside non-device sections', async () => {
    // Hypothetical: a `supportedAudioCodecs` key under [music.X]. The
    // migration must scope strictly to `[devices.*]` sections that
    // actually contain `'ogg'`.
    const input = `version = 1

[music.main]
path = "/music"
# A spurious key in a non-device section
supportedAudioCodecs = ["ogg"]

[devices.player]
supportedAudioCodecs = ["aac", "ogg"]
`;
    const result = await migration0002.migrate(input, ctx);

    // The [music.main] entry stays as-is — out of scope.
    expect(result).toMatch(/\[music\.main\][\s\S]*supportedAudioCodecs = \["ogg"\]/);
    // The [devices.player] entry is rewritten.
    expect(result).toMatch(/\[devices\.player\][\s\S]*supportedAudioCodecs = \["aac", "vorbis"\]/);
  });

  it('has correct metadata', () => {
    expect(migration0002.fromVersion).toBe(1);
    expect(migration0002.toVersion).toBe(2);
    expect(migration0002.type).toBe('automatic');
    expect(migration0002.description).toBeTruthy();
  });
});
