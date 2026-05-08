/**
 * In-process unit tests for the `doctor` command's argv-level validation.
 *
 * The repair-requires-device / repair-requires-collection / diagnostic-only
 * paths are covered end-to-end in `doctor.e2e.test.ts`. What's left for this
 * unit tier is the Commander wiring of `--repair`'s `.choices()` list — that
 * list lives in our command definition and we want to lock its contract.
 */

import { describe, it, expect } from 'bun:test';
import { Command } from 'commander';
import { doctorCommand } from './doctor.js';

const repairOption = doctorCommand.options.find((o) => o.long === '--repair');
if (!repairOption) {
  throw new Error('doctorCommand has no --repair option — test setup invalid');
}

describe('doctor --repair .choices()', () => {
  it.concurrent('lists exactly the supported check IDs', () => {
    expect(repairOption.argChoices).toEqual([
      'artwork-rebuild',
      'artwork-reset',
      'orphan-files',
      'orphan-files-mass-storage',
      'sysinfo-consistency',
      'sysinfo-extended',
      'udev-rule',
    ]);
  });

  it.concurrent('rejects an unknown check ID at parse time, before action runs', async () => {
    // Build a throwaway parent program around a stub command that mirrors
    // doctor's --repair option. The stub action is a no-op — we only care
    // that Commander's choices() validation fires before action invocation.
    let actionRan = false;
    const stub = new Command('doctor').addOption(repairOption).action(() => {
      actionRan = true;
    });
    stub.exitOverride();
    stub.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    program.addCommand(stub);

    let err: unknown;
    try {
      await program.parseAsync(['doctor', '--repair', 'nonexistent-check'], { from: 'user' });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe('commander.invalidArgument');
    expect((err as Error).message).toContain('nonexistent-check');
    expect(actionRan).toBe(false);
  });

  it.concurrent('accepts a known check ID at parse time', async () => {
    let actionRan = false;
    const stub = new Command('doctor').addOption(repairOption).action(() => {
      actionRan = true;
    });
    stub.exitOverride();
    stub.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    program.addCommand(stub);

    await program.parseAsync(['doctor', '--repair', 'artwork-rebuild'], { from: 'user' });
    expect(actionRan).toBe(true);
  });
});
