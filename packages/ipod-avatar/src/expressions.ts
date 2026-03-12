import type { Expression, FaceLines } from './types.js';

interface ExpressionDef {
  eyes: string;
  mouth: string;
  sideMark?: string;
}

const EXPRESSION_DEFS: Record<Expression, ExpressionDef> = {
  neutral: {
    eyes: '\u25D5    \u25D5',
    mouth: ' \u2570\u2500\u2500\u256F ',
  },
  happy: {
    eyes: '\u25D5    \u25D5',
    mouth: ' \u2570\u25BD\u256F ',
  },
  excited: {
    eyes: '\u2605    \u2605',
    mouth: ' \u2570\u25BD\u256F ',
  },
  sleepy: {
    eyes: '\u2500    \u2500',
    mouth: ' \u2570\u2500\u2500\u256F ',
    sideMark: 'zzZ',
  },
  concerned: {
    eyes: '\u25D5    \u25D5',
    mouth: ' \u256D\u2500\u2500\u256E ',
  },
  syncing: {
    eyes: '\u25D5    \u25D5',
    mouth: '[\u2588\u2588\u2591\u2591\u2591\u2591]',
  },
  satisfied: {
    eyes: '\u25D5    \u25D5',
    mouth: ' \u2570\u25BD\u256F ',
    sideMark: '\u2713',
  },
};

export function getFace(expression: Expression, screenWidth: number): FaceLines {
  const def = EXPRESSION_DEFS[expression];
  const eyes = centerText(def.eyes, screenWidth);
  const mouth = centerText(def.mouth, screenWidth);

  return { eyes, mouth, sideMark: def.sideMark };
}

export function getSyncFace(progress: number, screenWidth: number): FaceLines {
  const def = EXPRESSION_DEFS.syncing;
  const eyes = centerText(def.eyes, screenWidth);

  const barWidth = screenWidth - 2;
  const filled = Math.round(progress * barWidth);
  const empty = barWidth - filled;
  const bar = '[' + '\u2588'.repeat(filled) + '\u2591'.repeat(empty) + ']';
  const mouth = centerText(bar, screenWidth);

  return { eyes, mouth };
}

export interface ShuffleBubble {
  lines: string[];
}

const SHUFFLE_BUBBLES: Record<Expression, string[]> = {
  neutral: ['\u266A \u266B'],
  happy: ['\u266A \u266B \u266A'],
  excited: ['\u2605 \u266A \u2605'],
  sleepy: ['z z Z'],
  concerned: ['! . .'],
  syncing: ['\u25B6 \u266B'],
  satisfied: ['\u2713 \u266A'],
};

export function getShuffleBubble(expression: Expression): ShuffleBubble {
  return { lines: SHUFFLE_BUBBLES[expression] };
}

function centerText(text: string, width: number): string {
  const visLen = stripAnsi(text).length;
  if (visLen >= width) return text;
  const left = Math.floor((width - visLen) / 2);
  const right = width - visLen - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
