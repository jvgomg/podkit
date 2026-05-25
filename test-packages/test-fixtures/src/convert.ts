import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

export type AudioFormat = 'flac' | 'mp3' | 'aac' | 'ogg';

export const VALID_FORMATS: AudioFormat[] = ['flac', 'mp3', 'aac', 'ogg'];

const DEFAULT_BITRATES: Record<string, number> = {
  mp3: 320,
  aac: 256,
  ogg: 256,
};

export function isValidFormat(value: string): value is AudioFormat {
  return (VALID_FORMATS as string[]).includes(value);
}

function getExtension(format: AudioFormat): string {
  if (format === 'aac') return 'm4a';
  return format;
}

function getCodecArgs(format: AudioFormat, bitrate: number): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-ar', '44100', '-ac', '2'];
    case 'aac':
      return ['-c:a', 'aac', '-b:a', `${bitrate}k`, '-ar', '44100'];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', `${bitrate}k`];
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Convert a FLAC file to a lossy format. Returns the output filename.
 */
export function convertTrack(
  flacPath: string,
  outputDir: string,
  format: AudioFormat,
  bitrate?: number
): string {
  const br = bitrate ?? DEFAULT_BITRATES[format] ?? 256;
  const ext = getExtension(format);
  const outName = basename(flacPath, '.flac') + '.' + ext;
  const outFile = join(outputDir, outName);

  execFileSync('ffmpeg', ['-y', '-i', flacPath, ...getCodecArgs(format, br), outFile], {
    stdio: 'pipe',
  });

  return outName;
}

export function validateBitrate(bitrate: number): void {
  if (bitrate < 64 || bitrate > 320) {
    console.error('Error: Bitrate must be between 64 and 320 kbps.');
    process.exit(1);
  }
}
