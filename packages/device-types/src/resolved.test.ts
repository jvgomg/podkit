/**
 * Unit tests for the resolution primitive — the building block every
 * other inheritance walk in podkit uses (config resolver, capability
 * resolver, content-paths resolver).
 */
import { describe, it, expect } from 'bun:test';
import { resolveChain, resolveChainOptional, projectResolved } from './resolved.js';

describe('resolveChain', () => {
  type Src = 'cli' | 'device' | 'global' | 'default';

  it('picks the first defined layer', () => {
    const r = resolveChain<string, Src>(
      [
        { value: 'from-cli', source: 'cli' },
        { value: 'from-device', source: 'device' },
        { value: 'from-global', source: 'global' },
      ],
      'fallback',
      'default'
    );
    expect(r).toEqual({ value: 'from-cli', source: 'cli' });
  });

  it('falls through undefined layers to the next defined one', () => {
    const r = resolveChain<string, Src>(
      [
        { value: undefined, source: 'cli' },
        { value: undefined, source: 'device' },
        { value: 'from-global', source: 'global' },
      ],
      'fallback',
      'default'
    );
    expect(r).toEqual({ value: 'from-global', source: 'global' });
  });

  it('falls through to the supplied default when every layer is undefined', () => {
    const r = resolveChain<string, Src>(
      [
        { value: undefined, source: 'cli' },
        { value: undefined, source: 'device' },
        { value: undefined, source: 'global' },
      ],
      'fallback',
      'default'
    );
    expect(r).toEqual({ value: 'fallback', source: 'default' });
  });

  it('treats falsy-but-defined values (0, empty string, false) as defined', () => {
    const r1 = resolveChain<number, Src>([{ value: 0, source: 'cli' }], 999, 'default');
    expect(r1).toEqual({ value: 0, source: 'cli' });

    const r2 = resolveChain<string, Src>([{ value: '', source: 'cli' }], 'fallback', 'default');
    expect(r2).toEqual({ value: '', source: 'cli' });

    const r3 = resolveChain<boolean, Src>([{ value: false, source: 'cli' }], true, 'default');
    expect(r3).toEqual({ value: false, source: 'cli' });
  });

  it('accepts an empty layers list (uses the default)', () => {
    const r = resolveChain<string, Src>([], 'fallback', 'default');
    expect(r).toEqual({ value: 'fallback', source: 'default' });
  });
});

describe('resolveChainOptional', () => {
  type Src = 'a' | 'b' | 'unset';

  it('returns the first defined layer', () => {
    const r = resolveChainOptional<number, Src>(
      [
        { value: undefined, source: 'a' },
        { value: 42, source: 'b' },
      ],
      'unset'
    );
    expect(r).toEqual({ value: 42, source: 'b' });
  });

  it('returns { value: undefined, source: emptySource } when nothing matches', () => {
    const r = resolveChainOptional<number, Src>(
      [
        { value: undefined, source: 'a' },
        { value: undefined, source: 'b' },
      ],
      'unset'
    );
    expect(r).toEqual({ value: undefined, source: 'unset' });
  });
});

describe('projectResolved', () => {
  it('projects a record of Resolved<T,S> down to plain values', () => {
    const resolved = {
      foo: { value: 'hello', source: 'preset' as const },
      bar: { value: 42, source: 'device-config' as const },
      baz: { value: true, source: 'default' as const },
    };
    const values = projectResolved(resolved);
    expect(values).toEqual({ foo: 'hello', bar: 42, baz: true });
  });

  it('preserves field order', () => {
    const resolved = {
      z: { value: 1, source: 'a' as const },
      a: { value: 2, source: 'b' as const },
    };
    const values = projectResolved(resolved);
    expect(Object.keys(values)).toEqual(['z', 'a']);
  });
});
