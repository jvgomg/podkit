import type { ModelTemplate } from '../types.js';

// All lines must be exactly 12 chars wide (10 inner + 2 outer │)
export const miniTemplate: ModelTemplate = {
  family: 'mini',
  wheelStyle: 'small',
  width: 12,
  height: 10,
  build(face, colorize) {
    const c = (s: string) => colorize(s);
    return [
      '\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E',
      '\u2502\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\u2502',
      `\u2502\u2502${face.eyes}\u2502\u2502`,
      `\u2502\u2502${face.mouth}\u2502\u2502`,
      '\u2502\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\u2502',
      // │ + 10▓ + │ = 12
      `\u2502${c('\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593')}\u2502`,
      // │ + ▓▓ + ╭────╮ + ▓▓ + │ = 1+2+6+2+1 = 12
      `\u2502${c('\u2593\u2593')}\u256D\u2500\u2500\u2500\u2500\u256E${c('\u2593\u2593')}\u2502`,
      // │ + ▓▓ + │  ● │ + ▓▓ + │ = 1+2+6+2+1 = 12
      `\u2502${c('\u2593\u2593')}\u2502  \u25CF \u2502${c('\u2593\u2593')}\u2502`,
      // │ + ▓▓ + ╰────╯ + ▓▓ + │ = 12
      `\u2502${c('\u2593\u2593')}\u2570\u2500\u2500\u2500\u2500\u256F${c('\u2593\u2593')}\u2502`,
      '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F',
    ];
  },
};

export const SCREEN_WIDTH = 8;
