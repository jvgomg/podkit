/**
 * Tests for the shared FFmpeg failure describer.
 *
 * A bare exit code is not a diagnosis. TASK-501 spent four CI runs inferring
 * ENOENT from `254` and still could not tell an unreadable input from an
 * unwritable output, because the sync layer reported only the number. FFmpeg
 * says which on stderr; these pin that it is carried.
 */

import { describe, expect, it } from 'bun:test';
import { describeFFmpegFailure } from './ffmpeg-error.js';

describe('describeFFmpegFailure', () => {
  it('surfaces the first FFmpeg diagnostic, stripped of its component prefix', () => {
    const stderr = [
      'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
      '  configuration: --prefix=/opt --enable-gpl',
      'Input #0, flac, from /music/track.flac:',
      '[out#0/ipod @ 0x55f1] Error opening output /tmp/gone/out.m4a: No such file or directory',
      'Error opening output file /tmp/gone/out.m4a.',
      'Error opening output files: No such file or directory',
    ].join('\n');

    // The first diagnostic is the one that names the path; the two after it
    // are FFmpeg's generic summaries.
    expect(describeFFmpegFailure(254, stderr)).toBe(
      'FFmpeg exited with code 254: Error opening output /tmp/gone/out.m4a: No such file or directory'
    );
  });

  it('distinguishes an unreadable input from an unwritable output', () => {
    const stderr = '[in#0 @ 0x55f1] Error opening input: No such file or directory';
    expect(describeFFmpegFailure(254, stderr)).toContain('Error opening input');
  });

  it('recognises the video path’s diagnostics too', () => {
    // These were the patterns `video/transcode.ts` matched before both paths
    // shared one describer.
    expect(describeFFmpegFailure(1, 'Output file does not contain any stream')).toContain(
      'does not contain any stream'
    );
    expect(describeFFmpegFailure(1, 'Conversion failed!')).toContain('Conversion failed!');
    expect(describeFFmpegFailure(1, 'Invalid data found when processing input')).toContain(
      'Invalid data found'
    );
  });

  it('falls back to the bare code when stderr carries no diagnostic', () => {
    expect(describeFFmpegFailure(1, 'ffmpeg version 9.0.1\n  configuration: --prefix=/opt')).toBe(
      'FFmpeg exited with code 1'
    );
    expect(describeFFmpegFailure(null, '')).toBe('FFmpeg exited with code null');
  });

  it('truncates a runaway diagnostic line', () => {
    const long = `Error opening output ${'x'.repeat(500)}`;
    const described = describeFFmpegFailure(254, long);
    expect(described.length).toBeLessThan(300);
    expect(described.endsWith('…')).toBe(true);
  });
});
