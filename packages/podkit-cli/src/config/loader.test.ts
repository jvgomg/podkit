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
import type { GlobalOptions, PartialConfig } from './types.js';

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
    delete process.env[ENV_KEYS.lossyQuality];
    delete process.env[ENV_KEYS.artwork];
  });

  describe('DEFAULT_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_CONFIG.quality).toBe('high');
      expect(DEFAULT_CONFIG.artwork).toBe(true);
    });
  });

  describe('loadConfigFile', () => {
    it('returns undefined for non-existent file', () => {
      const result = loadConfigFile(path.join(tempDir, 'nonexistent.toml'));
      expect(result).toBeUndefined();
    });

    it('parses valid config with quality and artwork', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
quality = "medium"
artwork = false
`
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
        `
quality = "invalid"
`
      );

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid quality value/);
    });

    // Quality preset tests
    const validPresets = [
      'alac',
      'max',
      'max-cbr',
      'high',
      'high-cbr',
      'medium',
      'medium-cbr',
      'low',
      'low-cbr',
    ] as const;
    for (const preset of validPresets) {
      it(`accepts quality = "${preset}"`, () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(configPath, `quality = "${preset}"`);

        const result = loadConfigFile(configPath);
        expect(result?.quality).toBe(preset);
      });
    }

    // lossyQuality tests
    it('parses lossyQuality option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
quality = "alac"
lossyQuality = "high"
`
      );

      const result = loadConfigFile(configPath);
      expect(result?.quality).toBe('alac');
      expect(result?.lossyQuality).toBe('high');
    });

    it('throws on alac as lossyQuality (alac is not valid AAC preset)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
quality = "alac"
lossyQuality = "alac"
`
      );

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid lossyQuality value/);
    });

    const validLossyQualities = [
      'max',
      'max-cbr',
      'high',
      'high-cbr',
      'medium',
      'medium-cbr',
      'low',
      'low-cbr',
    ] as const;
    for (const lossyQuality of validLossyQualities) {
      it(`accepts lossyQuality = "${lossyQuality}"`, () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
quality = "alac"
lossyQuality = "${lossyQuality}"
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.lossyQuality).toBe(lossyQuality);
      });
    }

    // audioQuality tests
    it('parses audioQuality option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
audioQuality = "alac"
`
      );

      const result = loadConfigFile(configPath);
      expect(result?.audioQuality).toBe('alac');
    });

    it('throws on invalid audioQuality', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
audioQuality = "invalid"
`
      );

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid audioQuality value/);
    });

    // root-level videoQuality tests
    it('parses root-level videoQuality option', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
videoQuality = "medium"
`
      );

      const result = loadConfigFile(configPath);
      expect(result?.videoQuality).toBe('medium');
    });

    it('throws on invalid root-level videoQuality', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
videoQuality = "invalid"
`
      );

      expect(() => loadConfigFile(configPath)).toThrow(/Invalid videoQuality value/);
    });

    it('handles empty config file', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(configPath, '# Empty config\n');

      const result = loadConfigFile(configPath);
      expect(result).toEqual({});
    });

    it('throws on malformed TOML syntax', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
quality = "missing end quote
`
      );

      expect(() => loadConfigFile(configPath)).toThrow();
    });

    it('ignores artwork with wrong type (string instead of boolean)', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
artwork = "yes"
`
      );

      const result = loadConfigFile(configPath);
      // String "yes" should not be parsed as artwork since type check is strict
      expect(result).toEqual({});
    });

    describe('transforms config', () => {
      it('parses [transforms.ftintitle] section', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
enabled = true
drop = false
format = "feat. {}"
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms).toBeDefined();
        expect(result?.transforms?.ftintitle).toEqual({
          enabled: true,
          drop: false,
          format: 'feat. {}',
          ignore: [],
        });
      });

      it('parses partial transforms config (enabled only)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
enabled = true
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.ftintitle.enabled).toBe(true);
        // Other values should be defaults
        expect(result?.transforms?.ftintitle.drop).toBe(false);
        expect(result?.transforms?.ftintitle.format).toBe('feat. {}');
      });

      it('parses drop mode', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
enabled = true
drop = true
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.ftintitle.drop).toBe(true);
      });

      it('parses custom format string', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
enabled = true
format = "with {}"
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.transforms?.ftintitle.format).toBe('with {}');
      });

      it('throws on format without placeholder', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
enabled = true
format = "no placeholder here"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/must contain "{}"/);
      });

      it('throws on wrong type for enabled (string instead of boolean)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
enabled = "true"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "enabled"/);
      });

      it('throws on wrong type for drop (string instead of boolean)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
drop = "yes"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "drop"/);
      });

      it('throws on wrong type for format (number instead of string)', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms.ftintitle]
format = 123
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "format"/);
      });

      it('returns defaults when transforms section missing', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
quality = "high"
`
        );

        const result = loadConfigFile(configPath);
        // transforms should not be in the result if not specified
        expect(result?.transforms).toBeUndefined();
      });

      it('handles empty transforms section', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[transforms]
`
        );

        const result = loadConfigFile(configPath);
        // Should have transforms with defaults
        expect(result?.transforms?.ftintitle).toEqual(DEFAULT_TRANSFORMS_CONFIG.ftintitle);
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
          `
[music.main]
path = "/Volumes/Media/music/library"
`
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
          `
[music.main]
path = "/Volumes/Media/music/library"

[music.dj]
path = "/Volumes/Media/dj-sets"
`
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
          `
[music.work]
type = "subsonic"
url = "https://music.work.com"
username = "james"
`
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
          `
[music.main]
path = "/music"
type = "invalid"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type "invalid"/);
      });

      it('throws on missing path for directory collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[music.main]
# missing path
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "path"/);
      });

      it('throws on missing url for subsonic collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[music.work]
type = "subsonic"
username = "james"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "url"/);
      });

      it('throws on missing username for subsonic collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[music.work]
type = "subsonic"
url = "https://music.work.com"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "username"/);
      });
    });

    describe('video collections', () => {
      it('parses single video collection', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[video.movies]
path = "/Volumes/Media/movies"
`
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
          `
[video.movies]
path = "/Volumes/Media/movies"

[video.shows]
path = "/Volumes/Media/tv-shows"
`
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
          `
[video.movies]
# missing path
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "path"/);
      });
    });

    describe('devices', () => {
      it('parses single device', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
`
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
          `
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "high"
audioQuality = "alac"
videoQuality = "medium"
artwork = true
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod).toEqual({
          volumeUuid: 'ABC-123',
          volumeName: 'TERAPOD',
          quality: 'high',
          audioQuality: 'alac',
          videoQuality: 'medium',
          artwork: true,
        });
      });

      it('parses device with transforms', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"

[devices.terapod.transforms.ftintitle]
enabled = true
format = "feat. {}"
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.devices?.terapod!.transforms).toBeDefined();
        expect(result?.devices?.terapod!.transforms?.ftintitle!.enabled).toBe(true);
        expect(result?.devices?.terapod!.transforms?.ftintitle!.format).toBe('feat. {}');
      });

      it('parses multiple devices', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "high"

[devices.nano]
volumeUuid = "DEF-456"
volumeName = "NANO"
quality = "low"
artwork = false
`
        );

        const result = loadConfigFile(configPath);
        expect(Object.keys(result?.devices ?? {})).toHaveLength(2);
        expect(result?.devices?.terapod!.quality).toBe('high');
        expect(result?.devices?.nano!.quality).toBe('low');
        expect(result?.devices?.nano!.artwork).toBe(false);
      });

      it('throws on missing volumeUuid', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeName = "TERAPOD"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "volumeUuid"/);
      });

      it('throws on missing volumeName', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeUuid = "ABC-123"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Missing or invalid "volumeName"/);
      });

      it('throws on invalid quality', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
quality = "invalid"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid quality value "invalid"/);
      });

      it('throws on invalid videoQuality', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
videoQuality = "invalid"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid videoQuality value "invalid"/);
      });

      it('throws on invalid artwork type', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
artwork = "yes"
`
        );

        expect(() => loadConfigFile(configPath)).toThrow(/Invalid type for "artwork"/);
      });
    });

    describe('defaults', () => {
      it('parses defaults section', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
[music.main]
path = "/music"

[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"

[defaults]
music = "main"
device = "terapod"
`
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
          `
[video.movies]
path = "/movies"

[defaults]
video = "movies"
`
        );

        const result = loadConfigFile(configPath);
        expect(result?.defaults?.video).toBe('movies');
      });
    });

    describe('complete config (ADR-008)', () => {
      it('parses complete ADR-008 example config', () => {
        const configPath = path.join(tempDir, 'config.toml');
        fs.writeFileSync(
          configPath,
          `
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

[devices.terapod.transforms.ftintitle]
enabled = true
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
`
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
        expect(result?.devices?.terapod!.transforms?.ftintitle!.enabled).toBe(true);
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
    const envPresets = [
      'alac',
      'max',
      'max-cbr',
      'high',
      'high-cbr',
      'medium',
      'medium-cbr',
      'low',
      'low-cbr',
    ] as const;
    for (const preset of envPresets) {
      it(`reads PODKIT_QUALITY=${preset}`, () => {
        process.env[ENV_KEYS.quality] = preset;
        const result = loadEnvConfig();
        expect(result.quality).toBe(preset);
      });
    }

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

    it('reads PODKIT_AUDIO_QUALITY with valid value', () => {
      process.env[ENV_KEYS.audioQuality] = 'alac';
      const result = loadEnvConfig();
      expect(result.audioQuality).toBe('alac');
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

    it('reads PODKIT_LOSSY_QUALITY with valid value', () => {
      process.env[ENV_KEYS.lossyQuality] = 'high';
      const result = loadEnvConfig();
      expect(result.lossyQuality).toBe('high');
    });

    it('ignores PODKIT_LOSSY_QUALITY with invalid value', () => {
      process.env[ENV_KEYS.lossyQuality] = 'alac';
      const result = loadEnvConfig();
      expect(result.lossyQuality).toBeUndefined();
    });
  });

  describe('loadCliConfig', () => {
    it('returns empty config with no options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const result = loadCliConfig(globalOpts);
      expect(result).toEqual({});
    });

    it('extracts quality from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { quality: 'low' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.quality).toBe('low');
    });

    it('extracts artwork from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { artwork: false };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.artwork).toBe(false);
    });

    it('ignores invalid quality in command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { quality: 'invalid' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.quality).toBeUndefined();
    });

    // All quality presets via CLI
    const cliPresets = [
      'alac',
      'max',
      'max-cbr',
      'high',
      'high-cbr',
      'medium',
      'medium-cbr',
      'low',
      'low-cbr',
    ] as const;
    for (const preset of cliPresets) {
      it(`extracts quality = "${preset}" from command options`, () => {
        const globalOpts: GlobalOptions = {
          verbose: 0,
          quiet: false,
          json: false,
          color: true,
        };
        const commandOpts = { quality: preset };
        const result = loadCliConfig(globalOpts, commandOpts);
        expect(result.quality).toBe(preset);
      });
    }

    // lossyQuality option via CLI
    it('extracts lossyQuality from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { audioQuality: 'alac', lossyQuality: 'high' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.audioQuality).toBe('alac');
      expect(result.lossyQuality).toBe('high');
    });

    // Invalid lossyQuality via CLI (alac is not valid AAC preset)
    it('ignores invalid lossyQuality in command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { lossyQuality: 'invalid' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.lossyQuality).toBeUndefined();
    });

    // audioQuality option via CLI
    it('extracts audioQuality from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { audioQuality: 'max-cbr' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.audioQuality).toBe('max-cbr');
    });

    // videoQuality option via CLI
    it('extracts videoQuality from command options', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
      };
      const commandOpts = { videoQuality: 'medium' };
      const result = loadCliConfig(globalOpts, commandOpts);
      expect(result.videoQuality).toBe('medium');
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

    describe('transforms merging', () => {
      it('includes default transforms config', () => {
        const result = mergeConfigs();
        expect(result.transforms).toEqual(DEFAULT_TRANSFORMS_CONFIG);
      });

      it('merges transforms config from partial', () => {
        const partial: PartialConfig = {
          transforms: {
            ftintitle: {
              enabled: true,
              drop: false,
              format: 'feat. {}',
              ignore: [],
            },
          },
        };
        const result = mergeConfigs(partial);
        expect(result.transforms.ftintitle.enabled).toBe(true);
      });

      it('deep merges transforms (later configs override all fields)', () => {
        const first: PartialConfig = {
          transforms: {
            ftintitle: {
              enabled: false,
              drop: false,
              format: 'ft. {}',
              ignore: [],
            },
          },
        };
        const second: PartialConfig = {
          transforms: {
            ftintitle: {
              enabled: true,
              drop: true,
              format: 'feat. {}',
              ignore: [],
            },
          },
        };
        const result = mergeConfigs(first, second);
        expect(result.transforms.ftintitle.enabled).toBe(true);
        expect(result.transforms.ftintitle.drop).toBe(true);
        expect(result.transforms.ftintitle.format).toBe('feat. {}');
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
                ftintitle: {
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
                ftintitle: {
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
        expect(result.devices?.terapod!.transforms?.ftintitle!.enabled).toBe(true);
        expect(result.devices?.terapod!.transforms?.ftintitle!.format).toBe('feat. {}');
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
    it('returns defaults when no config exists', () => {
      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        config: path.join(tempDir, 'nonexistent.toml'),
      };

      const result = loadConfig(globalOpts);
      expect(result.config).toEqual(DEFAULT_CONFIG);
      expect(result.configFileExists).toBe(false);
      expect(result.configPath).toBeUndefined();
    });

    it('loads config from custom path', () => {
      const configPath = path.join(tempDir, 'custom.toml');
      fs.writeFileSync(
        configPath,
        `
quality = "medium"

[music.main]
path = "/custom/music"
`
      );

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
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
        // Use a non-existent config path to avoid loading real user config
        config: '/nonexistent/path/to/config.toml',
      };

      // Should not throw, should use defaults
      const result = loadConfig(globalOpts);
      expect(result.config.quality).toBe('high');
      expect(result.config.artwork).toBe(true);
      expect(result.configFileExists).toBe(false);
    });

    it('loads transforms config and merges with defaults', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
[transforms.ftintitle]
enabled = true
`
      );

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      expect(result.config.transforms.ftintitle.enabled).toBe(true);
      // Other values should be defaults
      expect(result.config.transforms.ftintitle.drop).toBe(false);
      expect(result.config.transforms.ftintitle.format).toBe('feat. {}');
    });

    it('uses default transforms when not specified in config', () => {
      const configPath = path.join(tempDir, 'config.toml');
      fs.writeFileSync(
        configPath,
        `
quality = "low"
`
      );

      const globalOpts: GlobalOptions = {
        verbose: 0,
        quiet: false,
        json: false,
        color: true,
        config: configPath,
      };

      const result = loadConfig(globalOpts);
      expect(result.config.transforms).toEqual(DEFAULT_TRANSFORMS_CONFIG);
    });
  });
});
