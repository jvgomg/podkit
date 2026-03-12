#!/usr/bin/env bun

import { parseArgs } from 'util';
import { renderAvatar } from '../src/render.js';
import { getAllTemplates } from '../src/models/index.js';
import type { IpodModelFamily, Expression, AvatarColor, Theme } from '../src/types.js';

const ALL_MODELS: IpodModelFamily[] = [
  'classic',
  'mini',
  'nano-tall',
  'nano-short',
  'nano-slim',
  'shuffle',
  'unknown',
];

const ALL_EXPRESSIONS: Expression[] = [
  'neutral',
  'happy',
  'excited',
  'sleepy',
  'concerned',
  'syncing',
  'satisfied',
];

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    expression: { type: 'string', default: 'neutral' },
    color: { type: 'string', default: 'silver' },
    theme: { type: 'string', default: 'auto' },
    'no-color': { type: 'boolean', default: false },
    'all-expressions': { type: 'boolean', default: false },
    'all-models': { type: 'boolean', default: false },
    gallery: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: bun run preview [options]

Options:
  --model <name>         Model family (classic, mini, nano-tall, nano-short, nano-slim, shuffle, unknown)
  --expression <name>    Expression (neutral, happy, excited, sleepy, concerned, syncing, satisfied)
  --color <name>         Color (silver, white, black, pink, blue, green, gold, red, purple, orange, yellow)
  --theme <name>         Theme (auto, dark, light)
  --no-color             Disable color output
  --all-expressions      Show all expressions for the given model
  --all-models           Show all models for the given expression
  --gallery              Gallery mode: all models side by side
  --help                 Show this help`);
  process.exit(0);
}

const color = (values.color ?? 'silver') as AvatarColor;
const expression = (values.expression ?? 'neutral') as Expression;
const theme = (values.theme ?? 'auto') as Theme;
const noColor = values['no-color'] ?? false;

function renderSingle(model: IpodModelFamily, expr: Expression, label?: string) {
  return renderAvatar({ model, color, expression: expr, theme, noColor, label: label ?? model });
}

function printSideBySide(renders: string[][], labels?: string[]) {
  const termWidth = process.stdout.columns || 80;
  const spacing = 3;

  // Calculate widths (strip ANSI for measurement)
  const widths = renders.map((lines) => {
    return Math.max(...lines.map((l) => stripAnsi(l).length));
  });

  const maxHeight = Math.max(...renders.map((r) => r.length));

  // Bottom-align: pad shorter renders with empty lines at the top
  const padded = renders.map((lines, i) => {
    const padTop = maxHeight - lines.length;
    const w = widths[i]!;
    const emptyLine = ' '.repeat(w);
    return [...Array(padTop).fill(emptyLine), ...lines];
  });

  // Group into rows that fit terminal width
  const rows: number[][] = [];
  let currentRow: number[] = [];
  let currentWidth = 0;

  for (let i = 0; i < renders.length; i++) {
    const needed = widths[i]! + (currentRow.length > 0 ? spacing : 0);
    if (currentRow.length > 0 && currentWidth + needed > termWidth) {
      rows.push(currentRow);
      currentRow = [i];
      currentWidth = widths[i]!;
    } else {
      currentRow.push(i);
      currentWidth += needed;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Print each row
  for (const row of rows) {
    for (let line = 0; line < maxHeight; line++) {
      const parts: string[] = [];
      for (const idx of row) {
        const text = padded[idx]![line] ?? '';
        const visLen = stripAnsi(text).length;
        const pad = widths[idx]! - visLen;
        parts.push(text + ' '.repeat(Math.max(0, pad)));
      }
      console.log(parts.join(' '.repeat(spacing)));
    }
    console.log();
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

if (values.gallery) {
  const renders = ALL_MODELS.map((m) => renderSingle(m, expression));
  printSideBySide(renders);
} else if (values['all-expressions']) {
  const model = (values.model ?? 'classic') as IpodModelFamily;
  const renders = ALL_EXPRESSIONS.map((e) => renderSingle(model, e, `${model} (${e})`));
  printSideBySide(renders);
} else if (values['all-models']) {
  const renders = ALL_MODELS.map((m) => renderSingle(m, expression));
  printSideBySide(renders);
} else {
  const model = (values.model ?? 'classic') as IpodModelFamily;
  const lines = renderSingle(model, expression);
  for (const line of lines) {
    console.log(line);
  }
}
