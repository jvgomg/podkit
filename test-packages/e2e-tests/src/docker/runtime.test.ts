/**
 * Pins the container-runtime selection contract.
 *
 * The default matters as much as the override: every existing Docker user must
 * keep working without setting anything, so a regression that made the variable
 * mandatory would be silent until someone's suite failed.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import {
  containerRuntime,
  hostUserSpec,
  isRootlessRuntime,
  CONTAINER_RUNTIME_ENV,
  DEFAULT_CONTAINER_RUNTIME,
} from './runtime.js';

const original = process.env[CONTAINER_RUNTIME_ENV];

afterEach(() => {
  if (original === undefined) {
    delete process.env[CONTAINER_RUNTIME_ENV];
  } else {
    process.env[CONTAINER_RUNTIME_ENV] = original;
  }
});

describe('containerRuntime', () => {
  it('defaults to docker when the variable is unset', () => {
    delete process.env[CONTAINER_RUNTIME_ENV];
    expect(containerRuntime()).toBe(DEFAULT_CONTAINER_RUNTIME);
    expect(containerRuntime()).toBe('docker');
  });

  it('honours an explicit runtime', () => {
    process.env[CONTAINER_RUNTIME_ENV] = 'podman';
    expect(containerRuntime()).toBe('podman');
  });

  it('falls back to the default when the variable is empty or whitespace', () => {
    // An unset-but-exported variable (`PODKIT_CONTAINER_RUNTIME=` in a shell
    // profile) must not spawn the empty string.
    process.env[CONTAINER_RUNTIME_ENV] = '';
    expect(containerRuntime()).toBe(DEFAULT_CONTAINER_RUNTIME);

    process.env[CONTAINER_RUNTIME_ENV] = '   ';
    expect(containerRuntime()).toBe(DEFAULT_CONTAINER_RUNTIME);
  });

  it('re-reads the environment on every call', () => {
    // Caching at module load would freeze the value behind import order, which
    // is exactly the coupling the preload-free design avoids.
    process.env[CONTAINER_RUNTIME_ENV] = 'podman';
    expect(containerRuntime()).toBe('podman');
    process.env[CONTAINER_RUNTIME_ENV] = 'nerdctl';
    expect(containerRuntime()).toBe('nerdctl');
  });
});

describe('hostUserSpec', () => {
  it('renders uid:gid on a POSIX host', () => {
    // The value is passed straight to `--user`, so the shape is the contract:
    // anything but two integers separated by a colon is rejected by the runtime.
    expect(hostUserSpec()).toMatch(/^\d+:\d+$/);
  });
});

describe('isRootlessRuntime', () => {
  it('answers with a boolean and caches it', () => {
    // Probed by shelling out, so the only portable assertion is the shape — the
    // answer legitimately differs between a dev host (rootless Podman) and CI
    // (rootful Docker), which is the whole reason it is probed and not assumed.
    const first = isRootlessRuntime();
    expect(typeof first).toBe('boolean');
    expect(isRootlessRuntime()).toBe(first);
  });
});
