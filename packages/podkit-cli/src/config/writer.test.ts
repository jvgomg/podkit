import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addMusicCollection,
  addVideoCollection,
  removeCollection,
  setDefaultCollection,
} from './writer.js';

describe('config writer - collection functions', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-writer-test-'));
    configPath = path.join(tempDir, 'config.toml');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('addMusicCollection', () => {
    it('creates config file if it does not exist', () => {
      const result = addMusicCollection('main', { path: '/path/to/music' }, { configPath });

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('adds music collection section to config', () => {
      const result = addMusicCollection('main', { path: '/path/to/music' }, { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[music.main]');
      expect(content).toContain('path = "/path/to/music"');
    });

    it('escapes special characters in path', () => {
      const result = addMusicCollection(
        'main',
        { path: '/path/with "quotes" and \\backslash' },
        { configPath }
      );

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('\\"quotes\\"');
      expect(content).toContain('\\\\backslash');
    });

    it('adds optional type field', () => {
      const result = addMusicCollection(
        'subsonic',
        { path: '/cache', type: 'subsonic', url: 'https://music.example.com' },
        { configPath }
      );

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[music.subsonic]');
      expect(content).toContain('type = "subsonic"');
      expect(content).toContain('url = "https://music.example.com"');
    });

    it('does not add type field for directory type', () => {
      const result = addMusicCollection(
        'main',
        { path: '/music', type: 'directory' },
        { configPath }
      );

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).not.toContain('type =');
    });

    it('adds optional username field', () => {
      const result = addMusicCollection(
        'subsonic',
        { path: '/cache', type: 'subsonic', url: 'https://music.example.com', username: 'admin' },
        { configPath }
      );

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('username = "admin"');
    });

    it('fails if collection already exists', () => {
      addMusicCollection('main', { path: '/music1' }, { configPath });

      const result = addMusicCollection('main', { path: '/music2' }, { configPath });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('appends to existing config file', () => {
      fs.writeFileSync(configPath, '[defaults]\ndevice = "ipod"\n');

      const result = addMusicCollection('main', { path: '/music' }, { configPath });

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[defaults]');
      expect(content).toContain('[music.main]');
    });

    it('fails when createIfMissing is false and file does not exist', () => {
      const result = addMusicCollection(
        'main',
        { path: '/music' },
        { configPath, createIfMissing: false }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('addVideoCollection', () => {
    it('creates config file if it does not exist', () => {
      const result = addVideoCollection('movies', { path: '/path/to/movies' }, { configPath });

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('adds video collection section to config', () => {
      const result = addVideoCollection('movies', { path: '/path/to/movies' }, { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[video.movies]');
      expect(content).toContain('path = "/path/to/movies"');
    });

    it('fails if collection already exists', () => {
      addVideoCollection('movies', { path: '/movies1' }, { configPath });

      const result = addVideoCollection('movies', { path: '/movies2' }, { configPath });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('appends to existing config file', () => {
      fs.writeFileSync(configPath, '[music.main]\npath = "/music"\n');

      const result = addVideoCollection('movies', { path: '/movies' }, { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[music.main]');
      expect(content).toContain('[video.movies]');
    });
  });

  describe('removeCollection', () => {
    it('removes music collection from config', () => {
      fs.writeFileSync(
        configPath,
        `[music.main]
path = "/music"

[music.other]
path = "/other"
`
      );

      const result = removeCollection('music', 'main', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).not.toContain('[music.main]');
      expect(content).toContain('[music.other]');
    });

    it('removes video collection from config', () => {
      fs.writeFileSync(
        configPath,
        `[video.movies]
path = "/movies"

[video.shows]
path = "/shows"
`
      );

      const result = removeCollection('video', 'movies', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).not.toContain('[video.movies]');
      expect(content).toContain('[video.shows]');
    });

    it('clears default when removing collection that was default', () => {
      fs.writeFileSync(
        configPath,
        `[music.main]
path = "/music"

[defaults]
music = "main"
device = "ipod"
`
      );

      const result = removeCollection('music', 'main', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).not.toContain('music = "main"');
      expect(content).toContain('device = "ipod"');
    });

    it('fails if collection does not exist', () => {
      fs.writeFileSync(configPath, '[music.other]\npath = "/other"\n');

      const result = removeCollection('music', 'main', { configPath });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails if config file does not exist', () => {
      const result = removeCollection('music', 'main', { configPath });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('setDefaultCollection', () => {
    it('creates defaults section if it does not exist', () => {
      fs.writeFileSync(configPath, '[music.main]\npath = "/music"\n');

      const result = setDefaultCollection('music', 'main', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[defaults]');
      expect(content).toContain('music = "main"');
    });

    it('adds to existing defaults section', () => {
      fs.writeFileSync(
        configPath,
        `[defaults]
device = "ipod"
`
      );

      const result = setDefaultCollection('music', 'main', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[defaults]');
      expect(content).toContain('music = "main"');
      expect(content).toContain('device = "ipod"');
    });

    it('updates existing default collection', () => {
      fs.writeFileSync(
        configPath,
        `[defaults]
music = "old"
`
      );

      const result = setDefaultCollection('music', 'new', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('music = "new"');
      expect(content).not.toContain('music = "old"');
    });

    it('sets video default', () => {
      fs.writeFileSync(configPath, '[video.movies]\npath = "/movies"\n');

      const result = setDefaultCollection('video', 'movies', { configPath });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('video = "movies"');
    });

    it('creates config file if createIfMissing is true', () => {
      const result = setDefaultCollection('music', 'main', { configPath, createIfMissing: true });

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('[defaults]');
      expect(content).toContain('music = "main"');
    });

    it('fails when createIfMissing is false and file does not exist', () => {
      const result = setDefaultCollection('music', 'main', { configPath, createIfMissing: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
