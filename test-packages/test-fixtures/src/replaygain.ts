import { execFileSync } from 'node:child_process';

/**
 * Add ReplayGain tags to FLAC files using metaflac --add-replay-gain.
 * This computes gain from the actual audio content.
 */
export function addReplayGain(files: string[]): void {
  execFileSync('metaflac', ['--add-replay-gain', ...files], {
    stdio: 'pipe',
  });
}

/**
 * Set a specific ReplayGain track gain value on a FLAC file.
 */
export function setReplayGainTag(file: string, gain: number): void {
  // Remove existing ReplayGain tags first
  try {
    execFileSync(
      'metaflac',
      ['--remove-tag=REPLAYGAIN_TRACK_GAIN', '--remove-tag=REPLAYGAIN_TRACK_PEAK', file],
      { stdio: 'pipe' }
    );
  } catch {
    // Tags may not exist yet, that's fine
  }

  const gainStr = `${gain.toFixed(2)} dB`;
  execFileSync('metaflac', [`--set-tag=REPLAYGAIN_TRACK_GAIN=${gainStr}`, file], {
    stdio: 'pipe',
  });
}

/**
 * Pick a random gain value between -10.0 and +5.0 dB, different from the current one.
 */
export function pickRandomGain(current: number): number {
  let gain: number;
  do {
    // Random value between -10.0 and +5.0, rounded to 1 decimal
    gain = Math.round((Math.random() * 15 - 10) * 10) / 10;
  } while (Math.abs(gain - current) < 0.5);
  return gain;
}
