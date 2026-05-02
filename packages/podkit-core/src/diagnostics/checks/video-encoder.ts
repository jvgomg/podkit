/**
 * Video encoder availability diagnostic check.
 *
 * podkit transcodes video to H.264 for iPod compatibility. The required
 * encoder differs by platform: VideoToolbox (h264_videotoolbox) when hardware
 * acceleration is available on macOS, libx264 software encoding otherwise.
 *
 * If neither is present, video sync silently produces no tracks (the bug this
 * check is designed to catch).
 */

import { spawn } from 'node:child_process';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';

async function ffmpegEncoders(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-encoders'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffmpeg -encoders exited ${code}`));
    });
  });
}

export const videoEncoderCheck: DiagnosticCheck = {
  id: 'video-encoder',
  name: 'Video Encoder (H.264)',
  applicableTo: ['ipod', 'mass-storage'],
  scope: 'system',

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    let encoders: string;
    try {
      encoders = await ffmpegEncoders();
    } catch {
      return {
        status: 'skip',
        summary: 'FFmpeg not available (see FFmpeg check)',
        repairable: false,
      };
    }

    const hasLibx264 = encoders.includes('libx264');
    const hasVideoToolbox = encoders.includes('h264_videotoolbox');
    const isDarwin = process.platform === 'darwin';

    // libx264 works everywhere and is the universal fallback. VideoToolbox is
    // only used on macOS, but its absence isn't fatal — libx264 covers it.
    if (hasLibx264) {
      return {
        status: 'pass',
        summary:
          isDarwin && hasVideoToolbox
            ? 'libx264 + h264_videotoolbox available'
            : 'libx264 available',
        repairable: false,
        details: { libx264: true, h264_videotoolbox: hasVideoToolbox, platform: process.platform },
      };
    }

    // No libx264. macOS may still get by with VideoToolbox, but we'd rather
    // libx264 be installed for fallback consistency.
    if (isDarwin && hasVideoToolbox) {
      return {
        status: 'warn',
        summary: 'h264_videotoolbox only — libx264 missing (recommended for fallback)',
        repairable: false,
        details: {
          libx264: false,
          h264_videotoolbox: true,
          platform: process.platform,
          repairAdvice:
            'Install libx264 so video transcoding works without hardware acceleration:\n' +
            '    brew install x264 && brew reinstall ffmpeg',
        },
      };
    }

    return {
      status: 'fail',
      summary: 'No H.264 encoder available — video transcoding will fail',
      repairable: false,
      details: {
        libx264: false,
        h264_videotoolbox: hasVideoToolbox,
        platform: process.platform,
        repairAdvice:
          'Install an H.264 encoder:\n' +
          '    macOS:         brew install ffmpeg (includes libx264)\n' +
          '    Debian/Ubuntu: sudo apt install ffmpeg (libx264 enabled by default)\n' +
          '    Alpine:        apk add ffmpeg (libx264 in main repo)',
      },
    };
  },
};
