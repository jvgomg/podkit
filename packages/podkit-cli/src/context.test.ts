import { describe, expect, it, beforeEach } from 'bun:test';
import {
  setContext,
  getContext,
  getConfig,
  getGlobalOpts,
  clearContext,
  runWithContext,
  type CliContext,
} from './context.js';
import type { PodkitConfig, GlobalOptions, LoadConfigResult } from './config/index.js';
import { DEFAULT_TRANSFORMS_CONFIG, DEFAULT_VIDEO_TRANSFORMS_CONFIG } from './config/index.js';

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

describe('CLI context', () => {
  beforeEach(() => {
    clearContext();
  });

  describe('getContext', () => {
    it('throws when context not set', () => {
      expect(() => getContext()).toThrow(/CLI context not initialized/);
    });

    it('returns context after setContext', () => {
      setContext(mockContext);
      expect(getContext()).toBe(mockContext);
    });
  });

  describe('setContext', () => {
    it('overwrites previous context', () => {
      const a: CliContext = { ...mockContext, config: { ...mockConfig, quality: 'low' } };
      const b: CliContext = { ...mockContext, config: { ...mockConfig, quality: 'medium' } };
      setContext(a);
      setContext(b);
      expect(getContext().config.quality).toBe('medium');
    });
  });

  describe('getConfig / getGlobalOpts', () => {
    it('throws when context not set', () => {
      expect(() => getConfig()).toThrow(/CLI context not initialized/);
      expect(() => getGlobalOpts()).toThrow(/CLI context not initialized/);
    });

    it('returns values from current context', () => {
      setContext(mockContext);
      expect(getConfig()).toBe(mockConfig);
      expect(getGlobalOpts()).toBe(mockGlobalOpts);
    });
  });

  describe('clearContext', () => {
    it('clears the module-level context', () => {
      setContext(mockContext);
      clearContext();
      expect(() => getContext()).toThrow(/CLI context not initialized/);
    });

    it('does not throw when context already clear', () => {
      expect(() => clearContext()).not.toThrow();
    });
  });
});

describe('runWithContext (AsyncLocalStorage scope)', () => {
  beforeEach(() => {
    clearContext();
  });

  it('exposes context inside the scope only', () => {
    runWithContext(mockContext, () => {
      expect(getContext()).toBe(mockContext);
    });
    expect(() => getContext()).toThrow(/CLI context not initialized/);
  });

  it('overrides the module-level context inside the scope', () => {
    const outer = mockContext;
    const inner: CliContext = { ...mockContext, config: { ...mockConfig, quality: 'low' } };
    setContext(outer);
    runWithContext(inner, () => {
      expect(getContext()).toBe(inner);
    });
    expect(getContext()).toBe(outer);
  });

  it('isolates concurrent async scopes', async () => {
    const ctxA: CliContext = { ...mockContext, config: { ...mockConfig, quality: 'low' } };
    const ctxB: CliContext = { ...mockContext, config: { ...mockConfig, quality: 'high' } };

    const observe = (ctx: CliContext, delay: number) =>
      new Promise<string>((resolve) => {
        runWithContext(ctx, () => {
          setTimeout(() => resolve(getContext().config.quality!), delay);
        });
      });

    const [a, b] = await Promise.all([observe(ctxA, 10), observe(ctxB, 5)]);
    expect(a).toBe('low');
    expect(b).toBe('high');
  });

  it('propagates context across awaits', async () => {
    await runWithContext(mockContext, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      expect(getContext()).toBe(mockContext);
    });
  });
});

// =============================================================================
// End-to-end isolation: a real runner inside runWithContext must observe the
// scoped context, never the module-level one a different test happened to set.
// This guards against future getContext() callers accidentally caching the
// fallback value or bypassing ALS.
// =============================================================================

describe('runWithContext isolation against module-level setContext', () => {
  beforeEach(() => {
    clearContext();
  });

  it('runDeviceAdd inside scope sees the scope, not the leaked module-level config', async () => {
    // Lazy import to avoid pulling all of device.ts when this test file loads
    // alone; mirrors the production lazy-import pattern.
    const { runDeviceAdd } = await import('./commands/device.js');
    const { OutputContext } = await import('./output/index.js');
    const { BufferSink } = await import('./test-utils/buffer-sink.js');
    const { runAction } = await import('./errors.js');

    // Module-level says: "foo" is already configured (would trigger duplicate-name error)
    const polluted: CliContext = {
      ...mockContext,
      config: {
        ...mockConfig,
        devices: { foo: { volumeUuid: 'leaked', volumeName: 'leaked' } },
      },
      globalOpts: { ...mockGlobalOpts, device: 'foo', json: true },
    };
    setContext(polluted);

    // Scoped context: clean slate, no "foo" device. runDeviceAdd should see this.
    const clean: CliContext = {
      ...mockContext,
      config: { ...mockConfig, devices: {} },
      globalOpts: { ...mockGlobalOpts, device: 'foo', json: true },
    };

    const stdout = new BufferSink();
    const stderr = new BufferSink();
    const out = new OutputContext({
      mode: 'json',
      quiet: false,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr,
    });

    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      await runWithContext(clean, () =>
        runAction(out, () => runDeviceAdd({ type: 'echo-mini' }, out))
      );
      // The runner should have hit the --path-required error (because echo-mini
      // requires --path), NOT the duplicate-name error from the leaked context.
      const err = stdout.json<{ success: false; error: string }>();
      expect(err.error).toContain('--path is required');
      expect(err.error).not.toContain('already exists');
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
