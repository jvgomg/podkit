import { describe, expect, it, beforeEach } from 'bun:test';
import {
  setContext,
  getContext,
  getConfig,
  getGlobalOpts,
  clearContext,
  type CliContext,
} from './context.js';
import type { PodkitConfig, GlobalOptions, LoadConfigResult } from './config/index.js';
import { DEFAULT_TRANSFORMS_CONFIG, DEFAULT_VIDEO_TRANSFORMS_CONFIG } from './config/index.js';

describe('CLI context', () => {
  const mockConfig: PodkitConfig = {
    quality: 'high',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    music: {
      main: { path: '/test/music' },
    },
    devices: {
      ipod: { volumeUuid: 'ABC-123', volumeName: 'iPod' },
    },
    defaults: {
      music: 'main',
      device: 'ipod',
    },
  };

  const mockGlobalOpts: GlobalOptions = {
    verbose: 1,
    quiet: false,
    json: false,
    color: true,
    tips: true,
    tty: false,
    config: '/test/config.toml',
  };

  const mockConfigResult: LoadConfigResult = {
    config: mockConfig,
    configPath: '/test/config.toml',
    configFileExists: true,
  };

  const mockContext: CliContext = {
    config: mockConfig,
    globalOpts: mockGlobalOpts,
    configResult: mockConfigResult,
  };

  beforeEach(() => {
    clearContext();
  });

  describe('getContext', () => {
    it('throws when context not set', () => {
      expect(() => getContext()).toThrow(/CLI context not initialized/);
    });

    it('returns context after setContext', () => {
      setContext(mockContext);
      const ctx = getContext();
      expect(ctx).toBe(mockContext);
    });
  });

  describe('setContext', () => {
    it('sets the context', () => {
      setContext(mockContext);
      expect(getContext()).toBe(mockContext);
    });

    it('overwrites previous context', () => {
      const firstContext: CliContext = {
        ...mockContext,
        config: { ...mockConfig, quality: 'low' },
      };
      const secondContext: CliContext = {
        ...mockContext,
        config: { ...mockConfig, quality: 'medium' },
      };

      setContext(firstContext);
      setContext(secondContext);

      expect(getContext().config.quality).toBe('medium');
    });
  });

  describe('getConfig', () => {
    it('throws when context not set', () => {
      expect(() => getConfig()).toThrow(/CLI context not initialized/);
    });

    it('returns config from context', () => {
      setContext(mockContext);
      const config = getConfig();
      expect(config).toBe(mockConfig);
    });
  });

  describe('getGlobalOpts', () => {
    it('throws when context not set', () => {
      expect(() => getGlobalOpts()).toThrow(/CLI context not initialized/);
    });

    it('returns globalOpts from context', () => {
      setContext(mockContext);
      const opts = getGlobalOpts();
      expect(opts).toBe(mockGlobalOpts);
    });
  });

  describe('clearContext', () => {
    it('clears the context', () => {
      setContext(mockContext);
      clearContext();
      expect(() => getContext()).toThrow(/CLI context not initialized/);
    });

    it('does not throw when context already clear', () => {
      expect(() => clearContext()).not.toThrow();
    });
  });
});
