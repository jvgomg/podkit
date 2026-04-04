import type { Track } from './types.js';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface QueueContext {
  tracks: Track[];
  startIndex: number;
}
