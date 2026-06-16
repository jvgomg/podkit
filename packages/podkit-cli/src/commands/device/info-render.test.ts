import { describe, it, expect } from 'bun:test';
import type { ResolvedDeviceCapabilities } from '@podkit/device-types';
import type { ResolvedDeviceSettings } from '../../config/resolve.js';
import {
  buildSettingsRows,
  printSettingsZone,
  printSummaryRow,
  printSectionHeader,
  SUMMARY_LABEL_WIDTH,
} from './info-render.js';
import { OutputContext } from '../../output/index.js';
import { BufferSink } from '../../test-utils/buffer-sink.js';

function makeOut(): { out: OutputContext; stdout: BufferSink } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = OutputContext.fromGlobalOpts(
    { json: false, quiet: false, verbose: 0, color: false, tips: false, tty: false },
    {},
    { stdout, stderr }
  );
  return { out, stdout };
}

const BASE_SETTINGS: ResolvedDeviceSettings = {
  name: 'echomini',
  type: 'echo-mini',
  isDefault: false,
  connected: true,
  quality: { value: 'high', source: 'global-quality' },
  audio: { value: 'high', source: 'global-quality' },
  video: { value: null, source: 'unsupported' },
  artwork: { value: true, source: 'global' },
  checkArtwork: { value: false, source: 'default' },
  skipUpgrades: { value: false, source: 'default' },
  encoding: { value: undefined, source: 'default' },
  transferMode: { value: 'fast', source: 'default' },
  customBitrate: { value: undefined, source: 'default' },
  bitrateTolerance: { value: undefined, source: 'default' },
};

const PRESET_CAPS: ResolvedDeviceCapabilities = {
  supportedAudioCodecs: { value: ['aac', 'mp3'], source: 'preset' },
  artworkSources: { value: ['embedded'], source: 'preset' },
  artworkMaxResolution: { value: 127, source: 'preset' },
  supportsVideo: { value: false, source: 'preset' },
  audioNormalization: { value: 'none', source: 'preset' },
  supportsAlbumArtistBrowsing: { value: true, source: 'preset' },
};

describe('printSummaryRow — alignment', () => {
  it('pads label so every value column starts at the same offset', () => {
    const { out, stdout } = makeOut();
    printSummaryRow(out, 'Status', 'Mounted at /Volumes/Echo SD');
    printSummaryRow(out, 'Model', 'Echo Mini');
    printSummaryRow(out, 'Readiness', 'Ready');
    const lines = stdout.lines();
    // Exact prefix layout: 2 leading spaces + `<label>:` padded to
    // SUMMARY_LABEL_WIDTH + 2. Total prefix width = 2 + SUMMARY_LABEL_WIDTH + 2.
    const expectedPrefixLen = 2 + SUMMARY_LABEL_WIDTH + 2;
    for (const line of lines) {
      // Prefix must be exactly the right length, two leading spaces,
      // ASCII label + colon + trailing spaces filling to expectedPrefixLen.
      expect(line.slice(0, expectedPrefixLen)).toMatch(new RegExp(`^ {2}[A-Za-z]+: +$`));
    }
    // Value column starts at exactly expectedPrefixLen for every row.
    expect(lines[0]!.indexOf('Mounted at /Volumes/Echo SD')).toBe(expectedPrefixLen);
    expect(lines[1]!.indexOf('Echo Mini')).toBe(expectedPrefixLen);
    expect(lines[2]!.indexOf('Ready')).toBe(expectedPrefixLen);
  });
});

describe('printSectionHeader', () => {
  it('emits a blank line followed by the title', () => {
    const { out, stdout } = makeOut();
    printSectionHeader(out, 'Settings (resolved; [brackets] = inherited)');
    expect(stdout.lines()).toEqual(['', 'Settings (resolved; [brackets] = inherited)']);
  });
});

describe('buildSettingsRows', () => {
  it('emits manufacturer/productName rows when present', () => {
    const settings: ResolvedDeviceSettings = {
      ...BASE_SETTINGS,
      manufacturer: { value: 'FiiO Snowsky', source: 'preset' },
      productName: { value: 'Echo Mini', source: 'preset' },
    };
    const rows = buildSettingsRows(settings, PRESET_CAPS, { value: 'aac, mp3', source: 'global' });
    const labels = rows.map((r) => r.label);
    expect(labels.slice(0, 2)).toEqual(['Manufacturer', 'Product name']);
  });

  it('omits manufacturer/productName for iPod (no preset display)', () => {
    const rows = buildSettingsRows(BASE_SETTINGS, undefined, {
      value: 'aac, mp3',
      source: 'global',
    });
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain('Manufacturer');
    expect(labels).not.toContain('Product name');
  });

  it('always emits Music quality + Output codecs + Artwork rows', () => {
    const rows = buildSettingsRows(BASE_SETTINGS, undefined, {
      value: 'aac, mp3',
      source: 'global',
    });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('Music quality');
    expect(labels).toContain('Output codecs');
    expect(labels).toContain('Artwork');
  });

  it('marks Video quality with skipWhenUnavailable so unsupported devices hide it', () => {
    const rows = buildSettingsRows(BASE_SETTINGS, undefined, {
      value: 'aac, mp3',
      source: 'global',
    });
    const videoRow = rows.find((r) => r.label === 'Video quality');
    expect(videoRow?.skipWhenUnavailable).toBe(true);
  });

  it('surfaces device-config capability overrides but hides preset-source ones', () => {
    const caps: ResolvedDeviceCapabilities = {
      ...PRESET_CAPS,
      audioNormalization: { value: 'soundcheck', source: 'device-config' },
    };
    const rows = buildSettingsRows(BASE_SETTINGS, caps, {
      value: 'aac, mp3',
      source: 'global',
    });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('Normalization'); // device-config — surfaces
    expect(labels).not.toContain('Album artist'); // preset — hidden
  });
});

describe('printSettingsZone', () => {
  it('renders [bracketed] for inherited values and bare for device overrides', () => {
    const { out, stdout } = makeOut();
    const settings: ResolvedDeviceSettings = {
      ...BASE_SETTINGS,
      audio: { value: 'max', source: 'device' }, // explicit
      artwork: { value: true, source: 'global' }, // inherited
    };
    const rows = buildSettingsRows(settings, undefined, {
      value: 'aac, mp3',
      source: 'global',
    });
    printSettingsZone(out, rows);
    const text = stdout.text();
    // Explicit device override — no brackets, tail `device override`
    expect(text).toContain('Music quality: max  device override');
    // Inherited global — bracketed, with `from global` tail
    expect(text).toContain('Artwork:       [on]  from global');
  });

  it('skips rows whose source is unsupported when skipWhenUnavailable is set', () => {
    const { out, stdout } = makeOut();
    const rows = buildSettingsRows(BASE_SETTINGS, undefined, {
      value: 'aac, mp3',
      source: 'global',
    });
    printSettingsZone(out, rows);
    const text = stdout.text();
    expect(text).not.toContain('Video quality');
  });

  it('emits no output (and no header) when every row would be filtered', () => {
    const { out, stdout } = makeOut();
    printSettingsZone(out, [
      {
        label: 'Video quality',
        resolved: { value: null, source: 'unsupported' },
        skipWhenUnavailable: true,
      },
    ]);
    expect(stdout.lines()).toEqual([]);
  });
});
