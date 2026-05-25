import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateArtwork, pickRandomColor } from './artwork.js';
import { generateFlacTrack } from './audio.js';
import { type AudioFormat, convertTrack, validateBitrate } from './convert.js';
import { addReplayGain, pickRandomGain, setReplayGainTag } from './replaygain.js';
import { DEFAULT_STATE, type FixtureState, readState, writeState } from './state.js';

export interface GenerateOptions {
  output: string;
  tracks?: number;
  artwork?: string | true;
  format?: AudioFormat;
  bitrate?: number;
  replaygain?: number | true;
}

export function generate(options: GenerateOptions): void {
  const dir = resolve(options.output);
  mkdirSync(dir, { recursive: true });

  const currentState = readState(dir) ?? { ...DEFAULT_STATE };
  const newState: FixtureState = { ...currentState };

  // Determine track count
  const trackCount = options.tracks ?? currentState.tracks;
  newState.tracks = trackCount;

  // Determine artwork color
  let artworkColor = currentState.artwork.color;
  if (options.artwork === true) {
    artworkColor = pickRandomColor(currentState.artwork.color);
  } else if (typeof options.artwork === 'string') {
    artworkColor = options.artwork;
  }
  newState.artwork = { color: artworkColor };

  // Determine format
  const format = options.format ?? (currentState.format as AudioFormat);
  newState.format = format;

  // Determine bitrate
  const bitrate = options.bitrate ?? currentState.bitrate;
  newState.bitrate = bitrate;
  if (bitrate !== null && bitrate !== undefined) {
    validateBitrate(bitrate);
  }

  // Determine ReplayGain
  let replaygainValue = currentState.replaygain.gain;
  if (options.replaygain === true) {
    replaygainValue = pickRandomGain(currentState.replaygain.gain);
  } else if (typeof options.replaygain === 'number') {
    replaygainValue = options.replaygain;
  }
  newState.replaygain = { gain: replaygainValue };

  // Print generation parameters
  console.log('Generation parameters:');
  console.log(`  Output:      ${dir}`);
  console.log(`  Tracks:      ${trackCount}`);
  console.log(`  Format:      ${format}`);
  console.log(`  Artwork:     ${artworkColor}`);
  console.log(`  ReplayGain:  ${replaygainValue} dB`);
  if (bitrate !== null && bitrate !== undefined) {
    console.log(`  Bitrate:     ${bitrate} kbps`);
  }
  console.log('');

  // Clean existing audio files
  cleanAudioFiles(dir);

  // Generate artwork
  const coverPath = join(dir, 'cover.jpg');
  console.log(`Generating ${artworkColor} artwork...`);
  generateArtwork(coverPath, artworkColor);

  // Generate FLAC tracks
  const flacFiles: string[] = [];
  for (let i = 1; i <= trackCount; i++) {
    console.log(`Generating track ${i}/${trackCount}...`);
    const filename = generateFlacTrack(dir, i, coverPath);
    flacFiles.push(join(dir, filename));
  }

  // Apply ReplayGain
  if (replaygainValue === DEFAULT_STATE.replaygain.gain && !options.replaygain) {
    // Default case: compute from audio content (deterministic since audio is the same)
    console.log('Adding ReplayGain tags...');
    addReplayGain(flacFiles);
  } else {
    // Specific gain value: set manually on each file
    console.log(`Setting ReplayGain to ${replaygainValue} dB...`);
    for (const file of flacFiles) {
      setReplayGainTag(file, replaygainValue);
    }
  }

  // Convert to target format if not FLAC
  if (format !== 'flac') {
    console.log(`Converting to ${format}...`);
    for (const flacFile of flacFiles) {
      convertTrack(flacFile, dir, format, bitrate ?? undefined);
      // Remove the intermediate FLAC file
      unlinkSync(flacFile);
    }
  }

  // Write state
  writeState(dir, newState);

  console.log(`\nGenerated ${trackCount} ${format.toUpperCase()} tracks in ${dir}`);
  listFiles(dir);
}

function cleanAudioFiles(dir: string): void {
  if (!existsSync(dir)) return;
  const extensions = ['.flac', '.mp3', '.m4a', '.ogg'];
  for (const file of readdirSync(dir)) {
    if (extensions.some((ext) => file.endsWith(ext)) || file === 'cover.jpg') {
      unlinkSync(join(dir, file));
    }
  }
}

function listFiles(dir: string): void {
  console.log('\nFiles:');
  const files = readdirSync(dir).sort();
  for (const f of files) {
    if (f === '.fixtures.json') continue;
    console.log(`  ${f}`);
  }
}
