import { describe, expect, it } from 'bun:test';
import { VERSION } from './index';

describe('podkit-core', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
