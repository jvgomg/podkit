/**
 * Docker-gated contract tests for `podkit device add` verification tiers.
 *
 * These tests pin the `--no-verify` / `--no-validate` behaviour described in
 * doc-045 at the Docker harness boundary. They do NOT start a Navidrome
 * container — they use only the CLI and a temp config, exercising the
 * config-inject tier (--no-validate) which is entirely device-free.
 *
 * ## Why Docker-gated?
 *
 * The `--no-validate` tier asserts zero device I/O — it writes a config row
 * straight from CLI args. That contract is safe to express here because it
 * has no external dependencies beyond a temp filesystem and the built CLI.
 * The Docker gate is the correct home for the --no-verify tier's headless
 * contract once the harness can mount a synthetic iPod volume; until then,
 * the SCSI-gap caveat (see below) is documented in a test comment rather than
 * asserted.
 *
 * ## Known limitation — Docker SCSI gap (doc-046)
 *
 * The --no-verify (trust-disk) tier requires on-disk SysInfo. If SysInfo is
 * absent, podkit refuses and tells the user to run `podkit doctor`. But
 * `podkit doctor --repair sysinfo-extended` writes SysInfoExtended via
 * SCSI/USB firmware inquiry, which may be unavailable inside the container.
 * Checksum-based iPod generations (hash58/72/AB) cannot sync without
 * SysInfoExtended written somewhere. Current recommended workflow: run
 * `podkit doctor --repair sysinfo-extended` once on an SCSI-capable host,
 * then use the iPod from Docker. See doc-046 for the full risk assessment.
 *
 * A meaningful `--no-verify` assertion (confirming trust-disk proceeds when
 * SysInfo is present) requires a synthetic iPod volume mounted in the
 * container. That is not currently wired into the Docker harness. When it is,
 * add a case here asserting:
 *   - `--no-verify` + SysInfo present → exit 0, verification = 'trusted-disk'
 *   - `--no-verify` + SysInfo absent  → exit 1, doctor hint in stderr
 *
 * To run this suite:
 *   bun run test:e2e:docker
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCli, runCliJson } from '@podkit/e2e-shared';
import { isDockerAvailable } from '../sources/subsonic.js';

/**
 * JSON success envelope produced by `podkit device add --format json`.
 * Mirrors `DeviceAddSuccess` in `packages/podkit-cli/src/commands/device/output-types.ts`.
 * Defined locally because the type is not yet re-exported from `podkit/types`.
 */
interface DeviceAddJsonSuccess {
  success: true;
  device?: { name: string; [key: string]: unknown };
  saved?: boolean;
  isDefault?: boolean;
  /**
   * Verification tier that ran (doc-045).
   * `config-only` = `--no-validate`; `trusted-disk` = `--no-verify`; `verified` = default.
   */
  verification?: 'verified' | 'trusted-disk' | 'config-only';
}

// =============================================================================
// Harness setup — Docker gate
// =============================================================================

let tempDir: string;

beforeAll(async () => {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error(
      'Docker is not available — required for the device-add docker suite. Run `bun run test:e2e:docker` with Docker running.'
    );
  }

  tempDir = await mkdtemp(join(tmpdir(), `podkit-device-add-docker-${randomUUID().slice(0, 8)}-`));
});

afterAll(async () => {
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
});

// =============================================================================
// --no-validate (config-inject tier): zero device I/O
// =============================================================================

describe('podkit device add --no-validate (config-inject, Docker context)', () => {
  /**
   * Core contract: --no-validate writes a device config row from CLI args
   * with ZERO device I/O. The device does not need to exist. The iPod does not
   * need to be mounted. No SysInfo is consulted. This is the correct tier for
   * automated provisioning inside containers.
   */
  it('adds an iPod device by volume UUID with zero device dependency (exit 0)', async () => {
    const configPath = join(tempDir, `config-uuid-${randomUUID().slice(0, 8)}.toml`);
    await writeFile(configPath, 'version = 2\n');

    const result = await runCli([
      '--config',
      configPath,
      '--device',
      'testipod',
      'device',
      'add',
      '--type',
      'ipod',
      '--no-validate',
      '--volume-uuid',
      'DOCKER-TEST-UUID-1234',
      '--yes',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Added to config');

    const config = await readFile(configPath, 'utf-8');
    expect(config).toContain('[devices.testipod]');
    expect(config).toContain('DOCKER-TEST-UUID-1234');
  });

  it('outputs JSON with verification = "config-only"', async () => {
    const configPath = join(tempDir, `config-json-${randomUUID().slice(0, 8)}.toml`);
    await writeFile(configPath, 'version = 2\n');

    const { result, json } = await runCliJson<DeviceAddJsonSuccess>([
      '--config',
      configPath,
      '--json',
      '--device',
      'testipod',
      'device',
      'add',
      '--type',
      'ipod',
      '--no-validate',
      '--volume-uuid',
      'DOCKER-TEST-UUID-5678',
    ]);

    expect(result.exitCode).toBe(0);
    expect(json).not.toBeNull();
    expect(json!.success).toBe(true);
    expect(json!.device?.name).toBe('testipod');
    // doc-045: JSON success envelope includes verification tier.
    expect(json!.verification).toBe('config-only');
  });

  it('adds a mass-storage device by path with zero device dependency (exit 0)', async () => {
    const configPath = join(tempDir, `config-ms-${randomUUID().slice(0, 8)}.toml`);
    await writeFile(configPath, 'version = 2\n');

    // Mass-storage devices are path-anchored (resolved by mount path, not
    // volume UUID), so `--path` is required even under `--no-validate`.
    // config-inject does no device I/O, so the path need not exist here.
    const result = await runCli([
      '--config',
      configPath,
      '--device',
      'echomini',
      'device',
      'add',
      '--type',
      'echo-mini',
      '--no-validate',
      '--path',
      '/mnt/echo-mini',
      '--yes',
    ]);

    expect(result.exitCode).toBe(0);
    // Mass-storage add uses its own success renderer:
    // `Device "<name>" added to config (<Product>).`
    expect(result.stdout).toContain('added to config');

    const config = await readFile(configPath, 'utf-8');
    expect(config).toContain('[devices.echomini]');
  });

  it('errors on --no-validate without a complete identity (exit 1)', async () => {
    const configPath = join(tempDir, `config-incomplete-${randomUUID().slice(0, 8)}.toml`);
    await writeFile(configPath, 'version = 2\n');

    // No --volume-uuid and no --path: incomplete identity.
    const result = await runCli([
      '--config',
      configPath,
      '--device',
      'testipod',
      'device',
      'add',
      '--type',
      'ipod',
      '--no-validate',
      '--yes',
    ]);

    expect(result.exitCode).toBe(1);
    // Should not have written a device row.
    const config = await readFile(configPath, 'utf-8');
    expect(config).not.toContain('[devices.testipod]');
  });
});

// =============================================================================
// --no-verify (trust-disk tier): SCSI-gap caveat documented
// =============================================================================

describe('podkit device add --no-verify (trust-disk, Docker context)', () => {
  /**
   * CAVEAT — SCSI gap (doc-046):
   *
   * A meaningful --no-verify assertion requires a synthetic iPod volume with
   * on-disk SysInfo mounted in the container. The current Docker harness does
   * not provide this. When it does, add:
   *
   *   - case: --no-verify + SysInfo present → exit 0, verification = 'trusted-disk'
   *   - case: --no-verify + SysInfo absent  → exit 1, stderr contains 'podkit doctor'
   *
   * The absence of these cases here is intentional and tracked in doc-046.
   * Until the harness can mount a synthetic iPod, the trust-disk contract is
   * covered by device-add.unit.test.ts (trust-disk tier, doc-045).
   */
  // These cases require a synthetic iPod volume (with / without SysInfo) mounted
  // inside the container — not yet wired into the Docker harness. They are
  // skipped here and covered by device-add.unit.test.ts (trust-disk tier).
  it.skip('--no-verify + SysInfo present: proceeds with verification = "trusted-disk" (requires synthetic iPod mount in harness)', () => {});

  it.skip('--no-verify + SysInfo absent: exits 1 with podkit doctor hint (SCSI-gap — see doc-046)', () => {});
});
