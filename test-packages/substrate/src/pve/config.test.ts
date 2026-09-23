import { describe, it, expect } from 'bun:test';

import {
  pveVmidEnvVar,
  resolvePveConfig,
  resolvePveVmid,
  PveConfigError,
  DEFAULT_PVE_POOL,
  DEFAULT_PVE_BRIDGE,
} from './config.js';
import { getVm } from '../registry.js';

const COMPLETE = {
  PODKIT_PVE_API_URL: 'https://pve.example:8006',
  PODKIT_PVE_TOKEN_ID: 'podkit@pve!automation',
  PODKIT_PVE_TOKEN_SECRET: 'deadbeef-0000-1111-2222-333344445555',
} as const;

describe('pveVmidEnvVar', () => {
  it('maps a registry id to its env key', () => {
    expect(pveVmidEnvVar('deviceRemote')).toBe('PODKIT_PVE_VMID_DEVICE_REMOTE');
    expect(pveVmidEnvVar('builderRemote')).toBe('PODKIT_PVE_VMID_BUILDER_REMOTE');
    expect(pveVmidEnvVar('device')).toBe('PODKIT_PVE_VMID_DEVICE');
  });
});

describe('resolvePveConfig', () => {
  it('reports an empty environment as unconfigured, not partial', () => {
    const resolved = resolvePveConfig({});
    expect(resolved.available).toBe(false);
    if (resolved.available) throw new Error('unreachable');
    expect(resolved.partial).toBe(false);
    expect(resolved.missing).toContain('PODKIT_PVE_API_URL');
  });

  it('distinguishes a half-typed setup from no setup at all', () => {
    const resolved = resolvePveConfig({ PODKIT_PVE_TOKEN_ID: 'podkit@pve!automation' });
    expect(resolved.available).toBe(false);
    if (resolved.available) throw new Error('unreachable');
    expect(resolved.partial).toBe(true);
    expect(resolved.missing).toEqual(['PODKIT_PVE_API_URL', 'PODKIT_PVE_TOKEN_SECRET']);
  });

  it('defaults the pool, storages and bridge to the reference recipe', () => {
    const resolved = resolvePveConfig(COMPLETE);
    if (!resolved.available) throw new Error('expected available');
    expect(resolved.config.pool).toBe(DEFAULT_PVE_POOL);
    expect(resolved.config.bridge).toBe(DEFAULT_PVE_BRIDGE);
    expect(resolved.config.diskStorage).toBe('local-lvm');
    expect(resolved.config.snippetStorage).toBe('local');
    expect(resolved.config.tlsFingerprint).toBeNull();
  });

  it('reads the storage list positionally: disks first, snippets second', () => {
    const resolved = resolvePveConfig({ ...COMPLETE, PODKIT_PVE_STORAGE: 'tank  bulk' });
    if (!resolved.available) throw new Error('expected available');
    expect(resolved.config.diskStorage).toBe('tank');
    expect(resolved.config.snippetStorage).toBe('bulk');
  });

  it('lets one storage serve both roles', () => {
    const resolved = resolvePveConfig({ ...COMPLETE, PODKIT_PVE_STORAGE: 'local' });
    if (!resolved.available) throw new Error('expected available');
    expect(resolved.config.diskStorage).toBe('local');
    expect(resolved.config.snippetStorage).toBe('local');
  });

  it('strips a trailing slash so paths do not double up', () => {
    const resolved = resolvePveConfig({
      ...COMPLETE,
      PODKIT_PVE_API_URL: 'https://pve.example:8006/',
    });
    if (!resolved.available) throw new Error('expected available');
    expect(resolved.config.apiUrl.href).toBe('https://pve.example:8006/');
  });

  it('refuses a bare hostname, since that is the likely mistake', () => {
    expect(() => resolvePveConfig({ ...COMPLETE, PODKIT_PVE_API_URL: 'pve.example' })).toThrow(
      PveConfigError
    );
  });

  it('refuses to send a bearer token over http', () => {
    expect(() =>
      resolvePveConfig({ ...COMPLETE, PODKIT_PVE_API_URL: 'http://pve.example:8006' })
    ).toThrow(/only ever sent over https/);
  });

  it('refuses a token id missing its realm or token name', () => {
    expect(() => resolvePveConfig({ ...COMPLETE, PODKIT_PVE_TOKEN_ID: 'podkit@pve' })).toThrow(
      PveConfigError
    );
    expect(() =>
      resolvePveConfig({ ...COMPLETE, PODKIT_PVE_TOKEN_ID: 'podkit!automation' })
    ).toThrow(PveConfigError);
  });
});

describe('resolvePveVmid', () => {
  const remote = getVm('deviceRemote');

  it('is null when this machine has no guest for the role', () => {
    expect(resolvePveVmid(remote, {})).toBeNull();
  });

  it('reads the VMID from the role-specific key', () => {
    expect(resolvePveVmid(remote, { PODKIT_PVE_VMID_DEVICE_REMOTE: '9000' })).toBe(9000);
  });

  it('refuses a value that is not a guest id', () => {
    expect(() =>
      resolvePveVmid(remote, { PODKIT_PVE_VMID_DEVICE_REMOTE: 'nine thousand' })
    ).toThrow(PveConfigError);
    expect(() => resolvePveVmid(remote, { PODKIT_PVE_VMID_DEVICE_REMOTE: '42' })).toThrow(
      PveConfigError
    );
  });
});
