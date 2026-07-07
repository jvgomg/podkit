import { describe, it, expect } from 'bun:test';
import { massStorageEnvDevice } from './env-device.js';

describe('massStorageEnvDevice', () => {
  it('returns the declared device path', () => {
    expect(massStorageEnvDevice({ PODKIT_DEVICE_PATH: '/devices/echo' })).toEqual({
      kind: 'declared',
      path: '/devices/echo',
    });
  });

  it('trims the path', () => {
    expect(massStorageEnvDevice({ PODKIT_DEVICE_PATH: ' /devices/echo ' })).toEqual({
      kind: 'declared',
      path: '/devices/echo',
    });
  });

  it('reports nothing declared', () => {
    expect(massStorageEnvDevice({})).toEqual({ kind: 'none' });
    expect(massStorageEnvDevice({ PODKIT_DEVICE_PATH: '' })).toEqual({ kind: 'none' });
    expect(massStorageEnvDevice({ PODKIT_DEVICE_PATH: '   ' })).toEqual({ kind: 'none' });
  });

  it('flags an ipod-typed declaration so the caller can warn (the CLI rejects it)', () => {
    expect(
      massStorageEnvDevice({ PODKIT_DEVICE_PATH: '/ipod', PODKIT_DEVICE_TYPE: 'ipod' })
    ).toEqual({ kind: 'invalid-ipod-type' });
  });

  it('accepts any mass-storage preset type', () => {
    expect(
      massStorageEnvDevice({ PODKIT_DEVICE_PATH: '/devices/echo', PODKIT_DEVICE_TYPE: 'echo-mini' })
    ).toEqual({ kind: 'declared', path: '/devices/echo' });
  });
});
