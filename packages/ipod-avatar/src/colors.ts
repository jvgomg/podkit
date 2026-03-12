import type { AvatarColor } from './types.js';

interface ColorDef {
  fg256: number;
  bg256: number;
  label: string;
}

const COLOR_MAP: Record<AvatarColor, ColorDef> = {
  silver: { fg256: 7, bg256: 7, label: 'Silver' },
  white: { fg256: 15, bg256: 15, label: 'White' },
  black: { fg256: 232, bg256: 232, label: 'Black' },
  pink: { fg256: 218, bg256: 218, label: 'Pink' },
  blue: { fg256: 75, bg256: 75, label: 'Blue' },
  green: { fg256: 114, bg256: 114, label: 'Green' },
  gold: { fg256: 220, bg256: 220, label: 'Gold' },
  red: { fg256: 196, bg256: 196, label: 'Red' },
  purple: { fg256: 141, bg256: 141, label: 'Purple' },
  orange: { fg256: 208, bg256: 208, label: 'Orange' },
  yellow: { fg256: 226, bg256: 226, label: 'Yellow' },
};

export const ALL_COLORS: AvatarColor[] = [
  'silver',
  'white',
  'black',
  'pink',
  'blue',
  'green',
  'gold',
  'red',
  'purple',
  'orange',
  'yellow',
];

export function getColorLabel(color: AvatarColor): string {
  return COLOR_MAP[color].label;
}

export function colorize(text: string, color: AvatarColor, noColor = false): string {
  if (noColor) return text;
  const def = COLOR_MAP[color];
  return `\x1b[48;5;${def.bg256}m${text}\x1b[0m`;
}

export function needsContrastOutline(
  color: AvatarColor,
  theme: 'dark' | 'light',
): boolean {
  if (theme === 'dark' && color === 'black') return true;
  if (theme === 'light' && color === 'white') return true;
  return false;
}

export function contrastOutlineColor(theme: 'dark' | 'light'): string {
  // ANSI 245 = medium gray for dark terminals, 240 for light
  const code = theme === 'dark' ? 245 : 240;
  return `\x1b[38;5;${code}m`;
}

export function resetColor(): string {
  return '\x1b[0m';
}
