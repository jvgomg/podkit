import { describe, expect, it } from 'bun:test';
import { getFace, getSyncFace, getShuffleBubble } from './expressions.js';
import type { Expression } from './types.js';

describe('getFace', () => {
  const expressions: Expression[] = [
    'neutral',
    'happy',
    'excited',
    'sleepy',
    'concerned',
    'syncing',
    'satisfied',
  ];

  it('returns eyes and mouth for all expressions', () => {
    for (const expr of expressions) {
      const face = getFace(expr, 10);
      expect(face.eyes).toBeTruthy();
      expect(face.mouth).toBeTruthy();
    }
  });

  it('pads face to screen width', () => {
    const face = getFace('neutral', 10);
    expect(face.eyes.length).toBe(10);
  });

  it('includes side mark for sleepy', () => {
    const face = getFace('sleepy', 10);
    expect(face.sideMark).toBe('zzZ');
  });

  it('includes side mark for satisfied', () => {
    const face = getFace('satisfied', 10);
    expect(face.sideMark).toBe('\u2713');
  });
});

describe('getSyncFace', () => {
  it('generates progress bar at 0%', () => {
    const face = getSyncFace(0, 10);
    expect(face.mouth).toContain('[');
    expect(face.mouth).toContain(']');
  });

  it('generates progress bar at 100%', () => {
    const face = getSyncFace(1, 10);
    expect(face.mouth).toContain('\u2588');
  });

  it('generates progress bar at 50%', () => {
    const face = getSyncFace(0.5, 10);
    expect(face.mouth).toContain('\u2588');
    expect(face.mouth).toContain('\u2591');
  });
});

describe('getShuffleBubble', () => {
  it('returns bubble lines for all expressions', () => {
    const expressions: Expression[] = [
      'neutral',
      'happy',
      'excited',
      'sleepy',
      'concerned',
      'syncing',
      'satisfied',
    ];

    for (const expr of expressions) {
      const bubble = getShuffleBubble(expr);
      expect(bubble.lines.length).toBeGreaterThan(0);
    }
  });
});
