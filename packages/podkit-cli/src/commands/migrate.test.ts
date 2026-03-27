import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { runMigrations } from '../config/migrations/index.js';
import { readConfigVersion, CURRENT_CONFIG_VERSION } from '../config/version.js';
import { simpleDiff, generateBackupPath, migrateCommand } from './migrate.js';
import { createTestContext } from '../config/migrations/test-utils.js';

describe('migrate command integration', () => {
  it('migrates a version-0 config to current version', async () => {
    // Create a temp config file without a version field (version 0)
    const tmpDir = mkdtempSync(join(tmpdir(), 'podkit-migrate-'));
    const configPath = join(tmpDir, 'config.toml');
    const originalContent = `# podkit config

quality = "high"

[music.main]
path = "/music"
`;
    writeFileSync(configPath, originalContent);

    // Read and migrate
    const content = readFileSync(configPath, 'utf-8');
    const version = readConfigVersion(content);
    expect(version).toBe(0);

    const result = await runMigrations(content, version, createTestContext());

    // Verify migration result
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(result.applied.length).toBeGreaterThanOrEqual(1);

    // Verify the migrated content has a version field
    const migratedVersion = readConfigVersion(result.content);
    expect(migratedVersion).toBe(CURRENT_CONFIG_VERSION);

    // Verify original content is preserved
    expect(result.content).toContain('quality = "high"');
    expect(result.content).toContain('[music.main]');
    expect(result.content).toContain('path = "/music"');

    // Simulate backup + write
    const backupPath = `${configPath}.backup.2026-03-19`;
    writeFileSync(backupPath, content);
    writeFileSync(configPath, result.content);

    // Verify files
    expect(readFileSync(backupPath, 'utf-8')).toBe(originalContent);
    expect(readFileSync(configPath, 'utf-8')).toBe(result.content);
  });

  it('reports no changes needed for current-version config', async () => {
    const content = `version = ${CURRENT_CONFIG_VERSION}\nquality = "high"\n`;
    const version = readConfigVersion(content);
    expect(version).toBe(CURRENT_CONFIG_VERSION);

    const result = await runMigrations(content, version, createTestContext());
    expect(result.applied).toEqual([]);
    expect(result.content).toBe(content);
  });
});

describe('simpleDiff', () => {
  it('shows added lines', () => {
    const diff = simpleDiff('a\nb', 'a\nx\nb');
    expect(diff).toContain('+ x');
  });

  it('shows removed lines', () => {
    const diff = simpleDiff('a\nb\nc', 'a\nc');
    expect(diff).toContain('- b');
  });

  it('returns empty for identical content', () => {
    const diff = simpleDiff('a\nb\nc', 'a\nb\nc');
    expect(diff).toEqual([]);
  });

  it('handles version insertion diff correctly', () => {
    const old = `# comment\nquality = "high"`;
    const migrated = `# comment\nversion = 1\n\nquality = "high"`;
    const diff = simpleDiff(old, migrated);

    // Should show version = 1 as added
    const addedLines = diff.filter((l) => l.startsWith('+'));
    expect(addedLines.some((l) => l.includes('version = 1'))).toBe(true);
  });
});

describe('generateBackupPath', () => {
  it('generates a date-based backup path', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'podkit-backup-'));
    const configPath = join(tmpDir, 'config.toml');

    const backupPath = generateBackupPath(configPath);
    // Should contain .backup. and a date
    expect(backupPath).toContain('.backup.');
    expect(backupPath).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('appends counter when backup already exists', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'podkit-backup-'));
    const configPath = join(tmpDir, 'config.toml');

    // Create the first backup
    const firstBackup = generateBackupPath(configPath);
    writeFileSync(firstBackup, 'backup1');

    // Second call should get a different path with counter
    const secondBackup = generateBackupPath(configPath);
    expect(secondBackup).not.toBe(firstBackup);
    expect(secondBackup).toMatch(/\.\d+$/);
  });

  it('increments counter past existing backups', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'podkit-backup-'));
    const configPath = join(tmpDir, 'config.toml');

    // Create first backup and .2 backup
    const first = generateBackupPath(configPath);
    writeFileSync(first, 'backup1');
    const second = generateBackupPath(configPath);
    writeFileSync(second, 'backup2');

    // Third should be .3
    const third = generateBackupPath(configPath);
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third).toMatch(/\.3$/);
  });
});

describe('migrateCommand action exit codes', () => {
  let savedExitCode: number | undefined;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode as number | undefined;
    process.exitCode = 0;
    savedEnv = process.env.PODKIT_CONFIG;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    if (savedEnv !== undefined) {
      process.env.PODKIT_CONFIG = savedEnv;
    } else {
      delete process.env.PODKIT_CONFIG;
    }
  });

  it('sets process.exitCode = 1 when config file does not exist', async () => {
    process.env.PODKIT_CONFIG = '/nonexistent/path/config.toml';

    const program = new Command('podkit');
    program.addCommand(migrateCommand);

    await program.parseAsync(['migrate'], { from: 'user' });

    expect(process.exitCode).toBe(1);
  });
});
