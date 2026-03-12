import type { ModelTemplate } from '../types.js';

export const nanoSlimTemplate: ModelTemplate = {
  family: 'nano-slim',
  wheelStyle: 'small',
  width: 10,
  height: 10,
  build(face, colorize) {
    const c = (s: string) => colorize(s);
    return [
      '\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E',
      '\u2502\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2510\u2502',
      `\u2502\u2502${face.eyes}\u2502\u2502`,
      `\u2502\u2502${face.mouth}\u2502\u2502`,
      '\u2502\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2518\u2502',
      `\u2502${c('\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593')}\u2502`,
      `\u2502${c('\u2593\u2593')}\u256D\u2500\u2500\u256E${c('\u2593\u2593')}\u2502`,
      `\u2502${c('\u2593\u2593')}\u2502\u25CF \u2502${c('\u2593\u2593')}\u2502`,
      `\u2502${c('\u2593\u2593')}\u2570\u2500\u2500\u256F${c('\u2593\u2593')}\u2502`,
      '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F',
    ];
  },
};

export const SCREEN_WIDTH = 6;
