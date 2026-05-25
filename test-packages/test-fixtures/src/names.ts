export interface TrackName {
  title: string;
  frequency: number;
}

export const TRACK_NAMES: TrackName[] = [
  { title: 'AAA Tracky McTrackface', frequency: 440 },
  { title: 'AAA Beaty McBeatface', frequency: 880 },
  { title: 'AAA Synthy McSynthface', frequency: 660 },
  { title: 'AAA Bassy McBassface', frequency: 220 },
  { title: 'AAA Loopy McLoopface', frequency: 550 },
  { title: 'AAA Droppy McDropface', frequency: 330 },
  { title: 'AAA Fadey McFadeface', frequency: 770 },
  { title: 'AAA Clippy McClipface', frequency: 990 },
  { title: 'AAA Gritty McGritface', frequency: 1100 },
  { title: 'AAA Wubby McWubface', frequency: 275 },
];

export const ARTIST = 'AAA Testy McTestface';
export const ALBUM = 'AAA Album McAlbumface';

/**
 * Get the track name and frequency for a given track number (1-based).
 * For tracks beyond the palette, generates a name with incrementing frequency.
 */
export function getTrackDef(trackNumber: number): TrackName {
  const index = trackNumber - 1;
  if (index < TRACK_NAMES.length) {
    return TRACK_NAMES[index]!;
  }
  return {
    title: `AAA Track McTrackface ${String(trackNumber).padStart(2, '0')}`,
    frequency: 440 + (trackNumber - TRACK_NAMES.length) * 50,
  };
}
