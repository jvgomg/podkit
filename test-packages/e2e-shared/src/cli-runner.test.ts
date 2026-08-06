/**
 * Unit tests for `getCliPath` — in particular the `PODKIT_CLI_BINARY` override
 * that lets the host e2e run against a standalone compiled binary (the real
 * shipped artefact / a pre-release tarball) instead of the bundle proxy.
 *
 * These are pure path-resolution assertions; the actual direct-vs-bun
 * invocation is proven end-to-end by running the host suite with the override
 * set against `packages/podkit-cli/bin/podkit`.
 */

import { describe, it, expect, afterEach } from 'bun:test';

import { getCliPath, CLI_BINARY_ENV } from './cli-runner.js';

afterEach(() => {
  delete process.env[CLI_BINARY_ENV];
});

describe('getCliPath', () => {
  it("resolves 'production' to the bundled dist/main.js by default", () => {
    delete process.env[CLI_BINARY_ENV];
    expect(getCliPath('production')).toMatch(/packages\/podkit-cli\/dist\/main\.js$/);
  });

  it("resolves 'debug' to the compiled debug binary", () => {
    expect(getCliPath('debug')).toMatch(/packages\/podkit-cli\/bin\/podkit-debug$/);
  });

  it('honours the PODKIT_CLI_BINARY override for the production build', () => {
    process.env[CLI_BINARY_ENV] = '/tmp/pre-release/podkit';
    expect(getCliPath('production')).toBe('/tmp/pre-release/podkit');
  });

  it('resolves a relative override to an absolute path', () => {
    process.env[CLI_BINARY_ENV] = 'packages/podkit-cli/bin/podkit';
    const resolved = getCliPath('production');
    expect(resolved.startsWith('/')).toBe(true);
    expect(resolved).toMatch(/packages\/podkit-cli\/bin\/podkit$/);
  });

  it('ignores the override for the explicit debug build', () => {
    process.env[CLI_BINARY_ENV] = '/tmp/pre-release/podkit';
    expect(getCliPath('debug')).toMatch(/podkit-debug$/);
  });

  it('treats a whitespace-only override as unset', () => {
    process.env[CLI_BINARY_ENV] = '   ';
    expect(getCliPath('production')).toMatch(/dist\/main\.js$/);
  });
});
