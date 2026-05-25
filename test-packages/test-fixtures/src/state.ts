import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FixtureState {
  tracks: number;
  format: string;
  artwork: { color: string };
  replaygain: { gain: number };
  bitrate: number | null;
}

const STATE_FILE = '.fixtures.json';

export const DEFAULT_STATE: FixtureState = {
  tracks: 3,
  format: 'flac',
  artwork: { color: 'blue' },
  replaygain: { gain: -1.0 },
  bitrate: null,
};

export function readState(dir: string): FixtureState | null {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as FixtureState;
  } catch {
    return null;
  }
}

export function writeState(dir: string, state: FixtureState): void {
  const path = join(dir, STATE_FILE);
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}
