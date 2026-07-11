/**
 * Unit tests for bundler-plugin.cjs
 *
 * Verifies the factory validation, Bun.build callback registration, onResolve
 * importer scoping, the filter regex, and the onLoad stub contents — all via a
 * fake build object with no real Bun.build invocation.
 */

import { describe, it, expect } from 'bun:test';
import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Types for the fake Bun.build object
// ---------------------------------------------------------------------------

interface OnResolveOpts {
  filter: RegExp;
  namespace?: string;
}
interface OnResolveArgs {
  path: string;
  importer: string;
}
type OnResolveResult = { path: string; namespace: string } | undefined;

interface OnLoadOpts {
  filter: RegExp;
  namespace?: string;
}
interface OnLoadArgs {
  path: string;
  namespace: string;
}
interface OnLoadResult {
  contents: string;
  loader: string;
}

interface ResolveRegistration {
  opts: OnResolveOpts;
  cb: (args: OnResolveArgs) => OnResolveResult;
}

interface LoadRegistration {
  opts: OnLoadOpts;
  cb: (args: OnLoadArgs) => OnLoadResult;
}

interface FakeBuild {
  resolves: ResolveRegistration[];
  loads: LoadRegistration[];
  onResolve(opts: OnResolveOpts, cb: (args: OnResolveArgs) => OnResolveResult): void;
  onLoad(opts: OnLoadOpts, cb: (args: OnLoadArgs) => OnLoadResult): void;
}

interface Plugin {
  name: string;
  setup(build: FakeBuild): void;
}

// ---------------------------------------------------------------------------
// Load the CJS module from ESM via createRequire
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);
// bundler-plugin.cjs lives alongside its .d.ts in the package root. It cannot
// be auto-resolved for types via a direct file import in an ESM context, so we
// use createRequire and cast manually.
const { usbNativeBundlerPlugin } = _require('../bundler-plugin.cjs') as {
  usbNativeBundlerPlugin: (stagedNodePath: string) => Plugin;
};

// ---------------------------------------------------------------------------
// Helper: create a fake Bun.build object and run plugin setup on it
// ---------------------------------------------------------------------------

function makeSetup(stagedPath: string): FakeBuild {
  const build: FakeBuild = {
    resolves: [],
    loads: [],
    onResolve(opts, cb) {
      this.resolves.push({ opts, cb });
    },
    onLoad(opts, cb) {
      this.loads.push({ opts, cb });
    },
  };
  usbNativeBundlerPlugin(stagedPath).setup(build);
  return build;
}

// ---------------------------------------------------------------------------
// 1. Factory validation
// ---------------------------------------------------------------------------

describe('usbNativeBundlerPlugin — factory validation', () => {
  it('throws on empty string', () => {
    expect(() => usbNativeBundlerPlugin('')).toThrow('non-empty string');
  });

  it('throws when passed a number', () => {
    // @ts-expect-error — testing invalid input
    expect(() => usbNativeBundlerPlugin(42)).toThrow('non-empty string');
  });

  it('throws when passed null', () => {
    // @ts-expect-error — testing invalid input
    expect(() => usbNativeBundlerPlugin(null)).toThrow('non-empty string');
  });

  it('throws when passed undefined', () => {
    // @ts-expect-error — testing invalid input
    expect(() => usbNativeBundlerPlugin(undefined)).toThrow('non-empty string');
  });

  it('throws on a relative path', () => {
    expect(() => usbNativeBundlerPlugin('./relative/native.node')).toThrow('absolute');
  });

  it('throws on a bare filename (non-absolute)', () => {
    expect(() => usbNativeBundlerPlugin('native.node')).toThrow('absolute');
  });

  it('returns a plugin with name and setup when given a valid absolute path', () => {
    const plugin = usbNativeBundlerPlugin('/abs/staged/native.node');
    expect(typeof plugin.name).toBe('string');
    expect(plugin.name.length).toBeGreaterThan(0);
    expect(typeof plugin.setup).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2. onResolve — importer scoping
// ---------------------------------------------------------------------------

describe('usbNativeBundlerPlugin — onResolve importer scoping', () => {
  const STAGED = '/abs/staged/native.node';

  it('intercepts an importer inside node_modules/usb/ (standard install)', () => {
    const build = makeSetup(STAGED);
    const reg = build.resolves[0]!;
    expect(
      reg.cb({
        path: 'node-gyp-build',
        importer: '/abs/proj/node_modules/usb/dist/usb/bindings.js',
      })
    ).toEqual({ path: 'node-gyp-build-stub', namespace: 'podkit-usb-native' });
  });

  it('intercepts an importer in a Bun store nested node_modules/usb/ layout', () => {
    // Bun hoists scoped packages under node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/
    // The importer still contains /node_modules/usb/ so it must be caught.
    const build = makeSetup(STAGED);
    const reg = build.resolves[0]!;
    expect(
      reg.cb({
        path: 'node-gyp-build',
        importer: '/abs/proj/node_modules/.bun/usb@2.17.0/node_modules/usb/dist/index.js',
      })
    ).toEqual({ path: 'node-gyp-build-stub', namespace: 'podkit-usb-native' });
  });

  it('returns undefined for a project directory merely named usb/ (not node_modules/usb/)', () => {
    // A source directory named "usb" must not be caught — only the installed package.
    const build = makeSetup(STAGED);
    const reg = build.resolves[0]!;
    expect(
      reg.cb({ path: 'node-gyp-build', importer: '/home/alice/usb/src/index.ts' })
    ).toBeUndefined();
  });

  it('returns undefined for an importer in a different node_modules package', () => {
    const build = makeSetup(STAGED);
    const reg = build.resolves[0]!;
    expect(
      reg.cb({ path: 'node-gyp-build', importer: '/abs/proj/node_modules/other-pkg/index.js' })
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. onResolve — filter regex
// ---------------------------------------------------------------------------

describe('usbNativeBundlerPlugin — onResolve filter', () => {
  it('filter matches the exact specifier "node-gyp-build"', () => {
    const build = makeSetup('/abs/staged/native.node');
    expect(build.resolves[0]!.opts.filter.test('node-gyp-build')).toBe(true);
  });

  it('filter does not match "node-gyp-build-extra" (anchored at end)', () => {
    const build = makeSetup('/abs/staged/native.node');
    expect(build.resolves[0]!.opts.filter.test('node-gyp-build-extra')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. onLoad — stub contents
// ---------------------------------------------------------------------------

describe('usbNativeBundlerPlugin — onLoad stub', () => {
  it('generates the exact module.exports stub with the staged path JSON-encoded', () => {
    const stagedPath = '/abs/staged/usb-native.node';
    const build = makeSetup(stagedPath);
    const reg = build.loads[0]!;
    const result = reg.cb({ path: 'node-gyp-build-stub', namespace: 'podkit-usb-native' });
    expect(result.contents).toBe(`module.exports = () => require(${JSON.stringify(stagedPath)});`);
    expect(result.loader).toBe('js');
  });

  it('JSON-encodes a staged path that contains spaces', () => {
    // JSON.stringify adds the surrounding quotes and escapes interior quotes,
    // backslashes, and other special chars — the stub must be valid JS.
    const stagedPath = '/abs/staged/path with spaces/usb-native.node';
    const build = makeSetup(stagedPath);
    const reg = build.loads[0]!;
    const result = reg.cb({ path: 'node-gyp-build-stub', namespace: 'podkit-usb-native' });
    expect(result.contents).toBe(`module.exports = () => require(${JSON.stringify(stagedPath)});`);
  });
});
