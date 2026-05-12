import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { DeviceCapabilities, IpodIdentityAssessment } from '@podkit/core';
import { printCapabilitySummary, assertAssessmentSupported } from './capability-summary.js';
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

  it('renders + Podcasts when supportsPodcast=true is passed', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, IPOD_CAPS_FULL, {
      kind: 'ipod',
      modelDisplay: 'iPod video',
      supportsPodcast: true,
    });
    expect(stdout.lines()).toEqual([
      'Capabilities:',
      '  + Music',
      '  + Artwork (max 240px)',
      '  + Video',
      '  + Podcasts',
    ]);
  });

  it('renders - Podcasts (not supported) when supportsPodcast=false is passed', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, IPOD_CAPS_NO_ARTWORK, {
      kind: 'ipod',
      modelDisplay: 'iPod shuffle (1st Generation)',
      supportsPodcast: false,
    });
    expect(stdout.lines()).toEqual([
      'Capabilities:',
      '  + Music',
      '  - Artwork (not supported on iPod shuffle (1st Generation))',
      '  - Video (not supported on iPod shuffle (1st Generation))',
      '  - Podcasts (not supported on iPod shuffle (1st Generation))',
    ]);
  });

  it('does not render Podcasts when supportsPodcast is omitted (default — add.ts behavior)', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, IPOD_CAPS_FULL, {
      kind: 'ipod',
      modelDisplay: 'iPod video',
    });
    expect(stdout.lines()).not.toContain('  + Podcasts');
    expect(stdout.lines()).not.toContain('  - Podcasts');
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
      '  Video:           no',
      '  Normalization:   replaygain',
      '  Album Artist:    yes',
    ]);
  });

  it('respects the indent option', () => {
    const { out, stdout } = makeOut();
    printCapabilitySummary(out, MASS_STORAGE_CAPS, { kind: 'mass-storage' }, { indent: '  ' });
    const lines = stdout.lines();
    expect(lines[0]).toBe('  Capabilities:');
    expect(lines[1]).toBe('    Audio Codecs:    aac, flac, mp3');
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

  it('returns silently when notSupportedReason is absent', () => {
    const { out, stdout, stderr } = makeOut();
    const assessment = {
      model: { displayName: 'iPod video', generationId: 'video_g5' },
    } as unknown as IpodIdentityAssessment;
    assertAssessmentSupported(out, assessment);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe('');
  });

  it('throws CliError with UNSUPPORTED_DEVICE when notSupportedReason is present', () => {
    const { out, stdout, stderr } = makeOut();
    const assessment = {
      model: {
        displayName: 'iPod nano 6G',
        generationId: 'nano_6',
        notSupportedReason: 'iPod nano (6th Generation) is not supported by podkit.',
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
