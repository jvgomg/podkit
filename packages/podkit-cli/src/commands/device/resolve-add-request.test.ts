/**
 * Unit tests for the M3 add-request resolver (`resolveAddRequest`).
 *
 * Pure-function tests over argument combinations → `AddRequest` fields or a
 * thrown `CliError`. No I/O, no context — the registry + classifier are
 * injected via `ctx`, so these tests never touch the config layer.
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveAddRequest,
  type RawAddOptions,
  type ResolveAddRequestContext,
  type MassStoragePatch,
} from './resolve-add-request.js';
import { CliError } from '../../errors.js';
import { DeviceErrorCodes } from './error-codes.js';

// =============================================================================
// Context builder
// =============================================================================

function makeCtx(over: Partial<ResolveAddRequestContext> = {}): ResolveAddRequestContext {
  return {
    existingDeviceNames: new Set<string>(),
    knownDeviceTypeIds: ['ipod', 'echo-mini', 'rockbox', 'generic'],
    isMassStorageType: (t) => t !== 'ipod',
    ...over,
  };
}

function raw(over: Partial<RawAddOptions> = {}): RawAddOptions {
  return { name: 'mydev', ...over };
}

/** Resolve, expecting a thrown CliError; return it for assertions. */
function expectCliError(fn: () => void): CliError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected resolveAddRequest to throw a CliError');
}

// =============================================================================
// Name validation
// =============================================================================

describe('resolveAddRequest: name validation', () => {
  it('rejects a name not starting with a letter', () => {
    const err = expectCliError(() => resolveAddRequest(raw({ name: '1bad' }), makeCtx()));
    expect(err.code).toBe(DeviceErrorCodes.INVALID_DEVICE_NAME);
  });

  it('rejects a name with illegal characters', () => {
    const err = expectCliError(() => resolveAddRequest(raw({ name: 'has space' }), makeCtx()));
    expect(err.code).toBe(DeviceErrorCodes.INVALID_DEVICE_NAME);
  });

  it('rejects a duplicate name (Set form)', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ name: 'foo' }), makeCtx({ existingDeviceNames: new Set(['foo']) }))
    );
    expect(err.code).toBe(DeviceErrorCodes.DEVICE_EXISTS);
  });

  it('rejects a duplicate name (array form)', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ name: 'foo' }), makeCtx({ existingDeviceNames: ['foo'] }))
    );
    expect(err.code).toBe(DeviceErrorCodes.DEVICE_EXISTS);
  });

  it('accepts a valid, unique name', () => {
    const req = resolveAddRequest(raw({ name: 'terapod' }), makeCtx());
    expect(req.name).toBe('terapod');
  });
});

// =============================================================================
// Type validation → claim
// =============================================================================

describe('resolveAddRequest: --type → DeviceClaim', () => {
  it('undeclared when no --type', () => {
    const req = resolveAddRequest(raw(), makeCtx());
    expect(req.claim).toEqual({ mode: 'undeclared' });
  });

  it('declared with the type when --type ipod', () => {
    const req = resolveAddRequest(raw({ type: 'ipod' }), makeCtx());
    expect(req.claim).toEqual({ mode: 'declared', deviceType: 'ipod' });
  });

  it('rejects an unknown --type, listing known ids', () => {
    const err = expectCliError(() => resolveAddRequest(raw({ type: 'nope' }), makeCtx()));
    expect(err.code).toBe(DeviceErrorCodes.INVALID_TYPE);
    expect(err.message).toContain('echo-mini');
    expect(err.message).toContain('ipod');
  });

  it('accepts a user-registered preset id supplied via knownDeviceTypeIds', () => {
    const req = resolveAddRequest(
      raw({ type: 'my-walkman', path: '/mnt/w' }),
      makeCtx({ knownDeviceTypeIds: ['ipod', 'generic', 'my-walkman'] })
    );
    expect(req.claim).toEqual({ mode: 'declared', deviceType: 'my-walkman' });
  });
});

// =============================================================================
// Quality / encoding validation
// =============================================================================

describe('resolveAddRequest: quality + encoding validation', () => {
  it('rejects unknown --quality', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ type: 'ipod', quality: 'bogus' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.INVALID_QUALITY);
  });

  it('rejects unknown --audio-quality', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ type: 'ipod', audioQuality: 'bogus' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.INVALID_AUDIO_QUALITY);
  });

  it('rejects unknown --video-quality', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ type: 'ipod', videoQuality: 'bogus' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.INVALID_VIDEO_QUALITY);
  });

  it('rejects unknown --encoding', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ type: 'ipod', encoding: 'lossy' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.INVALID_ENCODING);
  });

  it('carries valid quality/encoding onto the config patch', () => {
    const req = resolveAddRequest(
      raw({ type: 'ipod', quality: 'high', encoding: 'vbr' }),
      makeCtx()
    );
    expect(req.config.quality).toBe('high');
    expect(req.config.encoding).toBe('vbr');
  });
});

// =============================================================================
// Mass-storage-only options gate
// =============================================================================

describe('resolveAddRequest: mass-storage-only options', () => {
  it('rejects mass-storage-only options on iPod', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ type: 'ipod', musicDir: 'Music' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.INVALID_OPTION_FOR_TYPE);
    expect(err.message).toContain('--music-dir');
  });

  it('rejects mass-storage-only options when undeclared (no --type)', () => {
    const err = expectCliError(() => resolveAddRequest(raw({ supportsVideo: true }), makeCtx()));
    expect(err.code).toBe(DeviceErrorCodes.INVALID_OPTION_FOR_TYPE);
  });

  it('accepts mass-storage-only options when a mass-storage type is declared', () => {
    const req = resolveAddRequest(
      raw({ type: 'echo-mini', path: '/mnt/echo', musicDir: 'Tunes', supportsVideo: false }),
      makeCtx()
    );
    const ms: MassStoragePatch = req.config.massStorage;
    expect(ms.musicDir).toBe('Tunes');
    expect(ms.supportsVideo).toBe(false);
  });

  it('parses artwork-max-resolution into the mass-storage patch', () => {
    const req = resolveAddRequest(
      raw({ type: 'echo-mini', path: '/mnt/echo', artworkMaxResolution: '512' }),
      makeCtx()
    );
    expect(req.config.massStorage.artworkMaxResolution).toBe(512);
  });

  it('runs injected validateCapabilityOverrides and surfaces the first error', () => {
    const err = expectCliError(() =>
      resolveAddRequest(
        raw({ type: 'echo-mini', path: '/mnt/echo', artworkSources: ['bogus'] }),
        makeCtx({
          validateCapabilityOverrides: () => ({
            ok: false,
            firstError: {
              message: 'Invalid artwork source "bogus".',
              code: 'INVALID_ARTWORK_SOURCE',
            },
          }),
        })
      )
    );
    expect(err.code).toBe(DeviceErrorCodes.INVALID_ARTWORK_SOURCE);
    expect(err.message).toContain('bogus');
  });
});

// =============================================================================
// Mass-storage requires --path
// =============================================================================

describe('resolveAddRequest: mass-storage requires --path', () => {
  it('rejects a mass-storage type without --path', () => {
    const err = expectCliError(() => resolveAddRequest(raw({ type: 'echo-mini' }), makeCtx()));
    expect(err.code).toBe(DeviceErrorCodes.PATH_REQUIRED);
    expect(err.message).toContain('echo-mini');
  });

  it('rejects a mass-storage type with --volume-uuid but no --path', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ type: 'rockbox', volumeUuid: 'AAAA' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.PATH_REQUIRED);
  });

  it('accepts a mass-storage type with --path → path target', () => {
    const req = resolveAddRequest(raw({ type: 'echo-mini', path: '/mnt/echo' }), makeCtx());
    expect(req.target).toEqual({ kind: 'path', path: '/mnt/echo' });
  });
});

// =============================================================================
// Target derivation
// =============================================================================

describe('resolveAddRequest: DeviceTarget derivation', () => {
  it('path target when --path given', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', path: '/Volumes/IPOD' }), makeCtx());
    expect(req.target).toEqual({ kind: 'path', path: '/Volumes/IPOD' });
  });

  it('uuid target when --volume-uuid given (no path)', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', volumeUuid: 'AAAA-BBBB' }), makeCtx());
    expect(req.target).toEqual({ kind: 'uuid', volumeUuid: 'AAAA-BBBB' });
  });

  it('scan target when neither path nor uuid given', () => {
    const req = resolveAddRequest(raw({ type: 'ipod' }), makeCtx());
    expect(req.target).toEqual({ kind: 'scan' });
  });

  it('path wins over uuid when both given', () => {
    const req = resolveAddRequest(
      raw({ type: 'ipod', path: '/Volumes/IPOD', volumeUuid: 'AAAA' }),
      makeCtx()
    );
    expect(req.target.kind).toBe('path');
  });

  it('treats an empty-string --volume-uuid as scan (no meaningless locate)', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', volumeUuid: '' }), makeCtx());
    expect(req.target).toEqual({ kind: 'scan' });
  });

  it('treats an empty-string --path as scan', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', path: '' }), makeCtx());
    expect(req.target).toEqual({ kind: 'scan' });
  });
});

// =============================================================================
// Tier derivation
// =============================================================================

describe('resolveAddRequest: VerificationTier derivation', () => {
  it('verify by default', () => {
    const req = resolveAddRequest(raw({ type: 'ipod' }), makeCtx());
    expect(req.tier).toBe('verify');
  });

  it('trust-disk when --no-verify (verify === false)', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', verify: false }), makeCtx());
    expect(req.tier).toBe('trust-disk');
  });

  it('config-inject when --no-validate (validate === false)', () => {
    const req = resolveAddRequest(
      raw({ type: 'ipod', validate: false, volumeUuid: 'AAAA' }),
      makeCtx()
    );
    expect(req.tier).toBe('config-inject');
  });

  it('--no-validate ⇒ --no-verify structurally: config-inject even when verify is also false', () => {
    const req = resolveAddRequest(
      raw({ type: 'ipod', validate: false, verify: false, volumeUuid: 'AAAA' }),
      makeCtx()
    );
    expect(req.tier).toBe('config-inject');
  });

  it('--no-validate ⇒ config-inject even when verify left at default (true)', () => {
    const req = resolveAddRequest(
      raw({ type: 'ipod', validate: false, verify: true, path: '/mnt/x' }),
      makeCtx()
    );
    expect(req.tier).toBe('config-inject');
  });
});

// =============================================================================
// Config-inject completeness
// =============================================================================

describe('resolveAddRequest: config-inject completeness', () => {
  it('errors when --no-validate has no uuid/path and no type', () => {
    const err = expectCliError(() => resolveAddRequest(raw({ validate: false }), makeCtx()));
    expect(err.code).toBe(DeviceErrorCodes.EMPTY_IDENTITY);
    expect(err.details?.missing).toEqual(['--volume-uuid or --path', '--type']);
  });

  it('errors when --no-validate has uuid but no type', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ validate: false, volumeUuid: 'AAAA' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.EMPTY_IDENTITY);
    expect(err.details?.missing).toEqual(['--type']);
  });

  it('errors when --no-validate has type but no uuid/path', () => {
    const err = expectCliError(() =>
      resolveAddRequest(raw({ validate: false, type: 'ipod' }), makeCtx())
    );
    expect(err.code).toBe(DeviceErrorCodes.EMPTY_IDENTITY);
    expect(err.details?.missing).toEqual(['--volume-uuid or --path']);
  });

  it('assembles InjectedIdentity from uuid + type', () => {
    const req = resolveAddRequest(
      raw({ validate: false, type: 'ipod', volumeUuid: 'AAAA-BBBB', volumeName: 'TERAPOD' }),
      makeCtx()
    );
    expect(req.tier).toBe('config-inject');
    expect(req.injectedIdentity).toEqual({
      deviceType: 'ipod',
      volumeUuid: 'AAAA-BBBB',
      volumeName: 'TERAPOD',
    });
  });

  it('assembles InjectedIdentity from path + type (path-only)', () => {
    const req = resolveAddRequest(
      raw({ validate: false, type: 'echo-mini', path: '/mnt/echo' }),
      makeCtx()
    );
    expect(req.injectedIdentity).toEqual({ deviceType: 'echo-mini', path: '/mnt/echo' });
  });

  it('does not attach injectedIdentity outside config-inject', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', volumeUuid: 'AAAA' }), makeCtx());
    expect(req.injectedIdentity).toBeUndefined();
  });
});

// =============================================================================
// Pass-through fields
// =============================================================================

describe('resolveAddRequest: pass-through fields', () => {
  it('threads autoConfirm + force', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', yes: true, force: true }), makeCtx());
    expect(req.autoConfirm).toBe(true);
    expect(req.force).toBe(true);
  });

  it('defaults autoConfirm + force to false', () => {
    const req = resolveAddRequest(raw({ type: 'ipod' }), makeCtx());
    expect(req.autoConfirm).toBe(false);
    expect(req.force).toBe(false);
  });

  it('carries the artwork boolean onto the config patch', () => {
    const req = resolveAddRequest(raw({ type: 'ipod', artwork: false }), makeCtx());
    expect(req.config.artwork).toBe(false);
  });
});
