import { describe, it, expect } from 'bun:test';
import { runMigrations, getPendingMigrations } from './engine.js';
import { CURRENT_CONFIG_VERSION } from '../version.js';
import { MigrationAbortError } from './types.js';
import type { Migration } from './types.js';
import { createTestContext } from './test-utils.js';

describe('runMigrations', () => {
  it('applies migrations in order', async () => {
    const ctx = createTestContext();
    const result = await runMigrations('quality = "high"', 0, ctx);

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.applied.length).toBeGreaterThanOrEqual(1);
    expect(result.applied[0]!.fromVersion).toBe(0);
    expect(result.applied[0]!.toVersion).toBe(1);
    // Result should be bumped to the current version
    expect(result.content).toContain(`version = ${CURRENT_CONFIG_VERSION}`);
    // Original content should be preserved
    expect(result.content).toContain('quality = "high"');
  });

  it('returns no changes when already at current version', async () => {
    const ctx = createTestContext();
    const content = `version = ${CURRENT_CONFIG_VERSION}\nquality = "high"`;
    const result = await runMigrations(content, CURRENT_CONFIG_VERSION, ctx);

    expect(result.fromVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.applied).toEqual([]);
    expect(result.content).toBe(content);
  });

  it('returns correct metadata about applied migrations', async () => {
    const ctx = createTestContext();
    const result = await runMigrations('quality = "high"', 0, ctx);

    expect(result.applied[0]).toEqual({
      fromVersion: 0,
      toVersion: 1,
      description: 'Add config version field',
    });
  });

  it('passes content through unchanged when no migrations apply', async () => {
    const ctx = createTestContext();
    const content = `version = ${CURRENT_CONFIG_VERSION}\n[music.main]\npath = "/music"`;
    const result = await runMigrations(content, CURRENT_CONFIG_VERSION, ctx);

    expect(result.content).toBe(content);
  });

  it('propagates MigrationAbortError from interactive migration', async () => {
    // Create a fake interactive migration that aborts
    const abortingMigration: Migration = {
      fromVersion: 0,
      toVersion: 1,
      description: 'Aborting migration',
      type: 'interactive',
      async migrate(_content, _context) {
        throw new MigrationAbortError('User cancelled');
      },
    };

    // Temporarily replace registry to test abort propagation
    const { registry } = await import('./registry.js');
    const original = [...registry];
    registry.length = 0;
    registry.push(abortingMigration);

    const ctx = createTestContext();

    try {
      await expect(runMigrations('quality = "high"', 0, ctx)).rejects.toThrow(MigrationAbortError);

      await expect(runMigrations('quality = "high"', 0, ctx)).rejects.toThrow('User cancelled');
    } finally {
      // Restore original registry
      registry.length = 0;
      registry.push(...original);
    }
  });
});

describe('getPendingMigrations', () => {
  it('returns migrations for version 0', () => {
    const pending = getPendingMigrations(0);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0]!.fromVersion).toBe(0);
  });

  it('returns empty list when at current version', () => {
    const pending = getPendingMigrations(CURRENT_CONFIG_VERSION);
    expect(pending).toEqual([]);
  });

  it('returns empty list when above current version', () => {
    const pending = getPendingMigrations(CURRENT_CONFIG_VERSION + 1);
    expect(pending).toEqual([]);
  });

  it('returns migrations sorted by fromVersion', () => {
    const pending = getPendingMigrations(0);
    for (let i = 1; i < pending.length; i++) {
      expect(pending[i]!.fromVersion).toBeGreaterThanOrEqual(pending[i - 1]!.fromVersion);
    }
  });
});
