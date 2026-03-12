import type { Theme } from './types.js';

export function detectTheme(override?: Theme): 'dark' | 'light' {
  if (override && override !== 'auto') return override;

  // Check COLORFGBG (format: "fg;bg" where higher bg = light)
  const colorfgbg = process.env['COLORFGBG'];
  if (colorfgbg) {
    const parts = colorfgbg.split(';');
    const bg = parseInt(parts[parts.length - 1] ?? '', 10);
    if (!isNaN(bg)) {
      return bg > 8 ? 'light' : 'dark';
    }
  }

  // Heuristic from TERM_PROGRAM
  const termProgram = process.env['TERM_PROGRAM'];
  if (termProgram) {
    const lightTerminals = ['Apple_Terminal'];
    if (lightTerminals.includes(termProgram)) {
      return 'light';
    }
  }

  // Fallback: assume dark
  return 'dark';
}

export function shouldShowAvatar(options: {
  noAvatar?: boolean;
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  configEnabled?: boolean;
}): boolean {
  if (options.noAvatar) return false;
  if (options.json) return false;
  if (options.quiet) return false;
  if (options.configEnabled === false) return false;

  // Check if stdout is a TTY
  if (typeof process.stdout?.isTTY === 'undefined' || !process.stdout.isTTY) {
    return false;
  }

  return true;
}
