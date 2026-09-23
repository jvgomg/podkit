/**
 * Per-test state is a forward mutation, and stays one.
 *
 * ADR-028 rejected snapshot-based state layering in favour of `apply-state.sh`,
 * and adding a Proxmox lifecycle that CAN snapshot is exactly when that gets
 * quietly reversed — a rollback per test reads as an obvious speed-up until a
 * shared substrate is rolled out from under a concurrent run. Provisioning-level
 * snapshots are in scope; per-test ones are not.
 *
 * So this pins the boundary: nothing on the state-application path may touch a
 * snapshot, and the only snapshot the repo takes is the provisioning one.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { POST_PROVISION_SNAPSHOT, repoRoot } from '@podkit/substrate';

import { devTestingPackageRoot } from './runners/paths.js';

const APPLY_STATE = path.join(devTestingPackageRoot(), 'scripts', 'apply-state.sh');

/** Source files under a directory, excluding build output. */
function grepUnder(dir: string, pattern: string): string[] {
  const result = spawnSync(
    'grep',
    [
      '-rn',
      '--include=*.ts',
      '--exclude-dir=node_modules',
      '--exclude-dir=dist',
      '-E',
      pattern,
      dir,
    ],
    { cwd: repoRoot(), encoding: 'utf8' }
  );
  return result.stdout.split('\n').filter((line) => line.trim().length > 0);
}

describe('state layering', () => {
  it('applies state by mutating the substrate forward, never by snapshot', () => {
    // Executable lines only — the header is free to explain why there is no
    // snapshot here.
    const body = fs
      .readFileSync(APPLY_STATE, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(body).not.toMatch(/\bqm\b|snapshot|rollback|pvesh/i);
  });

  it('keeps snapshot CALLS out of the per-test runners and personas', () => {
    // Prose about why there are no snapshots is welcome; a call is not.
    const calls =
      '(\\.(snapshot|rollback|listSnapshots|deleteSnapshot)\\(|pveSealSnapshot|pveRecover)';
    for (const dir of [
      'test-packages/device-testing/src/runners',
      'test-packages/device-testing/src/system-states',
      'test-packages/device-testing/src/personas',
      'test-packages/device-testing/src/vm',
    ]) {
      expect(grepUnder(dir, calls)).toEqual([]);
    }
  });

  it('takes exactly one snapshot, and it is the provisioning one', () => {
    expect(POST_PROVISION_SNAPSHOT).toBe('podkit-provisioned');
    // Every caller names it through the constant, so a second snapshot cannot
    // appear without a second name appearing in the module that declares them.
    const named = grepUnder('test-packages', "'podkit-provisioned'").filter(
      (line) => !line.includes('.test.ts')
    );
    expect(named).toHaveLength(1);
    expect(named[0]).toContain('export const POST_PROVISION_SNAPSHOT');
  });
});
