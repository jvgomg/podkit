import { atom } from 'jotai';

export type ShuffleMode = 'off' | 'songs' | 'albums';
export type RepeatMode = 'off' | 'one' | 'all';

export const shuffleModeAtom = atom<ShuffleMode>('off');
export const repeatModeAtom = atom<RepeatMode>('off');

/** Cycle shuffle mode: off → songs → albums → off */
export const toggleShuffleAtom = atom(null, (get, set) => {
  const modes: ShuffleMode[] = ['off', 'songs', 'albums'];
  const current = modes.indexOf(get(shuffleModeAtom));
  set(shuffleModeAtom, modes[(current + 1) % modes.length]!);
});

/** Cycle repeat mode: off → one → all → off */
export const toggleRepeatAtom = atom(null, (get, set) => {
  const modes: RepeatMode[] = ['off', 'one', 'all'];
  const current = modes.indexOf(get(repeatModeAtom));
  set(repeatModeAtom, modes[(current + 1) % modes.length]!);
});
