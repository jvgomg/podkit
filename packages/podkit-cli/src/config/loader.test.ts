import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadConfigFile,
  loadEnvConfig,
  loadCliConfig,
  mergeConfigs,
  loadConfig,
} from './loader.js';
import { DEFAULT_CONFIG, ENV_KEYS } from './defaults.js';
import { DEFAULT_TRANSFORMS_CONFIG } from './types.js';
import { CURRENT_CONFIG_VERSION } from './version.js';
import type { GlobalOptions, PartialConfig } from './types.js';

/** Prefix TOML content with the current version field for tests */
function v(toml: string): string {
  return `version = ${CURRENT_CONFIG_VERSION}\n${toml}`;
}

describe('config loader', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Clear environment variables
    delete process.env[ENV_KEYS.quality];
    delete process.env[ENV_KEYS.audioQuality];
    delete process.env[ENV_KEYS.videoQuality];
    delete process.env[ENV_KEYS.encoding];
    delete process.env[ENV_KEYS.transferMode];
    delete process.env[ENV_KEYS.customBitrate];
    delete process.env[ENV_KEYS.bitrateReduce];
    delete process.env[ENV_KEYS.bitrateTolerance];
    delete process.env[ENV_KEYS.artwork];
    delete process.env[ENV_KEYS.cleanArtists];
    delete process.env[ENV_KEYS.cleanArtistsDrop];
    delete process.env[ENV_KEYS.cleanArtistsFormat];
    delete process.env[ENV_KEYS.cleanArtistsIgnore];

    // Clear collection + device env vars (dynamic names)
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('PODKIT_MUSIC_') ||
        key.startsWith('PODKIT_VIDEO_') ||
        key.startsWith('PODKIT_DEVICE_')
      ) {
        delete process.env[key];
      }
    }
  });

  describe('DEFAULT_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_CONFIG.quality).toBe('high');
      expect(DEFAULT_CONFIG.artwork).toBe(true);
      expect(DEFAULT_CONFIG.tips).toBe(true);
    });
  });

  describe('loadConfigFile', () => {
    it('returns undefined for non-existent file', () => {
      const result = loadConfigFile(path.join(tempDir, 'nonexistent.toml'));
      expect(result).toBeUndefined();
    });

    it('throws on config with no version field (version 0)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, 'quality = "high"\n');

      expect(() => loadConfigFile(configPath)).toThrow('podkit migrate');
    });

    it('throws on config with invalid version type', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, 'version = "foo"\nquality = "high"\n');

      expect(() => loadConfigFile(configPath)).toThrow('Invalid config version');
    });

    it('parses tips option from config file', () => {
      const configPath = path.join(tempDir, 'tips.toml');
      fs.writeFileSync(configPath, v('tips = false\n'));

      const result = loadConfigFile(configPath);
      expect(result).toEqual({ tips: false });
    });

    it('parses valid config with quality and artwork', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
quality = "medium"
artwork = false
`)
      );

      const result = loadConfigFile(configPath);
      expect(result).toEqual({
        quality: 'medium',
        artwork: false,
      });
    });

    it('throws on invalid quality value', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
quality = "invalid"
`)
      );

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid quality value/);
    });

    it('silently ignores a wrong-typed (non-string) quality value', () => {
      // Top-level scalar/enum fields use a non-throwing type guard: a
      // wrong-type value is skipped, not rejected (per-device fields, by
      // contrast, throw on wrong type).
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`quality = 42`));

      const result = loadConfigFile(configPath);
      expect(result?.quality).toBeUndefined();
    });

    // Quality preset tests
    const validPresets = ['max', 'high', 'medium', 'low'] as const;
    for (const preset of validPresets) {
      it(`accepts quality = "${preset}"`, () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, v(`quality = "${preset}"`));

        const result = loadConfigFile(configPath);
        expect(result?.quality).toBe(preset);
      });
    }

    const invalidPresets = ['lossless', 'max-cbr', 'high-cbr', 'medium-cbr', 'low-cbr'] as const;
    for (const preset of invalidPresets) {
      it(`rejects invalid preset "${preset}"`, () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, v(`quality = "${preset}"`));

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid quality/);
      });
    }

    // encoding tests
    it('parses encoding option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`encoding = "cbr"`));

      const result = loadConfigFile(configPath);
      expect(result?.encoding).toBe('cbr');
    });

    it('accepts encoding = "vbr"', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`encoding = "vbr"`));

      const result = loadConfigFile(configPath);
      expect(result?.encoding).toBe('vbr');
    });

    it('throws on invalid encoding', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`encoding = "abr"`));

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid encoding value/);
    });

    // lossy-reduction block (ADR-023)
    describe('bitrate reduction block', () => {
      it('parses a global [bitrate] block with reduce and tolerance', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[bitrate]
reduce = "always"
tolerance = 0.4
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.bitrate).toEqual({
          reduce: 'always',
          tolerance: 0.4,
        });
      });

      it('accepts every valid reduce mode', () => {
        const modes = ['auto', 'always', 'never'] as const;
        for (const mode of modes) {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(configPath, v(`[bitrate]\nreduce = "${mode}"`));
          expect(loadConfigFile(configPath)?.bitrate?.reduce).toBe(mode);
        }
      });

      it('accepts tolerance = 0 (exact)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, v(`[bitrate]\ntolerance = 0`));
        expect(loadConfigFile(configPath)?.bitrate?.tolerance).toBe(0);
      });

      it('throws on an invalid reduce value naming the field and valid values', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, v(`[bitrate]\nreduce = "sometimes"`));

        expect(() => loadConfigFile(configPath)).toThrow(
          /Invalid bitrate\.reduce value "sometimes".*auto/s
        );
      });

      it('throws on a negative tolerance', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, v(`[bitrate]\ntolerance = -0.1`));

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid bitrate\.tolerance value/);
      });

      it('rejects the removed [bitrate].sync key, naming the replacement', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, v(`[bitrate]\nsync = "match-cap"`));

        expect(() => loadConfigFile(configPath)).toThrow(
          /"bitrate\.sync".*was removed.*\[bitrate\]\.reduce.*\[bitrate\]\.tolerance/s
        );
      });

      it('rejects the removed toleranceUp / toleranceDown keys', () => {
        for (const key of ['toleranceUp', 'toleranceDown'] as const) {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(configPath, v(`[bitrate]\n${key} = 0.1`));
          expect(() => loadConfigFile(configPath)).toThrow(
            new RegExp(`"bitrate\\.${key}".*was removed`, 's')
          );
        }
      });

      it('parses a per-device [devices.x.bitrate] block', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"

[devices.terapod.bitrate]
reduce = "never"
tolerance = 0.2
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod?.bitrate).toEqual({
          reduce: 'never',
          tolerance: 0.2,
        });
      });

      it('reports the device context in an invalid per-device reduce error', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"

[devices.terapod.bitrate]
reduce = "nope"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/\[devices\.terapod\.bitrate\]/);
      });
    });

    // transferMode tests
    it('parses transferMode = "fast"', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`transferMode = "fast"`));

      const result = loadConfigFile(configPath);
      expect(result?.transferMode).toBe('fast');
    });

    it('parses transferMode = "optimized"', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`transferMode = "optimized"`));

      const result = loadConfigFile(configPath);
      expect(result?.transferMode).toBe('optimized');
    });

    it('parses transferMode = "portable"', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`transferMode = "portable"`));

      const result = loadConfigFile(configPath);
      expect(result?.transferMode).toBe('portable');
    });

    it('throws on invalid transferMode', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`transferMode = "invalid"`));

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid transferMode value/);
    });

    // customBitrate tests
    it('parses customBitrate option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`customBitrate = 256`));

      const result = loadConfigFile(configPath);
      expect(result?.customBitrate).toBe(256);
    });

    it('throws on customBitrate below 64', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`customBitrate = 32`));

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid customBitrate/);
    });

    it('throws on customBitrate above 320', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`customBitrate = 400`));

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid customBitrate/);
    });

    // audioQuality tests
    it('parses audioQuality option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
audioQuality = "max"
`)
      );

      const result = loadConfigFile(configPath);
      expect(result?.audioQuality).toBe('max');
    });

    it('throws on invalid audioQuality', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
audioQuality = "invalid"
`)
      );

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid audioQuality/);
    });

    it('rejects invalid preset "lossless" for audioQuality', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`audioQuality = "lossless"`));

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid audioQuality/);
    });

    it('rejects invalid preset "high-cbr" for audioQuality', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`audioQuality = "high-cbr"`));

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid audioQuality/);
    });

    // root-level videoQuality tests
    it('parses root-level videoQuality option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
videoQuality = "medium"
`)
      );

      const result = loadConfigFile(configPath);
      expect(result?.videoQuality).toBe('medium');
    });

    it('throws on invalid root-level videoQuality', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
videoQuality = "invalid"
`)
      );

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid videoQuality value/);
    });

    it('handles empty config file', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v('# Empty config\n'));

      const result = loadConfigFile(configPath);
      expect(result).toEqual({});
    });

    it('throws on malformed TOML syntax', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
quality = "missing end quote
`)
      );

      expect(() => loadConfigFile(configPath)).toThrow();
    });

    it('ignores artwork with wrong type (string instead of boolean)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
artwork = "yes"
`)
      );

      const result = loadConfigFile(configPath);
      // String "yes" should not be parsed as artwork since type check is strict
      expect(result).toEqual({});
    });

    it('parses skipUpgrades = true', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`skipUpgrades = true`));

      const result = loadConfigFile(configPath);
      expect(result?.skipUpgrades).toBe(true);
    });

    it('parses skipUpgrades = false', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`skipUpgrades = false`));

      const result = loadConfigFile(configPath);
      expect(result?.skipUpgrades).toBe(false);
    });

    it('ignores skipUpgrades with wrong type (string instead of boolean)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`skipUpgrades = "yes"`));

      const result = loadConfigFile(configPath);
      // String "yes" should not be parsed as skipUpgrades since type check is strict
      expect(result).toEqual({});
    });

    it('parses allowEmptyPlaylist = true', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`allowEmptyPlaylist = true`));

      const result = loadConfigFile(configPath);
      expect(result?.allowEmptyPlaylist).toBe(true);
    });

    it('parses allowEmptyPlaylist = false', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`allowEmptyPlaylist = false`));

      const result = loadConfigFile(configPath);
      expect(result?.allowEmptyPlaylist).toBe(false);
    });

    it('ignores allowEmptyPlaylist with wrong type (string instead of boolean)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, v(`allowEmptyPlaylist = "yes"`));

      const result = loadConfigFile(configPath);
      // String "yes" should not be parsed as allowEmptyPlaylist since type check is strict
      expect(result).toEqual({});
    });

    describe('cleanArtists config', () => {
      it('parses [cleanArtists] table form with options', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
drop = false
format = "feat. {}"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms).toBeDefined();
        expect(result?.transforms?.cleanArtists).toEqual({
          enabled: true,
          drop: false,
          format: 'feat. {}',
          ignore: [],
        });
      });

      it('parses boolean shorthand (cleanArtists = true)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
cleanArtists = true
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.cleanArtists.enabled).toBe(true);
        // Other values should be defaults
        expect(result?.transforms?.cleanArtists.drop).toBe(false);
        expect(result?.transforms?.cleanArtists.format).toBe('feat. {}');
      });

      it('parses [cleanArtists] table form (implies enabled)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.cleanArtists.enabled).toBe(true);
      });

      it('parses [cleanArtists] with enabled = false', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
enabled = false
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.cleanArtists.enabled).toBe(false);
      });

      it('parses drop mode', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
drop = true
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.cleanArtists.drop).toBe(true);
      });

      it('parses custom format string', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
format = "with {}"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.cleanArtists.format).toBe('with {}');
      });

      it('throws on format without placeholder', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
format = "no placeholder here"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/must contain "{}"/);
      });

      it('throws on wrong type for enabled (string instead of boolean)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
enabled = "true"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "enabled"/);
      });

      it('throws on wrong type for drop (string instead of boolean)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
drop = "yes"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "drop"/);
      });

      it('throws on wrong type for format (number instead of string)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[cleanArtists]
format = 123
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "format"/);
      });

      it('returns defaults when cleanArtists not specified', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
quality = "high"
`)
        );

        const result = loadConfigFile(configPath);
        // transforms should not be in the result if not specified
        expect(result?.transforms).toBeUndefined();
      });
    });

    // =========================================================================
    // Multi-Collection/Device Tests (ADR-008)
    // =========================================================================

    describe('music collections', () => {
      it('parses single music collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.main]
path = "/Volumes/Media/music/library"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.music).toBeDefined();
        expect(result?.music?.main).toEqual({
          path: '/Volumes/Media/music/library',
          type: 'directory',
        });
      });

      it('parses multiple music collections', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.main]
path = "/Volumes/Media/music/library"

[music.dj]
path = "/Volumes/Media/dj-sets"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.music).toBeDefined();
        expect(Object.keys(result?.music ?? {})).toHaveLength(2);
        expect(result?.music?.main!.path).toBe('/Volumes/Media/music/library');
        expect(result?.music?.dj!.path).toBe('/Volumes/Media/dj-sets');
      });

      it('parses subsonic collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.work]
type = "subsonic"
url = "https://music.work.com"
username = "james"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.music?.work).toEqual({
          path: '',
          type: 'subsonic',
          url: 'https://music.work.com',
          username: 'james',
        });
      });

      it('throws on invalid collection type', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.main]
path = "/music"
type = "invalid"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type "invalid"/);
      });

      it('throws on missing path for directory collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.main]
# missing path
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "path"/);
      });

      it('throws on missing url for subsonic collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.work]
type = "subsonic"
username = "james"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "url"/);
      });

      it('throws on missing username for subsonic collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.work]
type = "subsonic"
url = "https://music.work.com"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "username"/);
      });

      it('parses subsonic collection with a playlist', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.workout]
type = "subsonic"
url = "https://music.work.com"
username = "james"
playlist = "Workout"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.music?.workout).toEqual({
          path: '',
          type: 'subsonic',
          url: 'https://music.work.com',
          username: 'james',
          playlist: 'Workout',
        });
      });

      it('rejects playlist on a directory collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.local]
path = "/music"
playlist = "Workout"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/"playlist" is only valid for subsonic/);
      });

      it('rejects an empty string playlist on a subsonic collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.nav]
type = "subsonic"
url = "https://music.example.com"
username = "james"
playlist = ""
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/must be a non-empty playlist name/);
      });

      it('rejects a whitespace-only playlist on a subsonic collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.nav]
type = "subsonic"
url = "https://music.example.com"
username = "james"
playlist = "   "
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/must be a non-empty playlist name/);
      });
    });

    describe('video collections', () => {
      it('parses single video collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[video.movies]
path = "/Volumes/Media/movies"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.video).toBeDefined();
        expect(result?.video?.movies).toEqual({
          path: '/Volumes/Media/movies',
        });
      });

      it('parses multiple video collections', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[video.movies]
path = "/Volumes/Media/movies"

[video.shows]
path = "/Volumes/Media/tv-shows"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.video).toBeDefined();
        expect(Object.keys(result?.video ?? {})).toHaveLength(2);
        expect(result?.video?.movies!.path).toBe('/Volumes/Media/movies');
        expect(result?.video?.shows!.path).toBe('/Volumes/Media/tv-shows');
      });

      it('throws on missing path for video collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[video.movies]
# missing path
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "path"/);
      });
    });

    describe('devices', () => {
      it('parses single device', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices).toBeDefined();
        expect(result?.devices?.terapod).toEqual({
          volumeUuid: 'ABC-123',
          volumeName: 'TERAPOD',
        });
      });

      it('parses device with all options', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "high"
audioQuality = "max"
videoQuality = "medium"
artwork = true
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod).toEqual({
          volumeUuid: 'ABC-123',
          volumeName: 'TERAPOD',
          quality: 'high',
          audioQuality: 'max',
          videoQuality: 'medium',
          artwork: true,
        });
      });

      it('parses device with cleanArtists', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"

[devices.terapod.cleanArtists]
format = "feat. {}"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod!.transforms).toBeDefined();
        expect(result?.devices?.terapod!.transforms?.cleanArtists!.enabled).toBe(true);
        expect(result?.devices?.terapod!.transforms?.cleanArtists!.format).toBe('feat. {}');
      });

      it('parses multiple devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "high"

[devices.nano]
volumeUuid = "DEF-456"
volumeName = "NANO"
quality = "low"
artwork = false
`)
        );

        const result = loadConfigFile(configPath);
        expect(Object.keys(result?.devices ?? {})).toHaveLength(2);
        expect(result?.devices?.terapod!.quality).toBe('high');
        expect(result?.devices?.nano!.quality).toBe('low');
        expect(result?.devices?.nano!.artwork).toBe(false);
      });

      it('allows device without volumeUuid', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeName = "TERAPOD"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod!.volumeUuid).toBeUndefined();
        expect(result?.devices?.terapod!.volumeName).toBe('TERAPOD');
      });

      it('allows device without volumeName', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod!.volumeUuid).toBe('ABC-123');
        expect(result?.devices?.terapod!.volumeName).toBeUndefined();
      });

      it('allows device with no volumeUuid or volumeName', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
quality = "high"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod!.volumeUuid).toBeUndefined();
        expect(result?.devices?.terapod!.volumeName).toBeUndefined();
        expect(result?.devices?.terapod!.quality).toBe('high');
      });

      it('throws on invalid quality', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "invalid"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid quality value "invalid"/);
      });

      it('throws on invalid videoQuality', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
videoQuality = "invalid"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid videoQuality value "invalid"/);
      });

      it('throws on invalid artwork type', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
artwork = "yes"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "artwork"/);
      });

      it('parses device skipUpgrades', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.nano]
volumeUuid = "ABC-123"
volumeName = "NANO"
skipUpgrades = true
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.nano!.skipUpgrades).toBe(true);
      });

      it('throws on invalid skipUpgrades type', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
skipUpgrades = "yes"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "skipUpgrades"/);
      });

      // -----------------------------------------------------------------------
      // DeviceConfig.unsupported — rich shape (TASK-317.03 follow-up)
      // -----------------------------------------------------------------------

      it('parses device unsupported as a rich inline-table object', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.touch1g]
volumeUuid = "TOUCH-UUID"
volumeName = "TOUCH"
unsupported = { kind = "ios-device", confirmedAt = "2026-05-16T11:30:00.000Z" }
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.touch1g?.unsupported).toEqual({
          kind: 'ios-device',
          confirmedAt: '2026-05-16T11:30:00.000Z',
        });
      });

      it('silently coerces legacy unsupported = true to the rich shape', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.olddevice]
volumeUuid = "OLD-UUID"
volumeName = "OLD"
unsupported = true
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.olddevice?.unsupported).toEqual({
          kind: 'unsupported-device',
          confirmedAt: new Date(0).toISOString(),
        });
      });

      it('does not set unsupported when legacy unsupported = false', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.supported]
volumeUuid = "SUP-UUID"
volumeName = "SUPPORTED"
unsupported = false
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.supported?.unsupported).toBeUndefined();
      });

      it('throws on an invalid unsupported.kind value', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.bad]
volumeUuid = "BAD-UUID"
unsupported = { kind = "totally-made-up", confirmedAt = "2026-05-16T11:30:00.000Z" }
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid "unsupported.kind" value/);
      });

      it('throws on an invalid unsupported.confirmedAt value', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.bad]
volumeUuid = "BAD-UUID"
unsupported = { kind = "ios-device", confirmedAt = "not-a-date" }
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid "unsupported.confirmedAt"/);
      });

      it('throws when unsupported is a string (not bool or table)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.bad]
volumeUuid = "BAD-UUID"
unsupported = "yes"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "unsupported"/);
      });

      it('parses device transferMode', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.nano]
volumeUuid = "ABC-123"
volumeName = "NANO"
transferMode = "portable"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.nano!.transferMode).toBe('portable');
      });

      it('throws on invalid device transferMode', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
transferMode = "invalid"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid transferMode value "invalid"/);
      });

      it('rejects capability overrides on iPod devices (type undefined)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
artworkMaxResolution = 600
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*artworkMaxResolution.*only valid for mass-storage/
        );
      });

      it('rejects capability overrides on explicit iPod type', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
type = "ipod"
supportedAudioCodecs = ["aac", "mp3", "flac"]
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*supportedAudioCodecs.*only valid for mass-storage/
        );
      });

      it('allows capability overrides on mass-storage devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.echo]
type = "echo-mini"
path = "/mnt/echo"
artworkMaxResolution = 800
supportedAudioCodecs = ["aac", "mp3"]
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.echo!.artworkMaxResolution).toBe(800);
        expect(result.devices!.echo!.supportedAudioCodecs).toEqual(['aac', 'mp3']);
      });

      describe('podkit-unsupported output codec warnings', () => {
        // The preset/raw capability data may legitimately list wav/aiff as
        // "device can play these natively". Podkit accepts the value (it's a
        // valid AudioCodec union member) so the device.info surface can show
        // device truth, but emits a warning at load time so the user knows
        // sources in those formats will be transcoded rather than direct-
        // copied. iPod is exempt (libgpod handles WAV/AIFF natively).
        function withCapturedWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
          const original = console.warn;
          const warnings: string[] = [];
          console.warn = (msg: unknown) => {
            warnings.push(String(msg));
          };
          try {
            return { result: fn(), warnings };
          } finally {
            console.warn = original;
          }
        }

        it('warns when echo-mini override includes wav', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.echo]
type = "echo-mini"
path = "/mnt/echo"
supportedAudioCodecs = ["aac", "mp3", "wav"]
`)
          );

          const { result, warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          // Config still loads successfully and preserves the user's value.
          expect(result!.devices!.echo!.supportedAudioCodecs).toEqual(['aac', 'mp3', 'wav']);
          // But the user got a warning naming wav specifically.
          const codecWarning = warnings.find((w) => w.includes('supportedAudioCodecs'));
          expect(codecWarning).toBeDefined();
          expect(codecWarning!).toContain('"wav"');
          expect(codecWarning!).toContain('transcoded');
          expect(codecWarning!).toContain('[devices.echo]');
        });

        it('warns when override includes both wav and aiff, naming both', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.dap]
type = "rockbox"
path = "/mnt/dap"
supportedAudioCodecs = ["wav", "aiff", "mp3"]
`)
          );

          const { warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          const codecWarning = warnings.find((w) => w.includes('supportedAudioCodecs'));
          expect(codecWarning).toBeDefined();
          expect(codecWarning!).toContain('"wav"');
          expect(codecWarning!).toContain('"aiff"');
        });

        it('does NOT warn when override contains only supported codecs', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.echo]
type = "echo-mini"
path = "/mnt/echo"
supportedAudioCodecs = ["aac", "mp3", "flac", "vorbis"]
`)
          );

          const { warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          expect(warnings.find((w) => w.includes('supportedAudioCodecs'))).toBeUndefined();
        });

        it('does NOT warn for iPod devices (wav/aiff are legitimate there)', () => {
          // iPod doesn't accept supportedAudioCodecs overrides at all, so this
          // case is unreachable via the [devices.X] path — capability
          // overrides on iPod throw. Instead exercise the implicit-iPod path
          // (no `type` field) which silently rejects the field upstream of
          // the warning. The contract is: no warning shall fire for iPod.
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
type = "ipod"
`)
          );

          const { warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          expect(warnings.find((w) => w.includes('supportedAudioCodecs'))).toBeUndefined();
        });
      });

      it('parses musicDir on mass-storage devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
musicDir = "MUSIC"
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.player!.musicDir).toBe('MUSIC');
      });

      it('rejects musicDir on iPod devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
musicDir = "MUSIC"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*musicDir.*only valid for mass-storage/
        );
      });

      it('accepts empty musicDir as root', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
musicDir = ""
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.player!.musicDir).toBe('');
      });

      it('parses moviesDir on mass-storage devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
moviesDir = "Films"
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.player!.moviesDir).toBe('Films');
      });

      it('parses tvShowsDir on mass-storage devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
tvShowsDir = "TV"
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.player!.tvShowsDir).toBe('TV');
      });

      it('rejects moviesDir on iPod devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
moviesDir = "Films"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*moviesDir.*only valid for mass-storage/
        );
      });

      it('rejects tvShowsDir on iPod devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
tvShowsDir = "TV"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*tvShowsDir.*only valid for mass-storage/
        );
      });

      it('parses pathTemplate on mass-storage devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
pathTemplate = "{artist}/{album}/{title}{ext}"
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.player!.pathTemplate).toBe('{artist}/{album}/{title}{ext}');
      });

      it('rejects pathTemplate on iPod devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
pathTemplate = "{artist}/{album}/{title}{ext}"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*pathTemplate.*only valid for mass-storage/
        );
      });

      it('rejects pathTemplate missing {title}', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
pathTemplate = "{artist}/{album}{ext}"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/pathTemplate.*must contain \{title\}/);
      });

      it('rejects pathTemplate missing {ext}', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
pathTemplate = "{artist}/{album}/{title}"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/pathTemplate.*must contain \{ext\}/);
      });

      it('rejects empty pathTemplate', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
pathTemplate = ""
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/pathTemplate.*must not be empty/);
      });

      it('rejects duplicate content paths', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
musicDir = "Media"
moviesDir = "Media"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Content path conflict/);
      });

      it('parses audioNormalization on mass-storage devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
audioNormalization = "replaygain"
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.player!.audioNormalization).toBe('replaygain');
      });

      it('rejects invalid audioNormalization value', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
audioNormalization = "invalid"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Invalid audioNormalization value "invalid"/
        );
      });

      it('rejects audioNormalization on iPod devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
audioNormalization = "none"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*audioNormalization.*only valid for mass-storage/
        );
      });

      it('parses supportsAlbumArtistBrowsing on mass-storage devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
supportsAlbumArtistBrowsing = false
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.devices!.player!.supportsAlbumArtistBrowsing).toBe(false);
      });

      it('rejects invalid supportsAlbumArtistBrowsing value', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.player]
type = "generic"
path = "/mnt/player"
supportsAlbumArtistBrowsing = "maybe"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Invalid type for "supportsAlbumArtistBrowsing"/
        );
      });

      it('rejects supportsAlbumArtistBrowsing on iPod devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[devices.terapod]
volumeUuid = "ABC-123"
supportsAlbumArtistBrowsing = false
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /Mass-storage settings.*supportsAlbumArtistBrowsing.*only valid for mass-storage/
        );
      });
    });

    describe('presets', () => {
      function withCapturedWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
        const original = console.warn;
        const warnings: string[] = [];
        console.warn = (msg: unknown) => {
          warnings.push(String(msg));
        };
        try {
          return { result: fn(), warnings };
        } finally {
          console.warn = original;
        }
      }

      it('parses a user preset extending a built-in', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.my-walkman]
extends = "generic"
manufacturer = "Sony"
productName = "NW-A105"
supportedAudioCodecs = ["aac", "flac", "mp3"]
artworkMaxResolution = 240
musicDir = "MUSIC"
`)
        );

        const result = loadConfigFile(configPath)!;
        const preset = result.presets!['my-walkman'];
        expect(preset).toBeDefined();
        expect(preset!.manufacturer).toBe('Sony');
        expect(preset!.productName).toBe('NW-A105');
        expect(preset!.supportedAudioCodecs).toEqual(['aac', 'flac', 'mp3']);
        expect(preset!.artworkMaxResolution).toBe(240);
        expect(preset!.contentPaths.musicDir).toBe('MUSIC');
        // Inherits from generic
        expect(preset!.supportsVideo).toBe(false);
        expect(preset!.audioNormalization).toBe('none');
      });

      it('parses a preset with no extends (falls back to generic baseline)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.minimal]
manufacturer = "Acme"
productName = "MP3Walk"
`)
        );

        const result = loadConfigFile(configPath)!;
        const preset = result.presets!['minimal'];
        expect(preset).toBeDefined();
        expect(preset!.manufacturer).toBe('Acme');
        expect(preset!.productName).toBe('MP3Walk');
        expect(preset!.supportedAudioCodecs).toEqual(['aac', 'mp3', 'flac']);
      });

      it('resolves user preset extending another user preset', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.base-dap]
extends = "generic"
manufacturer = "Acme"
productName = "Base"
supportedAudioCodecs = ["aac", "flac"]

[presets.deluxe-dap]
extends = "base-dap"
productName = "Deluxe"
artworkMaxResolution = 600
`)
        );

        const result = loadConfigFile(configPath)!;
        const deluxe = result.presets!['deluxe-dap'];
        expect(deluxe).toBeDefined();
        expect(deluxe!.manufacturer).toBe('Acme');
        expect(deluxe!.productName).toBe('Deluxe');
        expect(deluxe!.supportedAudioCodecs).toEqual(['aac', 'flac']);
        expect(deluxe!.artworkMaxResolution).toBe(600);
      });

      it('rejects a preset extending an unknown id with file context', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.broken]
extends = "no-such-preset"
manufacturer = "X"
productName = "Y"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /\[presets\.broken\].*extends.*no-such-preset/
        );
      });

      it('rejects a cycle in extends with file context', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.a]
extends = "b"
manufacturer = "A"
productName = "A"

[presets.b]
extends = "a"
manufacturer = "B"
productName = "B"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /(cycle|circular|unresolved).*\[presets\.(a|b)\]/i
        );
      });

      it('rejects collision with a built-in preset id', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.echo-mini]
manufacturer = "Knockoff"
productName = "Echo Mini Clone"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /\[presets\.echo-mini\].*(built-in|collides)/i
        );
      });

      it('rejects [presets.ipod] since ipod is not a mass-storage preset', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.ipod]
manufacturer = "Apple"
productName = "iPod"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/\[presets\.ipod\]/i);
      });

      it('rejects invalid codec name', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.bad]
extends = "generic"
manufacturer = "X"
productName = "Y"
supportedAudioCodecs = ["aac", "made-up-codec"]
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid audio codec.*made-up-codec/);
      });

      it('rejects invalid artwork source', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.bad]
extends = "generic"
manufacturer = "X"
productName = "Y"
artworkSources = ["random"]
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid artwork source.*random/);
      });

      it('rejects invalid audioNormalization', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.bad]
extends = "generic"
manufacturer = "X"
productName = "Y"
audioNormalization = "bogus"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid audioNormalization.*bogus/);
      });

      it('warns when preset supportedAudioCodecs includes wav', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.my-walkman]
extends = "generic"
manufacturer = "Sony"
productName = "NW-A105"
supportedAudioCodecs = ["aac", "mp3", "wav"]
`)
        );

        const { result, warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
        expect(result!.presets!['my-walkman']!.supportedAudioCodecs).toContain('wav');
        const codecWarning = warnings.find((w) => w.includes('supportedAudioCodecs'));
        expect(codecWarning).toBeDefined();
        expect(codecWarning!).toContain('"wav"');
        expect(codecWarning!).toContain('[presets.my-walkman]');
        expect(codecWarning!).toContain('transcoded');
      });

      it('warns naming both wav and aiff in a preset', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.dap]
extends = "rockbox"
manufacturer = "X"
productName = "Y"
supportedAudioCodecs = ["wav", "aiff", "mp3"]
`)
        );

        const { warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
        const codecWarning = warnings.find((w) => w.includes('supportedAudioCodecs'));
        expect(codecWarning).toBeDefined();
        expect(codecWarning!).toContain('"wav"');
        expect(codecWarning!).toContain('"aiff"');
      });

      it('does NOT warn when preset has only supported codecs', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.clean]
extends = "generic"
manufacturer = "X"
productName = "Y"
supportedAudioCodecs = ["aac", "mp3", "flac"]
`)
        );

        const { warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
        expect(warnings.find((w) => w.includes('supportedAudioCodecs'))).toBeUndefined();
      });

      it('rejects a preset extending itself with a targeted message', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.loop]
extends = "loop"
manufacturer = "X"
productName = "Y"
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(
          /\[presets\.loop\].*cannot extend itself/i
        );
      });

      it('trims whitespace around extends before lookup', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.tidy]
extends = "  generic  "
manufacturer = "Acme"
productName = "Tidy"
`)
        );

        const result = loadConfigFile(configPath)!;
        expect(result.presets!['tidy']).toBeDefined();
        expect(result.presets!['tidy']!.supportedAudioCodecs).toEqual(['aac', 'mp3', 'flac']);
      });

      it('rejects empty supportedAudioCodecs', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[presets.empty]
extends = "generic"
manufacturer = "X"
productName = "Y"
supportedAudioCodecs = []
`)
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Empty supportedAudioCodecs/);
      });
    });

    describe('defaults', () => {
      it('parses defaults section', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[music.main]
path = "/music"

[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"

[defaults]
music = "main"
device = "terapod"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.defaults).toEqual({
          music: 'main',
          device: 'terapod',
        });
      });

      it('parses defaults with video', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
[video.movies]
path = "/movies"

[defaults]
video = "movies"
`)
        );

        const result = loadConfigFile(configPath);
        expect(result?.defaults?.video).toBe('movies');
      });

      describe('per-device default collections', () => {
        function withCapturedWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
          const original = console.warn;
          const warnings: string[] = [];
          console.warn = (msg: unknown) => {
            warnings.push(String(msg));
          };
          try {
            return { result: fn(), warnings };
          } finally {
            console.warn = original;
          }
        }

        it('parses defaultMusic = "main" into nested defaults.music', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[music.main]
path = "/music"

[devices.terapod]
volumeUuid = "ABC-123"
defaultMusic = "main"
`)
          );

          const { result, warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          expect(result!.devices!.terapod!.defaults).toEqual({ music: 'main' });
          expect(warnings).toHaveLength(0);
        });

        it('parses defaultVideo = false into nested defaults.video === false', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultVideo = false
`)
          );

          const result = loadConfigFile(configPath);
          expect(result!.devices!.terapod!.defaults!.video).toBe(false);
        });

        it('parses defaultMusic = false into nested defaults.music === false', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultMusic = false
`)
          );

          const result = loadConfigFile(configPath);
          expect(result!.devices!.terapod!.defaults!.music).toBe(false);
        });

        it('parses both flat keys into a single nested defaults object', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[music.main]
path = "/music"

[video.movies]
path = "/movies"

[devices.terapod]
volumeUuid = "ABC-123"
defaultMusic = "main"
defaultVideo = false
`)
          );

          const result = loadConfigFile(configPath);
          expect(result!.devices!.terapod!.defaults).toEqual({
            music: 'main',
            video: false,
          });
        });

        it('leaves defaults undefined when neither flat key is present', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
`)
          );

          const result = loadConfigFile(configPath);
          expect(result!.devices!.terapod!.defaults).toBeUndefined();
        });

        it('throws on defaultMusic = true', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultMusic = true
`)
          );

          expect(() => loadConfigFile(configPath)).toThrow(
            /Invalid defaultMusic value in \[devices\.terapod\]\. Expected a collection name \(string\) or false\./
          );
        });

        it('throws on defaultMusic = 42 (number)', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultMusic = 42
`)
          );

          expect(() => loadConfigFile(configPath)).toThrow(
            /Invalid defaultMusic value in \[devices\.terapod\]/
          );
        });

        it('throws on defaultVideo = array', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultVideo = ["a", "b"]
`)
          );

          expect(() => loadConfigFile(configPath)).toThrow(
            /Invalid defaultVideo value in \[devices\.terapod\]/
          );
        });

        it('warns (non-throwing) when defaultMusic references a non-existent collection', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultMusic = "ghost"
`)
          );

          const { result, warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          // Config still loads and preserves the value.
          expect(result!.devices!.terapod!.defaults!.music).toBe('ghost');
          const warning = warnings.find((w) => w.includes('devices.terapod.defaultMusic'));
          expect(warning).toBeDefined();
          expect(warning!).toContain('references a non-existent music collection');
        });

        it('warns (non-throwing) when defaultVideo references a non-existent collection', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultVideo = "ghost"
`)
          );

          const { result, warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          expect(result!.devices!.terapod!.defaults!.video).toBe('ghost');
          const warning = warnings.find((w) => w.includes('devices.terapod.defaultVideo'));
          expect(warning).toBeDefined();
          expect(warning!).toContain('references a non-existent video collection');
        });

        it('does NOT warn on defaultVideo = false even with no video collections', () => {
          const configPath = path.join(tempDir, 'config.toml');
          fs.writeFileSync(
            configPath,
            v(`
[devices.terapod]
volumeUuid = "ABC-123"
defaultVideo = false
`)
          );

          const { warnings } = withCapturedWarnings(() => loadConfigFile(configPath));
          expect(warnings.filter((w) => w.includes('defaultVideo'))).toHaveLength(0);
        });
      });
    });

    describe('complete config (ADR-008)', () => {
      it('parses complete ADR-008 example config', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          v(`
# Music collections
[music.main]
path = "/Volumes/Media/music/library"

[music.dj]
path = "/Volumes/Media/dj-sets"

[music.work]
type = "subsonic"
url = "https://music.work.com"
username = "james"

# Video collections
[video.movies]
path = "/Volumes/Media/movies"

[video.shows]
path = "/Volumes/Media/tv-shows"

# Devices
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "high"
videoQuality = "high"
artwork = true

[devices.terapod.cleanArtists]
format = "feat. {}"

[devices.nano]
volumeUuid = "DEF-456"
volumeName = "NANO"
quality = "low"
artwork = false

# Defaults
[defaults]
music = "main"
video = "movies"
device = "terapod"
`)
        );

        const result = loadConfigFile(configPath);

        // Music collections
        expect(Object.keys(result?.music ?? {})).toHaveLength(3);
        expect(result?.music?.main!.type).toBe('directory');
        expect(result?.music?.work!.type).toBe('subsonic');
        expect(result?.music?.work!.url).toBe('https://music.work.com');

        // Video collections
        expect(Object.keys(result?.video ?? {})).toHaveLength(2);
        expect(result?.video?.movies!.path).toBe('/Volumes/Media/movies');

        // Devices
        expect(Object.keys(result?.devices ?? {})).toHaveLength(2);
        expect(result?.devices?.terapod!.quality).toBe('high');
        expect(result?.devices?.terapod!.transforms?.cleanArtists!.enabled).toBe(true);
        expect(result?.devices?.nano!.artwork).toBe(false);

        // Defaults
        expect(result?.defaults?.music).toBe('main');
        expect(result?.defaults?.video).toBe('movies');
        expect(result?.defaults?.device).toBe('terapod');
      });
    });
  });

  describe('loadEnvConfig', () => {
    it('returns empty config when no env vars set', () => {
      const result = loadEnvConfig();
      expect(result).toEqual({});
    });

    it('reads PODKIT_QUALITY with valid value', () => {
      process.env[ENV_KEYS.quality] = 'low';
      const result = loadEnvConfig();
      expect(result.quality).toBe('low');
    });

    it('ignores PODKIT_QUALITY with invalid value', () => {
      process.env[ENV_KEYS.quality] = 'invalid';
      const result = loadEnvConfig();
      expect(result.quality).toBeUndefined();
    });

    // All quality presets via env
    const envPresets = ['max', 'high', 'medium', 'low'] as const;
    for (const preset of envPresets) {
      it(`reads PODKIT_QUALITY=${preset}`, () => {
        process.env[ENV_KEYS.quality] = preset;
        const result = loadEnvConfig();
        expect(result.quality).toBe(preset);
      });
    }

    it('ignores invalid preset via PODKIT_QUALITY', () => {
      process.env[ENV_KEYS.quality] = 'lossless';
      const result = loadEnvConfig();
      expect(result.quality).toBeUndefined();
    });

    it('reads PODKIT_ARTWORK=true', () => {
      process.env[ENV_KEYS.artwork] = 'true';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(true);
    });

    it('reads PODKIT_ARTWORK=false', () => {
      process.env[ENV_KEYS.artwork] = 'false';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(false);
    });

    it('reads PODKIT_ARTWORK=1 as true', () => {
      process.env[ENV_KEYS.artwork] = '1';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(true);
    });

    it('reads PODKIT_ARTWORK=yes as true', () => {
      process.env[ENV_KEYS.artwork] = 'yes';
      const result = loadEnvConfig();
      expect(result.artwork).toBe(true);
    });

    it('reads PODKIT_ALLOW_EMPTY_PLAYLIST=true', () => {
      process.env[ENV_KEYS.allowEmptyPlaylist] = 'true';
      try {
        const result = loadEnvConfig();
        expect(result.allowEmptyPlaylist).toBe(true);
      } finally {
        delete process.env[ENV_KEYS.allowEmptyPlaylist];
      }
    });

    it('reads PODKIT_ALLOW_EMPTY_PLAYLIST=false', () => {
      process.env[ENV_KEYS.allowEmptyPlaylist] = 'false';
      try {
        const result = loadEnvConfig();
        expect(result.allowEmptyPlaylist).toBe(false);
      } finally {
        delete process.env[ENV_KEYS.allowEmptyPlaylist];
      }
    });

    it('reads PODKIT_AUDIO_QUALITY with valid value', () => {
      process.env[ENV_KEYS.audioQuality] = 'max';
      const result = loadEnvConfig();
      expect(result.audioQuality).toBe('max');
    });

    it('ignores PODKIT_AUDIO_QUALITY with invalid value', () => {
      process.env[ENV_KEYS.audioQuality] = 'invalid';
      const result = loadEnvConfig();
      expect(result.audioQuality).toBeUndefined();
    });

    it('reads PODKIT_VIDEO_QUALITY with valid value', () => {
      process.env[ENV_KEYS.videoQuality] = 'medium';
      const result = loadEnvConfig();
      expect(result.videoQuality).toBe('medium');
    });

    it('ignores PODKIT_VIDEO_QUALITY with invalid value', () => {
      process.env[ENV_KEYS.videoQuality] = 'invalid';
      const result = loadEnvConfig();
      expect(result.videoQuality).toBeUndefined();
    });

    it('reads PODKIT_ENCODING with valid value', () => {
      process.env[ENV_KEYS.encoding] = 'cbr';
      const result = loadEnvConfig();
      expect(result.encoding).toBe('cbr');
    });

    it('ignores PODKIT_ENCODING with invalid value', () => {
      process.env[ENV_KEYS.encoding] = 'abr';
      const result = loadEnvConfig();
      expect(result.encoding).toBeUndefined();
    });

    it('reads PODKIT_TRANSFER_MODE with valid value', () => {
      process.env[ENV_KEYS.transferMode] = 'portable';
      const result = loadEnvConfig();
      expect(result.transferMode).toBe('portable');
    });

    it('ignores PODKIT_TRANSFER_MODE with invalid value', () => {
      process.env[ENV_KEYS.transferMode] = 'invalid';
      const result = loadEnvConfig();
      expect(result.transferMode).toBeUndefined();
    });

    it('reads PODKIT_CUSTOM_BITRATE with valid value', () => {
      process.env[ENV_KEYS.customBitrate] = '256';
      const result = loadEnvConfig();
      expect(result.customBitrate).toBe(256);
    });

    it('ignores PODKIT_CUSTOM_BITRATE with invalid value', () => {
      process.env[ENV_KEYS.customBitrate] = '999';
      const result = loadEnvConfig();
      expect(result.customBitrate).toBeUndefined();
    });

    it('reads PODKIT_BITRATE_TOLERANCE into [bitrate].tolerance', () => {
      process.env[ENV_KEYS.bitrateTolerance] = '0.4';
      const result = loadEnvConfig();
      expect(result.bitrate?.tolerance).toBe(0.4);
    });

    it('ignores PODKIT_BITRATE_TOLERANCE with a negative value', () => {
      process.env[ENV_KEYS.bitrateTolerance] = '-0.1';
      const result = loadEnvConfig();
      expect(result.bitrate?.tolerance).toBeUndefined();
    });

    it('reads PODKIT_BITRATE_REDUCE into [bitrate].reduce', () => {
      process.env[ENV_KEYS.bitrateReduce] = 'always';
      const result = loadEnvConfig();
      expect(result.bitrate?.reduce).toBe('always');
    });

    it('ignores PODKIT_BITRATE_REDUCE with an invalid value', () => {
      process.env[ENV_KEYS.bitrateReduce] = 'sometimes';
      const result = loadEnvConfig();
      expect(result.bitrate?.reduce).toBeUndefined();
    });

    it('reads PODKIT_CLEAN_ARTISTS=true', () => {
      process.env[ENV_KEYS.cleanArtists] = 'true';
      const result = loadEnvConfig();
      expect(result.transforms?.cleanArtists.enabled).toBe(true);
    });

    it('reads PODKIT_CLEAN_ARTISTS=false', () => {
      process.env[ENV_KEYS.cleanArtists] = 'false';
      const result = loadEnvConfig();
      expect(result.transforms?.cleanArtists.enabled).toBe(false);
    });

    it('reads PODKIT_CLEAN_ARTISTS_DROP=true', () => {
      process.env[ENV_KEYS.cleanArtistsDrop] = 'true';
      const result = loadEnvConfig();
      expect(result.transforms?.cleanArtists.drop).toBe(true);
    });

    it('reads PODKIT_CLEAN_ARTISTS_FORMAT', () => {
      process.env[ENV_KEYS.cleanArtistsFormat] = 'featuring {}';
      const result = loadEnvConfig();
      expect(result.transforms?.cleanArtists.format).toBe('featuring {}');
    });

    it('reads PODKIT_CLEAN_ARTISTS_IGNORE as comma-separated list', () => {
      process.env[ENV_KEYS.cleanArtistsIgnore] = 'Simon & Garfunkel, Hall & Oates';
      const result = loadEnvConfig();
      expect(result.transforms?.cleanArtists.ignore).toEqual(['Simon & Garfunkel', 'Hall & Oates']);
    });

    it('handles empty PODKIT_CLEAN_ARTISTS_IGNORE', () => {
      process.env[ENV_KEYS.cleanArtistsIgnore] = '';
      const result = loadEnvConfig();
      expect(result.transforms?.cleanArtists.ignore).toEqual([]);
    });

    it('does not set transforms when no clean artists env vars present', () => {
      const result = loadEnvConfig();
      expect(result.transforms).toBeUndefined();
    });

    it('sets only specified clean artists fields', () => {
      process.env[ENV_KEYS.cleanArtistsDrop] = 'true';
      const result = loadEnvConfig();
      // drop is set, but enabled inherits default (false)
      expect(result.transforms?.cleanArtists.drop).toBe(true);
      expect(result.transforms?.cleanArtists.enabled).toBe(false);
    });

    // =========================================================================
    // Device env vars
    // =========================================================================

    describe('mass-storage device env vars', () => {
      it('declares a device from PODKIT_DEVICE_PATH with generic preset and sets it default', () => {
        process.env.PODKIT_DEVICE_PATH = '/devices/player';
        const result = loadEnvConfig();
        expect(result.devices).toEqual({
          default: { type: 'generic', path: '/devices/player' },
        });
        expect(result.defaults?.device).toBe('default');
      });

      it('honours PODKIT_DEVICE_TYPE and PODKIT_DEVICE_NAME', () => {
        process.env.PODKIT_DEVICE_PATH = '/devices/echo';
        process.env.PODKIT_DEVICE_TYPE = 'echo-mini';
        process.env.PODKIT_DEVICE_NAME = 'MY_ECHO';
        const result = loadEnvConfig();
        expect(result.devices).toEqual({
          'my-echo': { type: 'echo-mini', path: '/devices/echo' },
        });
        expect(result.defaults?.device).toBe('my-echo');
      });

      it('declares nothing without PODKIT_DEVICE_PATH', () => {
        process.env.PODKIT_DEVICE_TYPE = 'echo-mini';
        const result = loadEnvConfig();
        expect(result.devices).toBeUndefined();
        expect(result.defaults?.device).toBeUndefined();
      });
    });

    // =========================================================================
    // Collection env vars
    // =========================================================================

    describe('music collection env vars', () => {
      it('creates unnamed directory collection from PODKIT_MUSIC_PATH', () => {
        process.env.PODKIT_MUSIC_PATH = '/music';
        const result = loadEnvConfig();
        expect(result.music).toEqual({
          default: { path: '/music', type: 'directory' },
        });
        expect(result.defaults?.music).toBe('default');
      });

      it('creates named directory collection from PODKIT_MUSIC_MAIN_PATH', () => {
        process.env.PODKIT_MUSIC_MAIN_PATH = '/music';
        const result = loadEnvConfig();
        expect(result.music).toEqual({
          main: { path: '/music', type: 'directory' },
        });
        expect(result.defaults?.music).toBe('main');
      });

      it('creates unnamed subsonic collection', () => {
        process.env.PODKIT_MUSIC_TYPE = 'subsonic';
        process.env.PODKIT_MUSIC_URL = 'https://navidrome.example.com';
        process.env.PODKIT_MUSIC_USERNAME = 'user';
        process.env.PODKIT_MUSIC_PASSWORD = 'secret';
        const result = loadEnvConfig();
        expect(result.music).toEqual({
          default: {
            path: '',
            type: 'subsonic',
            url: 'https://navidrome.example.com',
            username: 'user',
            password: 'secret',
          },
        });
      });

      it('creates named subsonic collection', () => {
        process.env.PODKIT_MUSIC_NAVIDROME_TYPE = 'subsonic';
        process.env.PODKIT_MUSIC_NAVIDROME_URL = 'https://navidrome.example.com';
        process.env.PODKIT_MUSIC_NAVIDROME_USERNAME = 'user';
        process.env.PODKIT_MUSIC_NAVIDROME_PASSWORD = 'secret';
        const result = loadEnvConfig();
        expect(result.music?.navidrome).toEqual({
          path: '',
          type: 'subsonic',
          url: 'https://navidrome.example.com',
          username: 'user',
          password: 'secret',
        });
      });

      it('creates named subsonic collection with a playlist', () => {
        process.env.PODKIT_MUSIC_WORKOUT_TYPE = 'subsonic';
        process.env.PODKIT_MUSIC_WORKOUT_URL = 'https://navidrome.example.com';
        process.env.PODKIT_MUSIC_WORKOUT_USERNAME = 'user';
        process.env.PODKIT_MUSIC_WORKOUT_PASSWORD = 'secret';
        process.env.PODKIT_MUSIC_WORKOUT_PLAYLIST = 'Workout';
        const result = loadEnvConfig();
        expect(result.music?.workout).toEqual({
          path: '',
          type: 'subsonic',
          url: 'https://navidrome.example.com',
          username: 'user',
          password: 'secret',
          playlist: 'Workout',
        });
      });

      it('creates multiple named collections', () => {
        process.env.PODKIT_MUSIC_MAIN_PATH = '/music/library';
        process.env.PODKIT_MUSIC_VINYL_PATH = '/music/vinyl';
        const result = loadEnvConfig();
        expect(result.music).toEqual({
          main: { path: '/music/library', type: 'directory' },
          vinyl: { path: '/music/vinyl', type: 'directory' },
        });
        // Multiple collections: no auto-default
        expect(result.defaults?.music).toBeUndefined();
      });

      it('converts env var name to kebab-case config name', () => {
        process.env.PODKIT_MUSIC_MY_SERVER_PATH = '/music';
        const result = loadEnvConfig();
        expect(result.music?.['my-server']).toEqual({
          path: '/music',
          type: 'directory',
        });
      });

      it('skips directory collection without PATH', () => {
        process.env.PODKIT_MUSIC_TYPE = 'directory';
        const result = loadEnvConfig();
        expect(result.music).toBeUndefined();
      });

      it('throws when PLAYLIST is set on a directory collection', () => {
        process.env.PODKIT_MUSIC_PATH = '/music';
        process.env.PODKIT_MUSIC_PLAYLIST = 'Workout';
        // TYPE defaults to 'directory' when not set to 'subsonic'
        expect(() => loadEnvConfig()).toThrow(/"playlist" is only valid for subsonic/);
      });

      it('throws when PLAYLIST is set on a named directory collection', () => {
        process.env.PODKIT_MUSIC_LOCAL_PATH = '/music';
        process.env.PODKIT_MUSIC_LOCAL_PLAYLIST = 'Workout';
        expect(() => loadEnvConfig()).toThrow(/"playlist" is only valid for subsonic/);
      });

      it('skips subsonic collection without URL', () => {
        process.env.PODKIT_MUSIC_TYPE = 'subsonic';
        process.env.PODKIT_MUSIC_USERNAME = 'user';
        const result = loadEnvConfig();
        expect(result.music).toBeUndefined();
      });

      it('skips subsonic collection without USERNAME', () => {
        process.env.PODKIT_MUSIC_TYPE = 'subsonic';
        process.env.PODKIT_MUSIC_URL = 'https://example.com';
        const result = loadEnvConfig();
        expect(result.music).toBeUndefined();
      });

      it('ignores env vars that do not match known fields', () => {
        process.env.PODKIT_MUSIC_FOO = 'bar';
        const result = loadEnvConfig();
        expect(result.music).toBeUndefined();
      });

      it('subsonic collection with path', () => {
        process.env.PODKIT_MUSIC_TYPE = 'subsonic';
        process.env.PODKIT_MUSIC_URL = 'https://example.com';
        process.env.PODKIT_MUSIC_USERNAME = 'user';
        process.env.PODKIT_MUSIC_PATH = '/cache';
        const result = loadEnvConfig();
        expect(result.music?.default?.path).toBe('/cache');
      });
    });

    describe('video collection env vars', () => {
      it('creates unnamed video collection from PODKIT_VIDEO_PATH', () => {
        process.env.PODKIT_VIDEO_PATH = '/videos';
        const result = loadEnvConfig();
        expect(result.video).toEqual({
          default: { path: '/videos' },
        });
        expect(result.defaults?.video).toBe('default');
      });

      it('creates named video collection from PODKIT_VIDEO_MOVIES_PATH', () => {
        process.env.PODKIT_VIDEO_MOVIES_PATH = '/movies';
        const result = loadEnvConfig();
        expect(result.video).toEqual({
          movies: { path: '/movies' },
        });
      });

      it('auto-defaults single video collection', () => {
        process.env.PODKIT_VIDEO_MOVIES_PATH = '/movies';
        const result = loadEnvConfig();
        expect(result.defaults?.video).toBe('movies');
      });

      it('does not auto-default multiple video collections', () => {
        process.env.PODKIT_VIDEO_MOVIES_PATH = '/movies';
        process.env.PODKIT_VIDEO_SHOWS_PATH = '/shows';
        const result = loadEnvConfig();
        expect(result.defaults?.video).toBeUndefined();
      });
    });

    describe('mixed collection env vars', () => {
      it('creates both music and video collections', () => {
        process.env.PODKIT_MUSIC_PATH = '/music';
        process.env.PODKIT_VIDEO_PATH = '/videos';
        const result = loadEnvConfig();
        expect(result.music?.default?.path).toBe('/music');
        expect(result.video?.default?.path).toBe('/videos');
        expect(result.defaults?.music).toBe('default');
        expect(result.defaults?.video).toBe('default');
      });

      it('returns no collections when no collection env vars set', () => {
        const result = loadEnvConfig();
        expect(result.music).toBeUndefined();
        expect(result.video).toBeUndefined();
      });
    });

    describe('device defaults', () => {
      it('parses PODKIT_ARTWORK_MAX_RESOLUTION', () => {
        process.env[ENV_KEYS.artworkMaxResolution] = '800';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.artworkMaxResolution).toBe(800);
        delete process.env[ENV_KEYS.artworkMaxResolution];
      });

      it('ignores invalid PODKIT_ARTWORK_MAX_RESOLUTION', () => {
        process.env[ENV_KEYS.artworkMaxResolution] = 'abc';
        const result = loadEnvConfig();
        expect(result.deviceDefaults).toBeUndefined();
        delete process.env[ENV_KEYS.artworkMaxResolution];
      });

      it('parses PODKIT_ARTWORK_SOURCES as comma-separated list', () => {
        process.env[ENV_KEYS.artworkSources] = 'embedded,sidecar';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.artworkSources).toEqual(['embedded', 'sidecar']);
        delete process.env[ENV_KEYS.artworkSources];
      });

      it('ignores PODKIT_ARTWORK_SOURCES with invalid values', () => {
        process.env[ENV_KEYS.artworkSources] = 'embedded,invalid';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.artworkSources).toBeUndefined();
        delete process.env[ENV_KEYS.artworkSources];
      });

      it('parses PODKIT_SUPPORTED_AUDIO_CODECS as comma-separated list', () => {
        process.env[ENV_KEYS.supportedAudioCodecs] = 'aac,mp3,flac';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.supportedAudioCodecs).toEqual(['aac', 'mp3', 'flac']);
        delete process.env[ENV_KEYS.supportedAudioCodecs];
      });

      it('parses PODKIT_SUPPORTS_VIDEO', () => {
        process.env[ENV_KEYS.supportsVideo] = 'true';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.supportsVideo).toBe(true);
        delete process.env[ENV_KEYS.supportsVideo];
      });

      it('parses PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING', () => {
        process.env[ENV_KEYS.supportsAlbumArtistBrowsing] = 'true';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.supportsAlbumArtistBrowsing).toBe(true);
        delete process.env[ENV_KEYS.supportsAlbumArtistBrowsing];
      });

      it('parses PODKIT_SUPPORTS_ALBUM_ARTIST_BROWSING = false', () => {
        process.env[ENV_KEYS.supportsAlbumArtistBrowsing] = 'false';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.supportsAlbumArtistBrowsing).toBe(false);
        delete process.env[ENV_KEYS.supportsAlbumArtistBrowsing];
      });

      it('parses PODKIT_MUSIC_DIR', () => {
        process.env[ENV_KEYS.musicDir] = 'MUSIC';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.musicDir).toBe('MUSIC');
        delete process.env[ENV_KEYS.musicDir];
      });

      it('accepts empty PODKIT_MUSIC_DIR as root', () => {
        process.env[ENV_KEYS.musicDir] = '';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.musicDir).toBe('');
        delete process.env[ENV_KEYS.musicDir];
      });

      it('parses PODKIT_MOVIES_DIR', () => {
        process.env[ENV_KEYS.moviesDir] = 'Films';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.moviesDir).toBe('Films');
        delete process.env[ENV_KEYS.moviesDir];
      });

      it('parses PODKIT_TV_SHOWS_DIR', () => {
        process.env[ENV_KEYS.tvShowsDir] = 'TV';
        const result = loadEnvConfig();
        expect(result.deviceDefaults?.tvShowsDir).toBe('TV');
        delete process.env[ENV_KEYS.tvShowsDir];
      });

      it('parses PODKIT_PATH_TEMPLATE', () => {
        process.env[ENV_KEYS.pathTemplate] = '{artist}/{album}/{title}{ext}';
        try {
          const result = loadEnvConfig();
          expect(result.deviceDefaults?.pathTemplate).toBe('{artist}/{album}/{title}{ext}');
        } finally {
          delete process.env[ENV_KEYS.pathTemplate];
        }
      });

      it('rejects PODKIT_PATH_TEMPLATE missing required variables', () => {
        process.env[ENV_KEYS.pathTemplate] = '{artist}/{album}';
        try {
          expect(() => loadEnvConfig()).toThrow(/pathTemplate.*must contain \{title\}/);
        } finally {
          delete process.env[ENV_KEYS.pathTemplate];
        }
      });

      it('returns no deviceDefaults when no device env vars set', () => {
        const result = loadEnvConfig();
        expect(result.deviceDefaults).toBeUndefined();
      });
    });
  });

  describe('loadCliConfig', () => {
    it('returns empty config with no options', () => {
      expect(loadCliConfig()).toEqual({});
    });

    it('extracts quality from command options', () => {
      expect(loadCliConfig({ quality: 'low' }).quality).toBe('low');
    });

    it('extracts artwork from command options', () => {
      expect(loadCliConfig({ artwork: false }).artwork).toBe(false);
    });

    it('extracts skipUpgrades from command options', () => {
      expect(loadCliConfig({ skipUpgrades: true }).skipUpgrades).toBe(true);
    });

    it('ignores invalid quality in command options', () => {
      expect(loadCliConfig({ quality: 'invalid' }).quality).toBeUndefined();
    });

    // All quality presets via CLI
    const cliPresets = ['max', 'high', 'medium', 'low'] as const;
    for (const preset of cliPresets) {
      it(`extracts quality = "${preset}" from command options`, () => {
        expect(loadCliConfig({ quality: preset }).quality).toBe(preset);
      });
    }

    // encoding option via CLI
    it('extracts encoding from command options', () => {
      expect(loadCliConfig({ encoding: 'cbr' }).encoding).toBe('cbr');
    });

    it('ignores invalid encoding in command options', () => {
      expect(loadCliConfig({ encoding: 'invalid' }).encoding).toBeUndefined();
    });

    // audioQuality option via CLI
    it('extracts audioQuality from command options', () => {
      expect(loadCliConfig({ audioQuality: 'max' }).audioQuality).toBe('max');
    });

    // videoQuality option via CLI
    it('extracts videoQuality from command options', () => {
      expect(loadCliConfig({ videoQuality: 'medium' }).videoQuality).toBe('medium');
    });
  });

  describe('mergeConfigs', () => {
    it('starts with defaults', () => {
      const result = mergeConfigs();
      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('merges single partial config', () => {
      const partial: PartialConfig = { quality: 'low' };
      const result = mergeConfigs(partial);
      expect(result.quality).toBe('low');
      expect(result.artwork).toBe(true); // default preserved
    });

    it('later configs override earlier ones', () => {
      const first: PartialConfig = { quality: 'low', artwork: false };
      const second: PartialConfig = { quality: 'high' };
      const result = mergeConfigs(first, second);
      expect(result.quality).toBe('high');
      expect(result.artwork).toBe(false); // from first, not overwritten
    });

    it('preserves undefined values (does not override with undefined)', () => {
      const first: PartialConfig = { quality: 'low' };
      const second: PartialConfig = {}; // no quality
      const result = mergeConfigs(first, second);
      expect(result.quality).toBe('low');
    });

    it('merges the global bitrate reduction block field-by-field', () => {
      // Regression: the global [bitrate] block must survive merging — otherwise
      // a top-level `reduce` setting is silently dropped and never resolves.
      const first: PartialConfig = { bitrate: { reduce: 'never', tolerance: 0.1 } };
      const second: PartialConfig = { bitrate: { reduce: 'always' } };
      const result = mergeConfigs(first, second);
      expect(result.bitrate?.reduce).toBe('always'); // later layer wins
      expect(result.bitrate?.tolerance).toBe(0.1); // untouched field preserved
    });

    it('merges a per-device bitrate block field-by-field', () => {
      // Same survival guarantee as the global block: a later layer overriding
      // one device bitrate field must not clobber another layer's fields.
      const first: PartialConfig = {
        devices: { terapod: { bitrate: { reduce: 'never', tolerance: 0.1 } } },
      };
      const second: PartialConfig = {
        devices: { terapod: { bitrate: { reduce: 'always' } } },
      };
      const result = mergeConfigs(first, second);
      expect(result.devices?.terapod?.bitrate?.reduce).toBe('always'); // later layer wins
      expect(result.devices?.terapod?.bitrate?.tolerance).toBe(0.1); // untouched field preserved
    });

    it('merges skipUpgrades from partial config', () => {
      const partial: PartialConfig = { skipUpgrades: true };
      const result = mergeConfigs(partial);
      expect(result.skipUpgrades).toBe(true);
    });

    it('later skipUpgrades overrides earlier', () => {
      const first: PartialConfig = { skipUpgrades: true };
      const second: PartialConfig = { skipUpgrades: false };
      const result = mergeConfigs(first, second);
      expect(result.skipUpgrades).toBe(false);
    });

    it('skipUpgrades defaults to undefined when not set', () => {
      const result = mergeConfigs();
      expect(result.skipUpgrades).toBeUndefined();
    });

    it('merges allowEmptyPlaylist from partial config', () => {
      const partial: PartialConfig = { allowEmptyPlaylist: true };
      const result = mergeConfigs(partial);
      expect(result.allowEmptyPlaylist).toBe(true);
    });

    it('later allowEmptyPlaylist overrides earlier', () => {
      const first: PartialConfig = { allowEmptyPlaylist: true };
      const second: PartialConfig = { allowEmptyPlaylist: false };
      const result = mergeConfigs(first, second);
      expect(result.allowEmptyPlaylist).toBe(false);
    });

    it('allowEmptyPlaylist defaults to undefined when not set', () => {
      const result = mergeConfigs();
      expect(result.allowEmptyPlaylist).toBeUndefined();
    });

    it('merges transferMode from partial config', () => {
      const partial: PartialConfig = { transferMode: 'portable' };
      const result = mergeConfigs(partial);
      expect(result.transferMode).toBe('portable');
    });

    it('later transferMode overrides earlier', () => {
      const first: PartialConfig = { transferMode: 'portable' };
      const second: PartialConfig = { transferMode: 'optimized' };
      const result = mergeConfigs(first, second);
      expect(result.transferMode).toBe('optimized');
    });

    it('transferMode defaults to undefined when not set', () => {
      const result = mergeConfigs();
      expect(result.transferMode).toBeUndefined();
    });

    describe('transforms merging', () => {
      it('includes default transforms config', () => {
        const result = mergeConfigs();
        expect(result.transforms).toEqual(DEFAULT_TRANSFORMS_CONFIG);
      });

      it('merges transforms config from partial', () => {
        const partial: PartialConfig = {
          transforms: {
            cleanArtists: {
              enabled: true,
              drop: false,
              format: 'feat. {}',
              ignore: [],
            },
          },
        };
        const result = mergeConfigs(partial);
        expect(result.transforms.cleanArtists.enabled).toBe(true);
      });

      it('deep merges transforms (later configs override all fields)', () => {
        const first: PartialConfig = {
          transforms: {
            cleanArtists: {
              enabled: false,
              drop: false,
              format: 'ft. {}',
              ignore: [],
            },
          },
        };
        const second: PartialConfig = {
          transforms: {
            cleanArtists: {
              enabled: true,
              drop: true,
              format: 'feat. {}',
              ignore: [],
            },
          },
        };
        const result = mergeConfigs(first, second);
        expect(result.transforms.cleanArtists.enabled).toBe(true);
        expect(result.transforms.cleanArtists.drop).toBe(true);
        expect(result.transforms.cleanArtists.format).toBe('feat. {}');
      });

      it('preserves default transforms when partial has none', () => {
        const partial: PartialConfig = { quality: 'low' };
        const result = mergeConfigs(partial);
        expect(result.transforms).toEqual(DEFAULT_TRANSFORMS_CONFIG);
      });
    });

    // =========================================================================
    // Multi-Collection/Device Merging Tests (ADR-008)
    // =========================================================================

    describe('music collections merging', () => {
      it('merges music collections by name', () => {
        const first: PartialConfig = {
          music: {
            main: { path: '/music/main', type: 'directory' },
          },
        };
        const second: PartialConfig = {
          music: {
            dj: { path: '/music/dj', type: 'directory' },
          },
        };
        const result = mergeConfigs(first, second);
        expect(Object.keys(result.music ?? {})).toHaveLength(2);
        expect(result.music?.main!.path).toBe('/music/main');
        expect(result.music?.dj!.path).toBe('/music/dj');
      });

      it('later config overrides same-named collection', () => {
        const first: PartialConfig = {
          music: {
            main: { path: '/old/music', type: 'directory' },
          },
        };
        const second: PartialConfig = {
          music: {
            main: { path: '/new/music', type: 'directory' },
          },
        };
        const result = mergeConfigs(first, second);
        expect(result.music?.main!.path).toBe('/new/music');
      });
    });

    describe('video collections merging', () => {
      it('merges video collections by name', () => {
        const first: PartialConfig = {
          video: {
            movies: { path: '/movies' },
          },
        };
        const second: PartialConfig = {
          video: {
            shows: { path: '/tv-shows' },
          },
        };
        const result = mergeConfigs(first, second);
        expect(Object.keys(result.video ?? {})).toHaveLength(2);
        expect(result.video?.movies!.path).toBe('/movies');
        expect(result.video?.shows!.path).toBe('/tv-shows');
      });
    });

    describe('devices merging', () => {
      it('merges devices by name', () => {
        const first: PartialConfig = {
          devices: {
            terapod: { volumeUuid: 'ABC', volumeName: 'TERAPOD' },
          },
        };
        const second: PartialConfig = {
          devices: {
            nano: { volumeUuid: 'DEF', volumeName: 'NANO' },
          },
        };
        const result = mergeConfigs(first, second);
        expect(Object.keys(result.devices ?? {})).toHaveLength(2);
        expect(result.devices?.terapod!.volumeName).toBe('TERAPOD');
        expect(result.devices?.nano!.volumeName).toBe('NANO');
      });

      it('deep merges same-named device settings', () => {
        const first: PartialConfig = {
          devices: {
            terapod: {
              volumeUuid: 'ABC',
              volumeName: 'TERAPOD',
              quality: 'low',
              artwork: true,
            },
          },
        };
        const second: PartialConfig = {
          devices: {
            terapod: {
              volumeUuid: 'ABC',
              volumeName: 'TERAPOD',
              quality: 'high',
              // artwork not specified, should preserve from first
            },
          },
        };
        const result = mergeConfigs(first, second);
        expect(result.devices?.terapod!.quality).toBe('high');
        expect(result.devices?.terapod!.artwork).toBe(true);
      });

      it('deep merges device transforms', () => {
        const first: PartialConfig = {
          devices: {
            terapod: {
              volumeUuid: 'ABC',
              volumeName: 'TERAPOD',
              transforms: {
                cleanArtists: {
                  enabled: false,
                  drop: false,
                  format: 'ft. {}',
                  ignore: [],
                },
              },
            },
          },
        };
        const second: PartialConfig = {
          devices: {
            terapod: {
              volumeUuid: 'ABC',
              volumeName: 'TERAPOD',
              transforms: {
                cleanArtists: {
                  enabled: true,
                  drop: false,
                  format: 'feat. {}',
                  ignore: [],
                },
              },
            },
          },
        };
        const result = mergeConfigs(first, second);
        expect(result.devices?.terapod!.transforms?.cleanArtists!.enabled).toBe(true);
        expect(result.devices?.terapod!.transforms?.cleanArtists!.format).toBe('feat. {}');
      });
    });

    describe('defaults merging', () => {
      it('merges defaults', () => {
        const first: PartialConfig = {
          defaults: { music: 'main' },
        };
        const second: PartialConfig = {
          defaults: { device: 'terapod' },
        };
        const result = mergeConfigs(first, second);
        expect(result.defaults?.music).toBe('main');
        expect(result.defaults?.device).toBe('terapod');
      });

      it('later config overrides defaults', () => {
        const first: PartialConfig = {
          defaults: { music: 'main', device: 'nano' },
        };
        const second: PartialConfig = {
          defaults: { device: 'terapod' },
        };
        const result = mergeConfigs(first, second);
        expect(result.defaults?.music).toBe('main');
        expect(result.defaults?.device).toBe('terapod');
      });
    });
  });

  describe('loadConfig', () => {
    it('ENV device declaration overrides a config-file default device', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
[devices.terapod]
volumeUuid = "ABC-123"

[defaults]
device = "terapod"
`)
      );
      process.env.PODKIT_DEVICE_PATH = '/devices/echo';
      process.env.PODKIT_DEVICE_TYPE = 'echo-mini';

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        tips: true,
        tty: false,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      // env > file, same as every other env override. The file device stays
      // registered; only the default moves.
      expect(result.config.defaults?.device).toBe('default');
      expect(result.config.devices?.terapod).toBeDefined();
      expect(result.config.devices?.default).toEqual({ type: 'echo-mini', path: '/devices/echo' });
    });

    it('deep-merges an ENV device into a same-named config-file device', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
[devices.default]
type = "rockbox"
path = "/old/path"
quality = "low"
`)
      );
      process.env.PODKIT_DEVICE_PATH = '/devices/echo';
      process.env.PODKIT_DEVICE_TYPE = 'echo-mini';

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        tips: true,
        tty: false,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      // ENV wins on the fields it declares; the file's other settings survive.
      expect(result.config.devices?.default?.type).toBe('echo-mini');
      expect(result.config.devices?.default?.path).toBe('/devices/echo');
      expect(result.config.devices?.default?.quality).toBe('low');
    });

    it('returns defaults when no config exists', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        tips: true,
        tty: false,
        config: path.join(tempDir, 'nonexistent.toml'),
      };

      const result = loadConfig(globalOpts);
      expect(result.config).toEqual(DEFAULT_CONFIG);
      expect(result.configFileExists).toBe(false);
      expect(result.configPath).toBe(path.join(tempDir, 'nonexistent.toml'));
    });

    it('loads config from custom path', () => {
      const configPath = path.join(tempDir, 'custom.toml');
      fs.writeFileSync(
        configPath,
        v(`
quality = "medium"

[music.main]
path = "/custom/music"
`)
      );

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        tips: true,
        tty: false,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      expect(result.config.quality).toBe('medium');
      expect(result.config.music?.main!.path).toBe('/custom/music');
      expect(result.configFileExists).toBe(true);
      expect(result.configPath).toBe(configPath);
    });

    it('handles missing config file gracefully', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        tips: true,
        tty: false,
        // Use a non-existent config path to avoid loading real user config
        config: '/nonexistent/path/to/config.toml',
      };

      // Should not throw, should use defaults
      const result = loadConfig(globalOpts);
      expect(result.config.quality).toBe('high');
      expect(result.config.artwork).toBe(true);
      expect(result.configFileExists).toBe(false);
    });

    it('loads cleanArtists config and merges with defaults', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
cleanArtists = true
`)
      );

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        tips: true,
        tty: false,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      expect(result.config.transforms.cleanArtists.enabled).toBe(true);
      // Other values should be defaults
      expect(result.config.transforms.cleanArtists.drop).toBe(false);
      expect(result.config.transforms.cleanArtists.format).toBe('feat. {}');
    });

    it('uses default transforms when not specified in config', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        v(`
quality = "low"
`)
      );

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        tips: true,
        tty: false,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      expect(result.config.transforms).toEqual(DEFAULT_TRANSFORMS_CONFIG);
    });
  });
});
