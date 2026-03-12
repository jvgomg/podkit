import type { ModelTemplate } from '../types.js';
import type { ShuffleBubble } from '../expressions.js';

export interface ShuffleRenderOptions {
  bubble: ShuffleBubble;
  colorize: (s: string) => string;
}

export function buildShuffle(opts: ShuffleRenderOptions): string[] {
  const c = opts.colorize;
  const lines: string[] = [];

  for (const bubbleLine of opts.bubble.lines) {
    lines.push('  ' + bubbleLine);
  }

  lines.push(
    ` ${c('\u256D\u2500\u2500\u2500\u256E')}`,
    ` ${c('\u2502   \u2502')}`,
    ` ${c('\u2502 \u25B6 \u2502')}`,
    ` ${c('\u2502   \u2502')}`,
    ` ${c('\u2570\u2500\u2500\u2500\u256F')}`,
  );

  return lines;
}

export const shuffleTemplate: ModelTemplate = {
  family: 'shuffle',
  wheelStyle: 'none',
  width: 7,
  height: 6,
  build(_face, colorize) {
    // Shuffle doesn't use face - it uses bubbles via buildShuffle
    // This is a fallback for neutral
    return buildShuffle({
      bubble: { lines: ['\u266A \u266B'] },
      colorize,
    });
  },
};
