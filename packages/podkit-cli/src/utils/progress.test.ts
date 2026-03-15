import { describe, expect, it } from 'bun:test';
import { formatProgressLine, truncateTrackName } from './progress.js';

describe('truncateTrackName', () => {
  it('returns empty string for undefined', () => {
    expect(truncateTrackName(undefined)).toBe('');
  });

  it('returns name unchanged when within limit', () => {
    expect(truncateTrackName('Short', 40)).toBe('Short');
  });

  it('truncates with ellipsis when exceeding limit', () => {
    expect(truncateTrackName('A Very Long Track Name', 10)).toBe('A Very ...');
  });
});

describe('formatProgressLine', () => {
  const bar = '[======>       ] 50%';
  const barLength = bar.length; // 20
  // eslint-disable-next-line no-control-regex
  const ansiPrefix = /\r\x1b\[K/;

  it('fits output within terminal width', () => {
    const line = formatProgressLine({
      bar,
      phase: 'Transcoding',
      trackName: 'A Really Long Track Name That Would Normally Overflow',
      speed: 1.5,
      terminalWidth: 60,
    });
    // Strip ANSI escape prefix
    const visible = line.replace(ansiPrefix, '');
    expect(visible.length).toBeLessThanOrEqual(60);
  });

  it('omits track name when terminal is too narrow', () => {
    const line = formatProgressLine({
      bar,
      phase: 'Transcoding',
      trackName: 'Some Track',
      terminalWidth: barLength + 'Transcoding'.length + 3, // barely fits base
    });
    const visible = line.replace(ansiPrefix, '');
    expect(visible).not.toContain('Some Track');
    expect(visible).toContain('Transcoding');
  });

  it('shows full track name when terminal is wide enough', () => {
    const line = formatProgressLine({
      bar,
      phase: 'Transcoding',
      trackName: 'Short',
      terminalWidth: 120,
    });
    const visible = line.replace(ansiPrefix, '');
    expect(visible).toContain('Short');
  });

  it('includes speed when provided', () => {
    const line = formatProgressLine({
      bar,
      phase: 'Transcoding',
      speed: 2.3,
      terminalWidth: 80,
    });
    const visible = line.replace(ansiPrefix, '');
    expect(visible).toContain('(2.3x)');
  });

  it('works without track name', () => {
    const line = formatProgressLine({
      bar,
      phase: 'Copying',
      terminalWidth: 80,
    });
    const visible = line.replace(ansiPrefix, '');
    expect(visible).toBe(`${bar} Copying`);
  });

  it('truncates track name to fill available width exactly', () => {
    const longName = 'A'.repeat(100);
    const line = formatProgressLine({
      bar,
      phase: 'Transcoding',
      trackName: longName,
      terminalWidth: 60,
    });
    const visible = line.replace(ansiPrefix, '');
    expect(visible.length).toBeLessThanOrEqual(60);
    expect(visible).toContain('...');
  });
});
