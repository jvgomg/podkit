/**
 * `bootstrap-pve.sh --print-only` is a runbook, so it has to be pasteable.
 *
 * The script exists in two halves that must not diverge: it either *runs* the
 * phase-1 commands, or it *prints* them for a human who would rather paste them
 * by hand or read them before trusting a script with their hypervisor.
 * Generating both from one file is what stops the runbook drifting from the
 * automation — but only if what it prints actually parses.
 *
 * That is not hypothetical. The first version printed
 *
 *     ssh host 'mkdir -p $(… sed -n 's/…/p')/snippets'
 *
 * where the inner `sed` quotes closed the outer `ssh` quoting early. It ran
 * correctly (run mode substitutes the path on this side and never emits that
 * string) and it read plausibly, and it could not be pasted. A runbook that is
 * subtly unpasteable is worse than no runbook, because the reader trusts it.
 *
 * So: shell out to `bash -n`, which parses without executing. Nothing here
 * contacts a hypervisor — `--print-only` skips every preflight, which is what
 * makes it testable on a machine that has no PVE anywhere near it.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

import { repoRoot } from './paths.js';

const BOOTSTRAP = path.join(
  repoRoot(),
  'test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh'
);

/** Run the bootstrap in print-only mode and return what it would execute. */
function printedRunbook(args: readonly string[]): string {
  const result = spawnSync('bash', [BOOTSTRAP, ...args, '--print-only'], {
    encoding: 'utf8',
    // A fixed key path so the printed text is stable regardless of whose
    // machine this runs on. Print-only never reads it.
    env: { ...process.env, PODKIT_SSH_PUBKEY: '/nonexistent/id_ed25519.pub' },
  });
  expect(result.status, `bootstrap-pve.sh --print-only failed: ${result.stderr}`).toBe(0);
  return result.stdout;
}

/** The emitted commands, with the `==>` progress lines stripped out. */
function commandsOnly(runbook: string): string {
  return runbook
    .split('\n')
    .filter((line) => !line.startsWith('==>'))
    .join('\n');
}

/**
 * The emitted commands as LOGICAL lines — backslash continuations joined.
 *
 * The snippet step is deliberately written across two lines, rendering locally
 * and piping the result onward, so a per-physical-line assertion reads the
 * first half as a command that never reaches the host.
 */
function logicalCommands(runbook: string): string[] {
  return commandsOnly(runbook)
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

describe('bootstrap-pve.sh --print-only', () => {
  for (const [mode, args] of [
    ['remote', ['--pve-host', 'root@pve.example']],
    ['local', []],
  ] as const) {
    it(`emits parseable shell in ${mode} mode`, () => {
      const script = commandsOnly(printedRunbook(args));
      expect(script.trim().length).toBeGreaterThan(0);

      // -n parses and exits without running a single command, which is the only
      // safe way to assert this about a script whose whole job is to reconfigure
      // a hypervisor.
      const check = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
      expect(check.status, `printed runbook does not parse:\n${check.stderr}`).toBe(0);
    });
  }

  it('covers exactly the three steps that need root on the PVE host', () => {
    const runbook = printedRunbook(['--pve-host', 'root@pve.example']);
    expect(runbook).toContain('pveum-recipe.sh');
    expect(runbook).toContain('snippets/podkit-substrate.yaml');
    expect(runbook).toContain('snippets/podkit-builder.yaml');
    expect(runbook).toContain('.qcow2');
  });

  it('creates no VM', () => {
    // The boundary the whole phase split rests on: creating a guest is inside
    // the pool-scoped token's ACL, so it belongs to the low-privilege half. A
    // `qm create` appearing here would quietly move it back into the operation
    // that needs the hypervisor's root.
    expect(printedRunbook(['--pve-host', 'root@pve.example'])).not.toMatch(/\bqm\s+create\b/);
  });

  it('reaches the host only through ssh when given a --pve-host', () => {
    // Every command that touches the hypervisor is an ssh. The local halves —
    // `cat` of the recipe, `sed` of the template — are deliberate: both files
    // live in this repo and are rendered on THIS side, so a key is piped rather
    // than written to a temp file on the hypervisor and cleaned up later.
    for (const command of logicalCommands(printedRunbook(['--pve-host', 'root@pve.example']))) {
      expect(command, `does not reach the host through ssh: ${command}`).toContain(
        'ssh root@pve.example'
      );
    }
  });

  it('runs the same commands directly when on the PVE host', () => {
    for (const command of logicalCommands(printedRunbook([]))) {
      expect(command, `spawns ssh in local mode: ${command}`).not.toMatch(/\bssh\s/);
    }
  });
});
