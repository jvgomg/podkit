/**
 * Tests for core resolution utilities
 */

import { describe, it, expect } from 'bun:test';
import { resolveNamedEntity, isPathLike, formatNotFoundError, getAvailableNames } from './core.js';

describe('isPathLike', () => {
  it('returns true for absolute paths', () => {
    expect(isPathLike('/Volumes/IPOD')).toBe(true);
    expect(isPathLike('/Users/james/ipod')).toBe(true);
  });

  it('returns true for relative paths with dot', () => {
    expect(isPathLike('./ipod')).toBe(true);
    expect(isPathLike('../ipod')).toBe(true);
    expect(isPathLike('.')).toBe(true);
    expect(isPathLike('..')).toBe(true);
  });

  it('returns true for paths with slashes', () => {
    expect(isPathLike('some/path')).toBe(true);
    expect(isPathLike('a/b/c')).toBe(true);
  });

  it('returns false for simple names', () => {
    expect(isPathLike('terapod')).toBe(false);
    expect(isPathLike('my-ipod')).toBe(false);
    expect(isPathLike('device_1')).toBe(false);
  });
});

describe('resolveNamedEntity', () => {
  const testEntities = {
    terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
    nanopod: { volumeUuid: 'DEF-456', volumeName: 'NANOPOD' },
  };

  describe('with requested name', () => {
    it('returns entity when found', () => {
      const result = resolveNamedEntity({
        entities: testEntities,
        defaultName: undefined,
        requestedName: 'terapod',
        entityType: 'device',
        addCommand: 'podkit device add <name>',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.entity.name).toBe('terapod');
        expect(result.entity.config).toEqual(testEntities.terapod);
      }
    });

    it('returns error when not found', () => {
      const result = resolveNamedEntity({
        entities: testEntities,
        defaultName: undefined,
        requestedName: 'unknown',
        entityType: 'device',
        addCommand: 'podkit device add <name>',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('unknown');
        expect(result.error).toContain('terapod, nanopod');
      }
    });
  });

  describe('with default name', () => {
    it('uses default when no name requested', () => {
      const result = resolveNamedEntity({
        entities: testEntities,
        defaultName: 'nanopod',
        requestedName: undefined,
        entityType: 'device',
        addCommand: 'podkit device add <name>',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.entity.name).toBe('nanopod');
      }
    });

    it('prefers requested name over default', () => {
      const result = resolveNamedEntity({
        entities: testEntities,
        defaultName: 'nanopod',
        requestedName: 'terapod',
        entityType: 'device',
        addCommand: 'podkit device add <name>',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.entity.name).toBe('terapod');
      }
    });
  });

  describe('without any name', () => {
    it('returns error when entities exist but no default', () => {
      const result = resolveNamedEntity({
        entities: testEntities,
        defaultName: undefined,
        requestedName: undefined,
        entityType: 'device',
        addCommand: 'podkit device add <name>',
        defaultCommand: 'podkit device default <name>',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('No default device set');
        expect(result.error).toContain('podkit device default <name>');
      }
    });

    it('returns error when no entities configured', () => {
      const result = resolveNamedEntity({
        entities: undefined,
        defaultName: undefined,
        requestedName: undefined,
        entityType: 'device',
        addCommand: 'podkit device add <name>',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('No devices configured');
        expect(result.error).toContain('podkit device add <name>');
      }
    });
  });
});

describe('formatNotFoundError', () => {
  it('lists available entities', () => {
    const error = formatNotFoundError('unknown', { foo: {}, bar: {} }, 'device');
    expect(error).toContain('Device "unknown" not found');
    expect(error).toContain('foo, bar');
  });

  it('handles empty entities', () => {
    const error = formatNotFoundError('unknown', undefined, 'device');
    expect(error).toContain('Device "unknown" not found');
    expect(error).toContain('No devices configured');
  });
});

describe('getAvailableNames', () => {
  it('returns names from entities', () => {
    const names = getAvailableNames({ a: {}, b: {}, c: {} });
    expect(names).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for undefined', () => {
    const names = getAvailableNames(undefined);
    expect(names).toEqual([]);
  });
});
