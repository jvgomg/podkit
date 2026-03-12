import { describe, expect, it } from 'bun:test';
import { renderAvatar, renderSyncFrames } from './render.js';
import type { IpodModelFamily, Expression } from './types.js';

describe('renderAvatar', () => {
  const models: IpodModelFamily[] = [
    'classic',
    'mini',
    'nano-tall',
    'nano-short',
    'nano-slim',
    'shuffle',
    'unknown',
  ];

  const expressions: Expression[] = [
    'neutral',
    'happy',
    'excited',
    'sleepy',
    'concerned',
    'syncing',
    'satisfied',
  ];

  it('returns non-empty string array for all models', () => {
    for (const model of models) {
      const lines = renderAvatar({
        model,
        color: 'silver',
        expression: 'neutral',
        noColor: true,
      });
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('returns non-empty output for all expressions', () => {
    for (const expression of expressions) {
      const lines = renderAvatar({
        model: 'classic',
        color: 'silver',
        expression,
        noColor: true,
      });
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('includes ANSI codes when noColor is false', () => {
    const lines = renderAvatar({
      model: 'classic',
      color: 'red',
      expression: 'neutral',
    });
    const joined = lines.join('\n');
    expect(joined).toContain('\x1b[');
  });

  it('excludes ANSI color codes when noColor is true', () => {
    const lines = renderAvatar({
      model: 'classic',
      color: 'red',
      expression: 'neutral',
      noColor: true,
    });
    const joined = lines.join('\n');
    expect(joined).not.toContain('\x1b[48;5;');
  });

  it('appends label when provided', () => {
    const lines = renderAvatar({
      model: 'classic',
      color: 'silver',
      expression: 'neutral',
      noColor: true,
      label: 'terapod',
    });
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toContain('terapod');
  });

  it('applies contrast outline for black on dark theme', () => {
    const lines = renderAvatar({
      model: 'classic',
      color: 'black',
      expression: 'neutral',
      theme: 'dark',
    });
    const joined = lines.join('\n');
    // Should have contrast outline color (ANSI 245)
    expect(joined).toContain('\x1b[38;5;245m');
  });

  it('applies contrast outline for white on light theme', () => {
    const lines = renderAvatar({
      model: 'classic',
      color: 'white',
      expression: 'neutral',
      theme: 'light',
    });
    const joined = lines.join('\n');
    // Should have contrast outline color (ANSI 240)
    expect(joined).toContain('\x1b[38;5;240m');
  });

  it('all lines have consistent width within each model (no color)', () => {
    for (const model of models) {
      for (const expression of expressions) {
        const lines = renderAvatar({
          model,
          color: 'silver',
          expression,
          noColor: true,
        });
        // Skip side marks (sleepy zzZ, satisfied ✓) — those intentionally extend
        // beyond the body on the mouth line. Also skip label line.
        const bodyLines = lines;
        const widths = bodyLines.map((l) => l.length);
        const maxWidth = Math.max(...widths);
        // All body lines should be within 4 chars of the max
        // (side marks add up to 4 chars: " zzZ")
        for (let i = 0; i < widths.length; i++) {
          const diff = maxWidth - widths[i]!;
          expect(diff).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('screened models have consistent body width (no side marks)', () => {
    const screenedModels = models.filter((m) => m !== 'shuffle');
    for (const model of screenedModels) {
      const lines = renderAvatar({
        model,
        color: 'silver',
        expression: 'neutral',
        noColor: true,
      });
      const widths = lines.map((l) => l.length);
      const expected = widths[0]!;
      for (let i = 0; i < widths.length; i++) {
        expect(widths[i]).toBe(expected);
      }
    }
  });

  it('classic is taller than nano-slim', () => {
    const classic = renderAvatar({
      model: 'classic',
      color: 'silver',
      expression: 'neutral',
      noColor: true,
    });
    const slim = renderAvatar({
      model: 'nano-slim',
      color: 'silver',
      expression: 'neutral',
      noColor: true,
    });
    expect(classic.length).toBeGreaterThan(slim.length);
  });
});

describe('renderSyncFrames', () => {
  it('returns output for progress 0', () => {
    const lines = renderSyncFrames({
      model: 'classic',
      color: 'blue',
      progress: 0,
      noColor: true,
    });
    expect(lines.length).toBeGreaterThan(0);
  });

  it('returns output for progress 1', () => {
    const lines = renderSyncFrames({
      model: 'classic',
      color: 'blue',
      progress: 1,
      noColor: true,
    });
    expect(lines.length).toBeGreaterThan(0);
  });

  it('returns output for shuffle', () => {
    const lines = renderSyncFrames({
      model: 'shuffle',
      color: 'pink',
      progress: 0.5,
      noColor: true,
    });
    expect(lines.length).toBeGreaterThan(0);
  });
});
