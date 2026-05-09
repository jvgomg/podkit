import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ALBUM, ARTIST, getTrackDef } from './names.js';

const DURATION_SECONDS = 5;

/**
 * Generate a FLAC file with a sine tone and embedded metadata.
 */
export function generateFlacTrack(dir: string, trackNumber: number, coverPath: string): string {
  const def = getTrackDef(trackNumber);
  const filename = `${String(trackNumber).padStart(2, '0')}-${slugify(def.title)}.flac`;
  const outFile = join(dir, filename);

  // Generate FLAC with sine tone and metadata
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${def.frequency}:duration=${DURATION_SECONDS}:sample_rate=44100`,
      '-c:a',
      'flac',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-metadata',
      `title=${def.title}`,
      '-metadata',
      `artist=${ARTIST}`,
      '-metadata',
      `album=${ALBUM}`,
      '-metadata',
      `track=${trackNumber}`,
      '-metadata',
      'date=2026',
      '-metadata',
      'genre=Electronic',
      outFile,
    ],
    { stdio: 'pipe' }
  );

  // Embed artwork using metaflac
  execFileSync('metaflac', [`--import-picture-from=${coverPath}`, outFile], {
    stdio: 'pipe',
  });

  return filename;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^aaa\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
