import { describe, it, expect } from 'bun:test';
import { massStorageDeviceFromEnv } from './env-device.js';

describe('massStorageDeviceFromEnv', () => {
  it('returns null when PODKIT_DEVICE_PATH is not set', () => {
    expect(massStorageDeviceFromEnv({})).toBeNull();
    // TYPE alone declares nothing — the path is the trigger.
    expect(massStorageDeviceFromEnv({ PODKIT_DEVICE_TYPE: 'echo-mini' })).toBeNull();
  });

  it('returns null for an empty or whitespace-only path', () => {
    expect(massStorageDeviceFromEnv({ PODKIT_DEVICE_PATH: '' })).toBeNull();
    expect(massStorageDeviceFromEnv({ PODKIT_DEVICE_PATH: '   ' })).toBeNull();
  });

  it('declares a device from path alone, preset defaulting to generic', () => {
    expect(massStorageDeviceFromEnv({ PODKIT_DEVICE_PATH: '/devices/player' })).toEqual({
      name: 'default',
      device: { type: 'generic', path: '/devices/player' },
    });
  });

  it('uses the declared preset type', () => {
    expect(
      massStorageDeviceFromEnv({
        PODKIT_DEVICE_PATH: '/devices/echo',
        PODKIT_DEVICE_TYPE: 'echo-mini',
      })
    ).toEqual({
      name: 'default',
      device: { type: 'echo-mini', path: '/devices/echo' },
    });
  });

  it('converts PODKIT_DEVICE_NAME from UPPER_SNAKE_CASE to lower-kebab-case', () => {
    expect(
      massStorageDeviceFromEnv({
        PODKIT_DEVICE_PATH: '/devices/echo',
        PODKIT_DEVICE_TYPE: 'echo-mini',
        PODKIT_DEVICE_NAME: 'MY_ECHO',
      })
    ).toEqual({
      name: 'my-echo',
      device: { type: 'echo-mini', path: '/devices/echo' },
    });
  });

  it('trims the path', () => {
    expect(massStorageDeviceFromEnv({ PODKIT_DEVICE_PATH: ' /devices/player ' })).toEqual({
      name: 'default',
      device: { type: 'generic', path: '/devices/player' },
    });
  });

  it('rejects type "ipod" — iPods need no ENV declaration', () => {
    expect(() =>
      massStorageDeviceFromEnv({
        PODKIT_DEVICE_PATH: '/ipod',
        PODKIT_DEVICE_TYPE: 'ipod',
      })
    ).toThrow(/ipod/i);
  });
});
