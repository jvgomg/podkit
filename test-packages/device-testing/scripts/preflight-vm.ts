#!/usr/bin/env bun
/**
 * Preflight probe for the Lima VM test harness. Run before `bun test src/`
 * in any package's `test:vm` script. Exits 0 when the VM is reachable AND
 * answering shell invocations; exits 1 with a multi-line remediation hint
 * otherwise.
 *
 * `instanceStatus()` only checks Lima's metadata (the instance exists +
 * Lima thinks it is running). That can be misleading: the VM can be in a
 * "running" state while the SSH daemon isn't accepting connections (just
 * after boot, after a hibernate, etc.). We do an extra `limactl shell ...
 * /bin/true` probe so a transient "connection refused" surfaces here
 * rather than tens of seconds into the suite.
 *
 * Intentionally fail-fast so VM test runs cannot silently no-op when the
 * harness isn't up — the developer either sees green or sees this message
 * with the exact commands to fix it.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @module
 */

import { instanceStatus, LIMA_DEVICE_HARNESS_VM_NAME } from '../src/runners/lima-test-vm.js';
import { runLimactl } from '../src/runners/lima-limactl.js';
import { defaultSubprocessRunner } from '../src/subprocess.js';

const REMEDIATION = [
  '',
  'To run VM tests, ensure:',
  '  1. Lima is installed:             `brew install lima` (macOS)',
  '  2. The harness VM is provisioned: `limactl start test-packages/device-testing/lima/podkit-device-harness.yaml --name podkit-device-harness`',
  '  3. The VM is currently running:   `limactl start podkit-device-harness` (resume) — see test-packages/device-testing/lima/README.md for first-run install steps',
  '',
  'VM tests refuse to silently skip — bring the VM up or invoke a different test script (`bun run test:unit`, `bun run test:integration`).',
  '',
].join('\n');

function bail(headline: string): never {
  process.stderr.write(`[vm-preflight] ${headline}\n${REMEDIATION}`);
  process.exit(1);
}

const status = await instanceStatus().catch(() => 'missing' as const);
if (status === 'missing') {
  bail(`Lima instance \`${LIMA_DEVICE_HARNESS_VM_NAME}\` is not registered.`);
}
if (status === 'stopped') {
  bail(`Lima instance \`${LIMA_DEVICE_HARNESS_VM_NAME}\` is stopped.`);
}

// Status is 'running' — verify SSH actually answers. `limactl shell` returns
// non-zero with "Connection refused" / "Connection reset" when the daemon
// isn't accepting yet, which means the suite would fail in beforeAll.
const probe = await runLimactl(defaultSubprocessRunner, [
  'shell',
  LIMA_DEVICE_HARNESS_VM_NAME,
  '--',
  '/bin/true',
]).catch((err) => ({ exitCode: 1, stdout: '', stderr: String(err) }));

if (probe.exitCode !== 0) {
  bail(
    `Lima instance \`${LIMA_DEVICE_HARNESS_VM_NAME}\` is reachable to limactl but SSH is refusing: ${probe.stderr.trim()}`
  );
}

process.stdout.write('[vm-preflight] VM ready.\n');
