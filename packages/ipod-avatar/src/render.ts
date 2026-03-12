import type {
  IpodModelFamily,
  AvatarColor,
  Expression,
  Theme,
  RenderOptions,
  SyncFrameOptions,
  Colorize,
  FaceLines,
} from './types.js';
import { colorize as applyColor, needsContrastOutline, contrastOutlineColor, resetColor } from './colors.js';
import { getFace, getSyncFace, getShuffleBubble } from './expressions.js';
import { detectTheme } from './terminal.js';
import { getTemplate, getScreenWidth } from './models/index.js';
import { buildShuffle } from './models/shuffle.js';

export function renderAvatar(options: RenderOptions): string[] {
  const { model, color, expression, noColor } = options;
  const theme = detectTheme(options.theme);

  const colorFn: Colorize = (text) => applyColor(text, color, noColor);

  let lines: string[];

  let sideMark: string | undefined;

  if (model === 'shuffle') {
    const bubble = getShuffleBubble(expression);
    lines = buildShuffle({ bubble, colorize: colorFn });
  } else {
    const template = getTemplate(model);
    const screenWidth = getScreenWidth(model);
    const face = getFace(expression, screenWidth);
    sideMark = face.sideMark;
    lines = template.build(face, colorFn);
  }

  if (sideMark) {
    lines = applySideMark(lines, sideMark);
  }

  if (!noColor && needsContrastOutline(color, theme)) {
    lines = applyContrastOutline(lines, theme);
  }

  if (options.label) {
    lines.push(centerLabel(options.label, getTemplate(model).width));
  }

  return lines;
}

export function renderSyncFrames(options: SyncFrameOptions): string[] {
  const { model, color, progress, noColor } = options;
  const theme = detectTheme(options.theme);

  const colorFn: Colorize = (text) => applyColor(text, color, noColor);

  let lines: string[];

  if (model === 'shuffle') {
    const bubble = getShuffleBubble('syncing');
    lines = buildShuffle({ bubble, colorize: colorFn });
  } else {
    const template = getTemplate(model);
    const screenWidth = getScreenWidth(model);
    const face = getSyncFace(progress, screenWidth);
    lines = template.build(face, colorFn);
  }

  if (!noColor && needsContrastOutline(color, theme)) {
    lines = applyContrastOutline(lines, theme);
  }

  if (options.label) {
    lines.push(centerLabel(options.label, getTemplate(model).width));
  }

  return lines;
}

function applyContrastOutline(lines: string[], theme: 'dark' | 'light'): string[] {
  const outlineColor = contrastOutlineColor(theme);
  const reset = resetColor();
  return lines.map((line) => outlineColor + line + reset);
}

function applySideMark(lines: string[], mark: string): string[] {
  // Place the side mark on the mouth line (line index 3 = 4th line in art)
  const mouthLineIndex = 3;
  return lines.map((line, i) => {
    if (i === mouthLineIndex) {
      return line + ' ' + mark;
    }
    return line;
  });
}

function centerLabel(label: string, width: number): string {
  if (label.length >= width) return label;
  const left = Math.floor((width - label.length) / 2);
  return ' '.repeat(left) + label;
}
