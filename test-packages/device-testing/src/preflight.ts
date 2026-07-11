/**
 * Preflight probe for the Lima VM test harness. Wired into bunfig.toml as a
 * `[test].preload` so it runs once per `bun test` invocation in any package
 * that targets VM tests. Exits 0 when the VM is reachable AND answering shell
 * invocations; exits 1 with a multi-line remediation hint otherwise.
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
 * # Self-gating
 *
 * Bun's `[test].preload` fires on every `bun test` invocation in the package,
 * including non-VM unit runs (e.g. `bun test src/__tests__/canary.linux.test.ts`).
 * We must NOT bring down those runs when the VM is offline. The script sniffs
 * `process.argv` and `process.env.npm_lifecycle_event` for VM-test indicators
 * (a `vm/` segment, a `.e2e.` filename, or a `test:vm` lifecycle event); if
 * none match, the preload exits 0 silently and the test run proceeds without
 * touching Lima.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @module
 */

import { instanceStatus, LIMA_DEVICE_HARNESS_VM_NAME } from './runners/lima-test-vm.js';
import { runLimactl } from './runners/lima-limactl.js';
import { defaultSubprocessRunner } from './subprocess.js';

function vmTestsTargeted(): boolean {
  // `test:e2e:docker-dist` is the local-only Docker Tier-5 run (the shipped
  // Docker distribution image, in `src/docker-dist/`); it drives the VM just like
  // `test:vm`, so it must gate the same way (its files live in the `docker-dist`
  // directory, not `vm/`, and would otherwise slip past the argv sniff). The
  // `docker-dist` tag is distinct from `@podkit/e2e-tests`'s `.docker.` files,
  // which use a separate preflight.
  if (process.env.npm_lifecycle_event === 'test:vm') return true;
  if (process.env.npm_lifecycle_event === 'test:e2e:docker-dist') return true;
  // Match `vm/`, a trailing `/vm` (or bare `vm`) path segment, any `.e2e.`
  // filename, and a `docker-dist` path segment (`bun test src/docker-dist`
  // invoked directly without npm). The trailing-segment variant catches
  // `bun test src/vm` — `argv` then contains `src/vm` with no trailing slash,
  // which a naive `includes('vm/')` would miss.
  const VM_PATH_RE = /(^|\/)vm(\/|$)/;
  return process.argv.some(
    (arg) => VM_PATH_RE.test(arg) || arg.includes('.e2e.') || arg.includes('docker-dist')
  );
}

if (!vmTestsTargeted()) {
  // No VM tests in this invocation — let unit/integration runs proceed
  // without contacting Lima.
  process.exit(0);
}

const REMEDIATION = [
  '',
  'To bring the VM up:',
  '  bun run harness:start         (resume if stopped)',
  '  bun run harness:setup         (first-time setup: creates VM, builds + installs binaries)',
  '  bun run harness:status        (see exactly what state things are in)',
  '',
  'Then re-run `bun run test:vm`.',
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
