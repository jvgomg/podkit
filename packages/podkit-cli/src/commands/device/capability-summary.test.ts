import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { DeviceCapabilities, IpodIdentityAssessment } from '@podkit/core';
import {
  printCapabilitySummary,
  assertAssessmentSupported,
  confirmUnsupportedDeviceAdd,
} from './capability-summary.js';
import { OutputContext } from '../../output/index.js';
import { CliError } from '../../errors.js';
import { BufferSink } from '../../test-utils/buffer-sink.js';

const IPOD_CAPS_FULL: DeviceCapabilities = {
  artworkSources: ['database'],
  artworkMaxResolution: 240,
  supportedAudioCodecs: ['aac', 'mp3'],
  supportsVideo: true,
  audioNormalization: 'soundcheck',
  supportsAlbumArtistBrowsing: false,
};

const IPOD_CAPS_NO_ARTWORK: DeviceCapabilities = {
  artworkSources: [],
  artworkMaxResolution: null,
  supportedAudioCodecs: ['aac'],
  supportsVideo: false,
  audioNormalization: 'none',
  supportsAlbumArtistBrowsing: false,
};

const MASS_STORAGE_CAPS: DeviceCapabilities = {
  artworkSources: ['database', 'embedded'],
  artworkMaxResolution: 320,
  supportedAudioCodecs: ['aac', 'flac', 'mp3'],
  supportsVideo: false,
  audioNormalization: 'replaygain',
  supportsAlbumArtistBrowsing: true,
};

function makeOut(): { out: OutputContext; stdout: BufferSink; stderr: BufferSink } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = OutputContext.fromGlobalOpts(
    { json: false, quiet: false, verbose: 0, color: false, tips: false, tty: false },
    {},
    { stdout, stderr }
  );
  return { out, stdout, stderr };
}

describe('printCapabilitySummary — iPod', () => {
  it('renders full bullet list when artwork and video are supported', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, IPOD_CAPS_FULL, {
      kind: 'ipod',
      modelDisplay: 'iPod nano (5th Generation)',
    });
    expect(stdout.lines()).toEqual([
      'Capabilities:',
      '  + Music',
      '  + Artwork (max 240px)',
      '  + Video',
    ]);
  });

  it('renders negative bullets with model display when artwork/video unsupported', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, IPOD_CAPS_NO_ARTWORK, {
      kind: 'ipod',
      modelDisplay: 'iPod nano (2nd Generation)',
    });
    expect(stdout.lines()).toEqual([
      'Capabilities:',
      '  + Music',
      '  - Artwork (not supported on iPod nano (2nd Generation))',
      '  - Video (not supported on iPod nano (2nd Generation))',
    ]);
  });

  it('respects the indent option', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(
      out,
      IPOD_CAPS_FULL,
      { kind: 'ipod', modelDisplay: 'iPod video' },
      { indent: '  ' }
    );
    expect(stdout.lines()).toEqual([
      '  Capabilities:',
      '    + Music',
      '    + Artwork (max 240px)',
      '    + Video',
    ]);
  });

  it('renders no Podcasts bullet — podcast support is not a modelled capability', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, IPOD_CAPS_FULL, {
      kind: 'ipod',
      modelDisplay: 'iPod video',
    });
    expect(stdout.lines().some((l) => l.includes('Podcasts'))).toBe(false);
  });

  it('ignores firmwareCapabilities on the ipod branch (filter is mass-storage-only)', () => {
    const { out, stdout } = makeOut();
    const firmware: DeviceCapabilities = {
      ...IPOD_CAPS_FULL,
      supportedAudioCodecs: ['aac', 'mp3', 'wav', 'aiff'],
    };
    printCapabilitySummary(
      out,
      IPOD_CAPS_FULL,
      { kind: 'ipod', modelDisplay: 'iPod video' },
      { firmwareCapabilities: firmware }
    );
    // iPod path returns before the firmware-diff block; no sub-block rendered.
    const lines = stdout.lines();
    expect(lines.some((l) => l.includes('Firmware:'))).toBe(false);
    expect(lines.some((l) => l.includes('Podkit:'))).toBe(false);
    expect(lines.some((l) => l.includes('transcoded before transfer'))).toBe(false);
  });
});

describe('printCapabilitySummary — mass-storage', () => {
  it('renders the tabular layout', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, MASS_STORAGE_CAPS, { kind: 'mass-storage' });
    expect(stdout.lines()).toEqual([
      'Capabilities:',
      '  Audio Codecs:    aac, flac, mp3',
      '  Artwork:         database, embedded (max 320px)',
      '  Video:           off',
      '  Normalization:   replaygain',
      '  Album Artist:    on',
    ]);
  });

  it('respects the indent option', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, MASS_STORAGE_CAPS, { kind: 'mass-storage' }, { indent: '  ' });
    const lines = stdout.lines();
    expect(lines[0]).toBe('  Capabilities:');
    expect(lines[1]).toBe('    Audio Codecs:    aac, flac, mp3');
  });

  it('renders the Firmware/Podkit sub-block when firmwareCapabilities is a strict superset', () => {
    const { out, stdout } = makeOut();
    const operational: DeviceCapabilities = {
      ...MASS_STORAGE_CAPS,
      supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'opus'],
    };
    const firmware: DeviceCapabilities = {
      ...operational,
      supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'opus', 'wav', 'aiff'],
    };
    printCapabilitySummary(
      out,
      operational,
      { kind: 'mass-storage' },
      { firmwareCapabilities: firmware }
    );
    expect(stdout.lines()).toEqual([
      'Capabilities:',
      '  Audio Codecs:',
      '    Firmware:   aac, alac, mp3, flac, vorbis, opus, wav, aiff',
      '    Podkit:     aac, alac, mp3, flac, vorbis, opus',
      '                (wav, aiff transcoded before transfer)',
      '  Artwork:         database, embedded (max 320px)',
      '  Video:           off',
      '  Normalization:   replaygain',
      '  Album Artist:    on',
    ]);
  });

  it('collapses to a single Audio Codecs line when firmware == operational', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(
      out,
      MASS_STORAGE_CAPS,
      { kind: 'mass-storage' },
      { firmwareCapabilities: MASS_STORAGE_CAPS }
    );
    expect(stdout.lines()).toEqual([
      'Capabilities:',
      '  Audio Codecs:    aac, flac, mp3',
      '  Artwork:         database, embedded (max 320px)',
      '  Video:           off',
      '  Normalization:   replaygain',
      '  Album Artist:    on',
    ]);
  });
});

describe('assertAssessmentSupported', () => {
  let originalExitCode: typeof process.exitCode;
  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('returns silently when assessment is null', () => {
    const { out, stdout, stderr } = makeOut();
    assertAssessmentSupported(out, null);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe('');
  });

  it('returns silently when assessment lacks model', () => {
    const { out, stdout, stderr } = makeOut();
    assertAssessmentSupported(out, {} as IpodIdentityAssessment);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe('');
  });

  it('returns silently when unsupportedReason is absent', () => {
    const { out, stdout, stderr } = makeOut();
    const assessment = {
      model: { displayName: 'iPod video', generationId: 'video_g5' },
    } as unknown as IpodIdentityAssessment;
    assertAssessmentSupported(out, assessment);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe('');
  });

  it('throws CliError with UNSUPPORTED_DEVICE when unsupportedReason is present', () => {
    const { out, stdout, stderr } = makeOut();
    const assessment = {
      model: {
        displayName: 'iPod nano 6G',
        generationId: 'nano_6',
        unsupportedReason: {
          kind: 'unsupported-device',
          headline: 'iPod nano (6th Generation) is not supported by podkit.',
          docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
        },
      },
    } as unknown as IpodIdentityAssessment;

    let caught: unknown = undefined;
    try {
      assertAssessmentSupported(out, assessment);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).code).toBe('UNSUPPORTED_DEVICE');
    expect((caught as CliError).message).toContain('iPod nano (6th Generation)');
    expect(stderr.text()).toContain('iPod nano (6th Generation) is not supported');
    expect(stdout.text()).toContain('https://jvgomg.github.io/podkit/devices/supported-devices');
  });
});

// =============================================================================
// confirmUnsupportedDeviceAdd (TASK-317.03 — warn-allow flow)
// =============================================================================

describe('confirmUnsupportedDeviceAdd', () => {
  function makeUnsupportedAssessment(
    overrides: Partial<NonNullable<IpodIdentityAssessment['model']>> = {}
  ): IpodIdentityAssessment {
    return {
      model: {
        displayName: 'iPod nano (7th Generation)',
        generationId: 'nano_7g',
        family: 'iPod nano',
        ordinal: 7,
        checksumType: 'hashAB',
        source: 'usb',
        unsupportedReason: {
          kind: 'unsupported-device',
          headline:
            'iPod nano (7th Generation) is not supported by podkit (this generation cannot sync).',
          docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
        },
        ...overrides,
      },
      capabilities: null,
      needsChecksum: true,
      checksumType: 'hashAB',
      firmwareInquiry: 'present',
      existing: null,
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
    };
  }

  it('returns "supported" without prompting when assessment has no unsupportedReason', async () => {
    const { out } = makeOut();
    let calls = 0;
    const decision = await confirmUnsupportedDeviceAdd(
      out,
      {
        model: { displayName: 'nano 4G', generationId: 'nano_4g', source: 'usb' },
      } as unknown as IpodIdentityAssessment,
      {
        autoConfirm: false,
        confirmFn: async () => {
          calls += 1;
          return false;
        },
      }
    );
    expect(decision).toBe('supported');
    expect(calls).toBe(0);
  });

  it('returns "supported" for null / undefined assessments', async () => {
    const { out } = makeOut();
    expect(
      await confirmUnsupportedDeviceAdd(out, null, {
        autoConfirm: false,
        confirmFn: async () => false,
      })
    ).toBe('supported');
    expect(
      await confirmUnsupportedDeviceAdd(out, undefined, {
        autoConfirm: false,
        confirmFn: async () => false,
      })
    ).toBe('supported');
  });

  it('returns "add-anyway" without prompting when autoConfirm is true (--yes flips default)', async () => {
    const { out, stderr } = makeOut();
    let calls = 0;
    const decision = await confirmUnsupportedDeviceAdd(out, makeUnsupportedAssessment(), {
      autoConfirm: true,
      confirmFn: async () => {
        calls += 1;
        return false;
      },
    });
    expect(decision).toBe('add-anyway');
    expect(calls).toBe(0);
    // Canonical message is rendered to stderr (warn) regardless of autoConfirm.
    expect(stderr.text()).toContain('iPod nano (7th Generation) is not supported');
  });

  it('returns "cancelled" when user declines the prompt', async () => {
    const { out } = makeOut();
    const decision = await confirmUnsupportedDeviceAdd(out, makeUnsupportedAssessment(), {
      autoConfirm: false,
      confirmFn: async () => false,
    });
    expect(decision).toBe('cancelled');
  });

  it('returns "add-anyway" when user accepts the prompt', async () => {
    const { out } = makeOut();
    const decision = await confirmUnsupportedDeviceAdd(out, makeUnsupportedAssessment(), {
      autoConfirm: false,
      confirmFn: async () => true,
    });
    expect(decision).toBe('add-anyway');
  });

  it('NEVER mentions libgpod in user-facing copy (TASK-317.03 wording)', async () => {
    const { out, stdout, stderr } = makeOut();
    await confirmUnsupportedDeviceAdd(out, makeUnsupportedAssessment(), {
      autoConfirm: true,
      confirmFn: async () => true,
    });
    const all = stdout.text() + '\n' + stderr.text();
    expect(all.toLowerCase()).not.toContain('libgpod');
  });
});
