/**
 * Unit tests for device-identity — the pure mappers and the persistence
 * round-trip. The full precedence (captured → offline → libgpod) is exercised
 * end-to-end in run-transform.integration.test.ts against real seeded dumps.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpodModel } from '@podkit/devices-ipod';
import {
  DEVICE_IDENTITY_FILENAME,
  captureIdentity,
  identityFromCaptured,
  readCapturedIdentity,
  writeCapturedIdentity,
} from './device-identity.js';

/** A fully-populated variant-level model (as `identify({from:'sysinfo'})` yields). */
const NANO_2G: IpodModel = {
  displayName: 'iPod nano 4GB Silver (2nd Generation)',
  generationId: 'nano_2g',
  family: 'iPod nano',
  ordinal: 2,
  checksumType: 'none',
  modelNumber: 'A477',
  capacityGb: 4,
  color: 'Silver',
  source: 'sysinfo',
};

/** A generation-only model (as a USB-only shuffle resolves — no variant data). */
const SHUFFLE_4G: IpodModel = {
  displayName: 'iPod shuffle (4th Generation)',
  generationId: 'shuffle_4g',
  family: 'iPod shuffle',
  ordinal: 4,
  checksumType: 'none',
  source: 'usb',
};

describe('captureIdentity', () => {
  test('projects a full variant model plus serial/guid into the persisted shape', () => {
    const captured = captureIdentity(NANO_2G, {
      serialNumber: '5U828GFNYXX',
      firewireGuid: '000A2700ABCDEF12',
    });
    expect(captured).toEqual({
      schemaVersion: 1,
      displayName: 'iPod nano 4GB Silver (2nd Generation)',
      generationId: 'nano_2g',
      family: 'iPod nano',
      ordinal: 2,
      modelNumber: 'A477',
      capacityGb: 4,
      color: 'Silver',
      serialNumber: '5U828GFNYXX',
      firewireGuid: '000A2700ABCDEF12',
    });
  });

  test('generation-only model omits absent variant fields', () => {
    const captured = captureIdentity(SHUFFLE_4G, { serialNumber: 'ABC123SHUF' });
    expect(captured).toEqual({
      schemaVersion: 1,
      displayName: 'iPod shuffle (4th Generation)',
      generationId: 'shuffle_4g',
      family: 'iPod shuffle',
      ordinal: 4,
      serialNumber: 'ABC123SHUF',
    });
  });

  test('a null model still persists whatever serial/guid was captured', () => {
    const captured = captureIdentity(null, { serialNumber: 'ONLYSERIAL' });
    expect(captured).toEqual({ schemaVersion: 1, serialNumber: 'ONLYSERIAL' });
  });
});

describe('identityFromCaptured', () => {
  test('maps the persisted shape onto the render contract', () => {
    const captured = captureIdentity(NANO_2G, { serialNumber: '5U828GFNYXX' });
    expect(identityFromCaptured(captured)).toEqual({
      modelName: 'iPod nano 4GB Silver (2nd Generation)',
      generation: 'nano_2g',
      modelNumber: 'A477',
      capacityGb: 4,
      color: 'Silver',
      serialNumber: '5U828GFNYXX',
    });
  });

  test('a serial-only capture yields a serial-only identity', () => {
    expect(identityFromCaptured({ schemaVersion: 1, serialNumber: 'ONLYSERIAL' })).toEqual({
      serialNumber: 'ONLYSERIAL',
    });
  });
});

describe('writeCapturedIdentity / readCapturedIdentity', () => {
  test('round-trips through podkit-device.json at the dump root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-devid-'));
    try {
      const captured = captureIdentity(SHUFFLE_4G, { serialNumber: 'ABC123SHUF' });
      await writeCapturedIdentity(dir, captured);
      expect(await readCapturedIdentity(dir)).toEqual(captured);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns null when the artifact is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-devid-'));
    try {
      expect(await readCapturedIdentity(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns null (not a throw) on a corrupt artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-devid-'));
    try {
      await writeFile(join(dir, DEVICE_IDENTITY_FILENAME), '{ not json', 'utf8');
      expect(await readCapturedIdentity(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns null for a future/unknown schema version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-devid-'));
    try {
      await writeFile(
        join(dir, DEVICE_IDENTITY_FILENAME),
        JSON.stringify({ schemaVersion: 2, displayName: 'iPod of the future' }),
        'utf8'
      );
      // Unknown schema is treated as absent so the caller falls back to offline
      // resolution rather than mis-reading a differently-shaped record.
      expect(await readCapturedIdentity(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
