/**
 * E2E tests for the `podkit init` command.
 *
 * Tests config file creation, --force overwrite, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../helpers/cli-runner';

describe('podkit init', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-init-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates config file at specified path', async () => {
    const configPath = join(tempDir, 'config.toml');
    const result = await runCli(['init', '--path', configPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created config file');
    expect(result.stdout).toContain(configPath);

    // Verify file exists (access resolves without throwing if file exists)
    await access(configPath);

    // Verify content
    const content = await readFile(configPath, 'utf-8');
    expect(content).toContain('# podkit configuration');
    expect(content).toContain('[music.main]');
    expect(content).toContain('[devices.ipod]');
  });

  it('creates parent directories if needed', async () => {
    const configPath = join(tempDir, 'nested', 'deeply', 'config.toml');
    const result = await runCli(['init', '--path', configPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created config file');

    // Verify file exists (access resolves without throwing if file exists)
    await access(configPath);
  });

  it('fails if config exists without --force', async () => {
    const configPath = join(tempDir, 'config.toml');

    // Create config first time
    const result1 = await runCli(['init', '--path', configPath]);
    expect(result1.exitCode).toBe(0);

    // Try to create again without --force
    const result2 = await runCli(['init', '--path', configPath]);

    expect(result2.exitCode).toBe(1);
    expect(result2.stderr).toContain('already exists');
    expect(result2.stderr).toContain('--force');
  });

  it('overwrites existing config with --force', async () => {
    const configPath = join(tempDir, 'config.toml');

    // Create config first time
    const result1 = await runCli(['init', '--path', configPath]);
    expect(result1.exitCode).toBe(0);

    // Overwrite with --force
    const result2 = await runCli(['init', '--path', configPath, '--force']);

    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).toContain('Created config file');
  });

  it('shows next steps in output', async () => {
    const configPath = join(tempDir, 'config.toml');
    const result = await runCli(['init', '--path', configPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Next steps');
    expect(result.stdout).toContain('Edit');
    expect(result.stdout).toContain('podkit device info');
    expect(result.stdout).toContain('podkit sync');
  });
});
