/**
 * What the `pveum` recipe actually issues.
 *
 * Asserted by RUNNING it against a `pveum` shim that records its arguments,
 * rather than by reading the file: the recipe is parameterised by environment,
 * and the grants that get missed are the ones inside a loop over a list.
 *
 * Nothing here contacts a hypervisor. The shim is the hypervisor.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { repoRoot } from '../paths.js';

const RECIPE = path.join(
  repoRoot(),
  'test-packages/device-testing/substrate/proxmox/pveum-recipe.sh'
);

let shimDir: string;
let log: string;

beforeAll(() => {
  shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-pveum-shim-'));
  log = path.join(shimDir, 'invocations');
  // Listing probes answer with an empty JSON array, so the recipe takes its
  // create branches; everything else just records.
  fs.writeFileSync(
    path.join(shimDir, 'pveum'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      'case "$*" in',
      '  *list*) echo "[]" ;;',
      'esac',
      'exit 0',
    ].join('\n'),
    { mode: 0o755 }
  );
});

afterAll(() => {
  fs.rmSync(shimDir, { recursive: true, force: true });
});

/** Run the recipe with the shim on PATH and return every `pveum` invocation. */
function render(env: Record<string, string> = {}): string[] {
  fs.writeFileSync(log, '');
  const result = spawnSync('bash', [RECIPE], {
    encoding: 'utf8',
    env: {
      PATH: `${shimDir}:${process.env['PATH'] ?? ''}`,
      HOME: shimDir,
      ...env,
    },
  });
  expect(result.status, `pveum-recipe.sh failed: ${result.stderr}`).toBe(0);
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

describe('pveum-recipe.sh', () => {
  it('parses as shell', () => {
    expect(spawnSync('bash', ['-n', RECIPE]).status).toBe(0);
  });

  it('creates a dedicated user, a dedicated pool and a custom role', () => {
    const calls = render();
    expect(calls).toContain('role add PodkitSubstrate --privs ' + rolePrivs(calls));
    expect(calls.some((c) => c.startsWith('pool add podkit'))).toBe(true);
    expect(calls.some((c) => c.startsWith('user add podkit@pve'))).toBe(true);
  });

  it('grants the role on the pool, not on /vms', () => {
    const calls = render();
    // A not-yet-existing VMID cannot be ACL'd, so creation rights have to sit
    // on a pool or on every VM. The pool is the point.
    expect(calls).toContain('acl modify /pool/podkit --users podkit@pve --roles PodkitSubstrate');
    expect(calls.some((c) => c.includes('acl modify /vms'))).toBe(false);
  });

  it('grants datastore rights on EVERY named storage', () => {
    // Disks on one storage and the snippet/image on another is the documented
    // layout, and granting only the first 403s on Datastore.Audit for the other.
    const calls = render({ PODKIT_PVE_STORAGE: 'tank bulk' });
    for (const storage of ['tank', 'bulk']) {
      expect(calls).toContain(
        `acl modify /storage/${storage} --users podkit@pve --roles PodkitSubstrateStorage`
      );
      expect(
        calls.some(
          (c) =>
            c.startsWith(`acl modify /storage/${storage}`) &&
            c.includes('--tokens podkit@pve!automation')
        )
      ).toBe(true);
    }
  });

  it('grants SDN.Use on the bridge zone path', () => {
    const calls = render({ PODKIT_PVE_BRIDGE: 'vmbr7' });
    expect(calls.some((c) => c.includes('SDN') && c.includes('PodkitSubstrateNetwork'))).toBe(true);
    expect(calls.some((c) => c.startsWith('acl modify /sdn/zones/localnetwork/vmbr7'))).toBe(true);
  });

  it('creates a privilege-separated token and grants it the same scopes', () => {
    const calls = render();
    // privsep is the whole security argument; a future default change would
    // silently widen the token, so it is stated rather than assumed.
    expect(calls).toContain('user token add podkit@pve automation --privsep 1');
    expect(calls).toContain(
      'acl modify /pool/podkit --tokens podkit@pve!automation --roles PodkitSubstrate'
    );
  });

  it('takes the guest-agent AUDIT privilege and not guest-exec', () => {
    const privs = rolePrivs(render());
    // Audit is network-get-interfaces. Unrestricted is guest-exec, which would
    // make the token strictly more powerful than the ssh access it complements.
    expect(privs).toContain('VM.GuestAgent.Audit');
    expect(privs).not.toContain('VM.GuestAgent.Unrestricted');
    // VM.Monitor was removed in PVE 9 and the whole role is rejected for it.
    expect(privs).not.toContain('VM.Monitor');
    // Snapshot and rollback are what `vm:recover` is built on.
    expect(privs).toContain('VM.Snapshot');
    expect(privs).toContain('VM.Snapshot.Rollback');
    // Pool.Audit is what lets the token address the pool it is confined to.
    expect(privs).toContain('Pool.Audit');
  });

  it('honours the environment so nothing about an installation is committed', () => {
    const calls = render({
      PODKIT_PVE_USER: 'someone@pam',
      PODKIT_PVE_TOKEN: 'ci',
      PODKIT_PVE_POOL: 'elsewhere',
    });
    expect(calls).toContain('user token add someone@pam ci --privsep 1');
    expect(calls.some((c) => c.includes('/pool/elsewhere'))).toBe(true);
    expect(calls.some((c) => c.includes('/pool/podkit'))).toBe(false);
  });
});

/** The privilege list the recipe hands `role add PodkitSubstrate`. */
function rolePrivs(calls: readonly string[]): string {
  const add = calls.find((c) => c.startsWith('role add PodkitSubstrate --privs'));
  expect(add, 'the recipe did not add the PodkitSubstrate role').toBeDefined();
  return add!.replace('role add PodkitSubstrate --privs ', '');
}
