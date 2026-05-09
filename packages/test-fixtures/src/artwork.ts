import { execFileSync } from 'node:child_process';

export const COLORS = [
  'blue',
  'red',
  'green',
  'yellow',
  'purple',
  'orange',
  'cyan',
  'magenta',
  'white',
  'black',
] as const;

export type Color = (typeof COLORS)[number];

export const DEFAULT_COLOR: Color = 'blue';

export function isValidColor(value: string): value is Color {
  return (COLORS as readonly string[]).includes(value);
}

/**
 * Pick a random color from the palette that differs from the current one.
 */
export function pickRandomColor(current: string): Color {
  const candidates = COLORS.filter((c) => c !== current);
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

/**
 * Generate a 500x500 solid-color JPEG image using FFmpeg.
 */
export function generateArtwork(outputPath: string, color: string): void {
  execFileSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=500x500:d=1`, '-frames:v', '1', outputPath],
    { stdio: 'pipe' }
  );
}
