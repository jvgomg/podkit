/**
 * Locks `predictArtworkScaleSize` against real FFmpeg output. If FFmpeg ever
 * stops honouring `force_divisible_by=2`, or the scale filter syntax changes,
 * this test catches the drift before the matrix reference model goes stale.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { requireFFmpeg, requireFfprobe } from '@podkit/test-fixtures';

import { predictArtworkScaleSize } from './ffmpeg-prediction.js';

requireFFmpeg();
requireFfprobe();

const SOURCE_SIZE = 1024;

let workDir: string;
let sourcePng: string;

async function generateSquarePng(path: string, size: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      `color=c=red:s=${size}x${size}:d=0.04`,
      '-frames:v',
      '1',
      '-y',
      path,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg gen failed: ${stderr}`))
    );
  });
}

async function scaleAndProbeWidth(input: string, output: string, maxDim: number): Promise<number> {
  const filter = `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuvj420p`;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-i', input, '-vf', filter, '-frames:v', '1', '-y', output]);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg scale failed: ${stderr}`))
    );
  });

  const probe = await new Promise<string>((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=width',
      '-of',
      'csv=p=0',
      output,
    ]);
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`ffprobe failed: ${stderr}`))
    );
  });
  return Number.parseInt(probe, 10);
}

describe('predictArtworkScaleSize', () => {
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'podkit-ffmpeg-pred-'));
    sourcePng = join(workDir, 'source.png');
    await generateSquarePng(sourcePng, SOURCE_SIZE);
    // sanity: source exists
    await writeFile(join(workDir, '.touch'), '');
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it.each([
    { max: 127, expected: 126 },
    { max: 320, expected: 320 },
    { max: 500, expected: 500 },
    { max: 2048, expected: SOURCE_SIZE },
  ])('matches real FFmpeg output (max=$max → $expected)', async ({ max, expected }) => {
    const output = join(workDir, `out-${max}.jpg`);
    const real = await scaleAndProbeWidth(sourcePng, output, max);
    expect(predictArtworkScaleSize(SOURCE_SIZE, max)).toBe(expected);
    expect(real).toBe(expected);
  });
});
