/**
 * Encoded Nano 7 video, probed: whatever the source shape, the output must
 * be H.264 Baseline at level <= 3.0, fit 432x240 with even dimensions and
 * the source aspect ratio, run at <= 30 fps, and carry AAC audio.
 *
 * Runs the libx264 path everywhere and the VideoToolbox path on macOS.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireFFmpeg, requireFfprobe } from '@podkit/test-fixtures';
import { probeVideo } from './probe.js';
import { calculateEffectiveSettings } from './quality.js';
import { transcodeVideo } from './transcode.js';
import { checkVideoCompatibility } from './compatibility.js';
import { DEVICE_PROFILES } from './types.js';

requireFFmpeg();
requireFfprobe();

const nano7 = DEVICE_PROFILES['ipod-nano-7g']!;

interface Source {
  name: string;
  size: string;
  rate: number;
  /** Expected encoded frame. */
  expected: [number, number];
  yuv444?: boolean;
}

// Each source is H.264 High at a level above 3.0 (the odd-sized one, which
// 4:2:0 cannot carry, is High 4:4:4 scaled after testsrc2, which rounds to
// even sizes), so none can pass through.
const sources: Source[] = [
  { name: 'wide', size: '1920x804', rate: 60, expected: [432, 180] },
  { name: 'portrait', size: '720x1280', rate: 30, expected: [134, 240] },
  { name: 'small', size: '176x144', rate: 25, expected: [176, 144] },
  { name: 'odd', size: '853x479', rate: 50, expected: [426, 240], yuv444: true },
];

const encoders = [
  { label: 'libx264', hardware: false },
  ...(process.platform === 'darwin' ? [{ label: 'VideoToolbox', hardware: true }] : []),
];

function probeStreams(file: string) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,profile,level,width,height,avg_frame_rate',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' }
  );
  return JSON.parse(out).streams as Array<Record<string, string | number>>;
}

describe('Nano 7 video output', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'podkit-nano7-video-'));
    for (const s of sources) {
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${s.size}:rate=${s.rate}:duration=2`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2:sample_rate=48000',
        ...(s.yuv444
          ? ['-vf', `scale=${s.size.replace('x', ':')}`, '-c:v', 'libx264', '-pix_fmt', 'yuv444p']
          : ['-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p']),
        '-c:a',
        'aac',
        '-shortest',
        join(dir, `${s.name}.${s.yuv444 ? 'mkv' : 'mp4'}`),
      ]);
    }
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  for (const encoder of encoders) {
    for (const s of sources) {
      it(`${encoder.label}: ${s.name} ${s.size}@${s.rate} → Baseline <=3.0, fitted, <=30 fps, AAC`, async () => {
        const input = join(dir, `${s.name}.${s.yuv444 ? 'mkv' : 'mp4'}`);
        const analysis = await probeVideo(input);
        expect(checkVideoCompatibility(analysis, nano7).status).toBe('transcode');

        const settings = {
          ...calculateEffectiveSettings(analysis, 'high', nano7),
          useHardwareAcceleration: encoder.hardware,
        };
        expect([settings.targetWidth, settings.targetHeight]).toEqual(s.expected);

        const output = join(dir, `${s.name}-${encoder.label}.m4v`);
        await transcodeVideo(input, output, settings);

        const streams = probeStreams(output);
        const video = streams.find((x) => x.codec_type === 'video')!;
        const audio = streams.find((x) => x.codec_type === 'audio')!;
        const [num, den] = String(video.avg_frame_rate).split('/').map(Number);
        expect({
          codec: video.codec_name,
          profile: String(video.profile).toLowerCase().includes('baseline'),
          levelOk: Number(video.level) > 0 && Number(video.level) <= 30,
          size: [Number(video.width), Number(video.height)],
          fpsOk: num! / den! <= 30,
          audio: audio?.codec_name,
        }).toEqual({
          codec: 'h264',
          profile: true,
          levelOk: true,
          size: s.expected,
          fpsOk: true,
          audio: 'aac',
        });
      });
    }
  }
});
