import { describe, expect, it } from 'bun:test';
import {
  validateDevice,
  isUnsupportedGeneration,
  formatValidationMessages,
  formatCapabilities,
  buildSyncWarnings,
} from './device-validation.js';
import type { DeviceIssue } from './device-validation.js';
import type { IpodDeviceInfo } from './types.js';

function makeDevice(overrides: Partial<IpodDeviceInfo> = {}): IpodDeviceInfo {
  return {
    modelName: 'iPod Video (60GB)',
    modelNumber: 'MA147',
    generation: 'video_1',
    capacity: 60,
    supportsArtwork: true,
    supportsVideo: true,
    supportsPhoto: true,
    supportsPodcast: true,
    ...overrides,
  };
}

/** Get the first issue from validation, failing if none exist. */
function firstIssue(device: Partial<IpodDeviceInfo>, mountPoint?: string): DeviceIssue {
  const result = validateDevice(makeDevice(device), mountPoint);
  expect(result.issues.length).toBeGreaterThanOrEqual(1);
  return result.issues[0]!;
}

describe('isUnsupportedGeneration', () => {
  it('returns true for iOS devices', () => {
    expect(isUnsupportedGeneration('touch_1')).toBe(true);
    expect(isUnsupportedGeneration('touch_4')).toBe(true);
    expect(isUnsupportedGeneration('iphone_1')).toBe(true);
    expect(isUnsupportedGeneration('iphone_4')).toBe(true);
    expect(isUnsupportedGeneration('ipad_1')).toBe(true);
  });

  it('returns true for buttonless Shuffles', () => {
    expect(isUnsupportedGeneration('shuffle_3')).toBe(true);
    expect(isUnsupportedGeneration('shuffle_4')).toBe(true);
  });

  it('returns true for Nano 6th gen', () => {
    expect(isUnsupportedGeneration('nano_6')).toBe(true);
  });

  it('returns false for supported devices', () => {
    expect(isUnsupportedGeneration('classic_1')).toBe(false);
    expect(isUnsupportedGeneration('video_1')).toBe(false);
    expect(isUnsupportedGeneration('nano_3')).toBe(false);
    expect(isUnsupportedGeneration('shuffle_1')).toBe(false);
    expect(isUnsupportedGeneration('shuffle_2')).toBe(false);
    expect(isUnsupportedGeneration('mini_1')).toBe(false);
    expect(isUnsupportedGeneration('unknown')).toBe(false);
  });
});

describe('validateDevice', () => {
  it('returns supported=true for a supported device', () => {
    const result = validateDevice(makeDevice());
    expect(result.supported).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('detects unsupported iOS device', () => {
    const result = validateDevice(
      makeDevice({ generation: 'touch_1', modelName: 'iPod Touch (1st Generation)' })
    );
    expect(result.supported).toBe(false);
    expect(result.issues).toHaveLength(1);
    const issue = firstIssue({ generation: 'touch_1' });
    expect(issue.type).toBe('unsupported_device');
    expect(issue.reason).toBe('ios_device');
    expect(issue.message).toContain('proprietary sync protocol');
    expect(issue.suggestion).toContain('jvgomg.github.io/podkit');
  });

  it('detects unsupported iPhone', () => {
    const result = validateDevice(makeDevice({ generation: 'iphone_1' }));
    expect(result.supported).toBe(false);
    expect(firstIssue({ generation: 'iphone_1' }).reason).toBe('ios_device');
  });

  it('detects unsupported iPad', () => {
    const result = validateDevice(makeDevice({ generation: 'ipad_1' }));
    expect(result.supported).toBe(false);
    expect(firstIssue({ generation: 'ipad_1' }).reason).toBe('ios_device');
  });

  it('detects buttonless Shuffle', () => {
    const result = validateDevice(makeDevice({ generation: 'shuffle_3' }));
    expect(result.supported).toBe(false);
    const issue = firstIssue({ generation: 'shuffle_3' });
    expect(issue.reason).toBe('buttonless_shuffle');
    expect(issue.message).toContain('buttonless');
    expect(issue.message).toContain('authentication hash');
  });

  it('detects Nano 6th gen', () => {
    const result = validateDevice(makeDevice({ generation: 'nano_6' }));
    expect(result.supported).toBe(false);
    const issue = firstIssue({ generation: 'nano_6' });
    expect(issue.reason).toBe('nano_6');
    expect(issue.message).toContain('different database format');
  });

  it('detects unknown model', () => {
    const result = validateDevice(makeDevice({ generation: 'unknown' }));
    expect(result.supported).toBe(true); // unknown is not unsupported, just a warning
    expect(result.issues).toHaveLength(1);
    const issue = firstIssue({ generation: 'unknown' });
    expect(issue.type).toBe('unknown_model');
    expect(issue.message).toContain('Could not identify');
    expect(issue.suggestion).toContain('podkit doctor --repair sysinfo-extended');
  });

  it('builds capability summary', () => {
    const result = validateDevice(
      makeDevice({ supportsArtwork: false, supportsVideo: false, supportsPodcast: false })
    );
    expect(result.capabilities).toEqual({
      music: true,
      artwork: false,
      video: false,
      podcast: false,
    });
  });

  it('warns about missing artwork support', () => {
    const result = validateDevice(makeDevice({ supportsArtwork: false }));
    expect(result.warnings.some((w) => w.type === 'no_artwork')).toBe(true);
  });

  it('warns about missing video support', () => {
    const result = validateDevice(makeDevice({ supportsVideo: false }));
    expect(result.warnings.some((w) => w.type === 'no_video')).toBe(true);
  });

  it('warns about missing podcast support', () => {
    const result = validateDevice(makeDevice({ supportsVideo: false, supportsPodcast: false }));
    expect(result.warnings.some((w) => w.type === 'no_podcast')).toBe(true);
  });

  it('has no warnings for fully capable device', () => {
    const result = validateDevice(makeDevice());
    expect(result.warnings).toHaveLength(0);
  });

  it('all error messages include docs link', () => {
    const generations = [
      'touch_1',
      'iphone_1',
      'ipad_1',
      'shuffle_3',
      'nano_6',
      'unknown',
    ] as const;

    for (const gen of generations) {
      const result = validateDevice(makeDevice({ generation: gen }));
      for (const issue of result.issues) {
        expect(issue.suggestion).toContain('jvgomg.github.io/podkit');
      }
    }
  });
});

describe('formatValidationMessages', () => {
  it('formats unsupported device as error', () => {
    const result = validateDevice(makeDevice({ generation: 'touch_1' }));
    const lines = formatValidationMessages(result);
    expect(lines[0]).toMatch(/^Error:/);
  });

  it('formats unknown model as warning', () => {
    const result = validateDevice(makeDevice({ generation: 'unknown' }));
    const lines = formatValidationMessages(result);
    expect(lines[0]).toMatch(/^Warning:/);
  });

  it('includes suggestion on next line', () => {
    const result = validateDevice(makeDevice({ generation: 'touch_1' }));
    const lines = formatValidationMessages(result);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toMatch(/^\s/);
  });

  it('returns empty for supported device', () => {
    const result = validateDevice(makeDevice());
    const lines = formatValidationMessages(result);
    expect(lines).toHaveLength(0);
  });
});

describe('formatCapabilities', () => {
  it('shows + for supported capabilities', () => {
    const device = makeDevice();
    const result = validateDevice(device);
    const lines = formatCapabilities(result.capabilities, device);
    expect(lines.some((l) => l.includes('+ Music'))).toBe(true);
    expect(lines.some((l) => l.includes('+ Artwork'))).toBe(true);
    expect(lines.some((l) => l.includes('+ Video'))).toBe(true);
  });

  it('shows - for unsupported capabilities with generation name', () => {
    const device = makeDevice({
      generation: 'nano_2',
      supportsVideo: false,
      supportsPodcast: false,
    });
    const result = validateDevice(device);
    const lines = formatCapabilities(result.capabilities, device);
    expect(lines.some((l) => l.includes('- Video') && l.includes('nano (2nd Generation)'))).toBe(
      true
    );
  });
});

describe('buildSyncWarnings', () => {
  it('returns empty when device supports everything', () => {
    const caps = { music: true, artwork: true, video: true, podcast: true };
    expect(buildSyncWarnings(caps, { hasVideo: true, hasArtwork: true })).toHaveLength(0);
  });

  it('warns about video when syncing video to non-video device', () => {
    const caps = { music: true, artwork: true, video: false, podcast: true };
    const warnings = buildSyncWarnings(caps, { hasVideo: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Video');
  });

  it('does not warn about video when not syncing video', () => {
    const caps = { music: true, artwork: true, video: false, podcast: true };
    expect(buildSyncWarnings(caps, { hasVideo: false })).toHaveLength(0);
  });

  it('warns about artwork when syncing artwork to non-artwork device', () => {
    const caps = { music: true, artwork: false, video: true, podcast: true };
    const warnings = buildSyncWarnings(caps, { hasArtwork: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('artwork');
  });
});
