/**
 * Unit tests for the `lima-test-vm` runner.
 *
 * Strategy: scripted `SubprocessRunner` returns canned results for each
 * `limactl` invocation. No real `limactl`, no real VM. We assert the
 * sequence + shape of calls and the helper's return values + thrown errors.
 *
 * Covers ACs from TASK-322.04 — see the spec for the full list. AC #8 (live
 * VM smoke test) is exercised by the Tier-3 integration tests in
 * TASK-322.06, not here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createLimaTestVmRuntime,
  ensurePersonaSidecar,
  stageBackingFile,
  resetBackingFile,
  startDaemonForPersona,
  stopDaemon,
  instanceStatus,
  LIMA_TEST_VM_NAME,
  SIDECAR_VM_PATH,
  DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
} from './lima-test-vm.js';
import { healthy, noFfmpeg } from '../system-states/index.js';
import { parseSidecar } from '../personas/sidecar.js';
import type { DevicePersona } from '../personas/types.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';

// ---------------------------------------------------------------------------
// Scripted SubprocessRunner — same shape as the sibling test files
// ---------------------------------------------------------------------------

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

type Responder =
  | SubprocessRunResult
  | Error
  | ((call: ScriptedCall) => SubprocessRunResult | Promise<SubprocessRunResult>);

function makeScriptedRunner(script: Responder[]): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        const call: ScriptedCall = { command, args, opts };
        calls.push(call);
        const responder = script[i++];
        if (responder === undefined) {
          throw new Error(`scripted runner exhausted at call ${i}: ${command} ${args.join(' ')}`);
        }
        if (responder instanceof Error) throw responder;
        if (typeof responder === 'function') return responder(call);
        return responder;
      },
    },
  };
}

const ok = (stdout = ''): SubprocessRunResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
});

const fail = (exitCode: number, stderr: string): SubprocessRunResult => ({
  stdout: '',
  stderr,
  exitCode,
});

/** Make `limactl list --json` say the instance is running. */
const listJsonRunning = (name = LIMA_TEST_VM_NAME): SubprocessRunResult =>
  ok(JSON.stringify({ name, status: 'Running' }) + '\n');

/** Make `limactl list --json` say the instance is stopped. */
const listJsonStopped = (name = LIMA_TEST_VM_NAME): SubprocessRunResult =>
  ok(JSON.stringify({ name, status: 'Stopped' }) + '\n');

/** Make `limactl list --json` return no rows (no such instance). */
const listJsonMissing = (): SubprocessRunResult => ok('');

// ---------------------------------------------------------------------------
// Fixtures: host binary
// ---------------------------------------------------------------------------

let tmpRoot: string;
let podkitBinary: string;
let podkitSha: string;
let daemonBinary: string;
let daemonUnit: string;
let daemonUnitSha: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-runner-'));
  podkitBinary = path.join(tmpRoot, 'podkit-linux-x64');
  const bytes = Buffer.from('fake-podkit-binary');
  fs.writeFileSync(podkitBinary, bytes);
  podkitSha = createHash('sha256').update(bytes).digest('hex');

  daemonBinary = path.join(tmpRoot, 'dummy-hcd-daemon');
  fs.writeFileSync(daemonBinary, Buffer.from('fake-daemon-binary'));

  daemonUnit = path.join(tmpRoot, 'dummy-hcd-daemon@.service');
  const unitBytes = Buffer.from('[Unit]\nDescription=fake-systemd-unit\n');
  fs.writeFileSync(daemonUnit, unitBytes);
  daemonUnitSha = createHash('sha256').update(unitBytes).digest('hex');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// instanceStatus
// ---------------------------------------------------------------------------

describe('instanceStatus', () => {
  it('returns `running` when the instance is in the list with status Running', async () => {
    const { runner } = makeScriptedRunner([listJsonRunning()]);
    const status = await instanceStatus(LIMA_TEST_VM_NAME, runner);
    expect(status).toBe('running');
  });

  it('returns `stopped` when the instance is in the list with another status', async () => {
    const { runner } = makeScriptedRunner([listJsonStopped()]);
    const status = await instanceStatus(LIMA_TEST_VM_NAME, runner);
    expect(status).toBe('stopped');
  });

  it('returns `missing` when the instance is not in the list', async () => {
    const { runner } = makeScriptedRunner([listJsonMissing()]);
    const status = await instanceStatus(LIMA_TEST_VM_NAME, runner);
    expect(status).toBe('missing');
  });

  it('returns `missing` when limactl is not installed (transport ENOENT)', async () => {
    const { runner } = makeScriptedRunner([new Error('spawn limactl ENOENT')]);
    const status = await instanceStatus(LIMA_TEST_VM_NAME, runner);
    expect(status).toBe('missing');
  });

  it('returns `missing` when limactl list itself fails non-zero', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'lima daemon not running')]);
    const status = await instanceStatus(LIMA_TEST_VM_NAME, runner);
    expect(status).toBe('missing');
  });

  it('ignores other instances in the same listing', async () => {
    const ndjson =
      JSON.stringify({ name: 'someone-else', status: 'Running' }) +
      '\n' +
      JSON.stringify({ name: LIMA_TEST_VM_NAME, status: 'Running' }) +
      '\n';
    const { runner } = makeScriptedRunner([ok(ndjson)]);
    expect(await instanceStatus(LIMA_TEST_VM_NAME, runner)).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe('runtime.isAvailable', () => {
  it('returns true when the instance exists', async () => {
    const { runner } = makeScriptedRunner([listJsonRunning()]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    expect(await runtime.isAvailable()).toBe(true);
  });

  it('returns false when the instance is missing', async () => {
    const { runner } = makeScriptedRunner([listJsonMissing()]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    expect(await runtime.isAvailable()).toBe(false);
  });

  it('returns false when limactl is absent (does not throw)', async () => {
    const { runner } = makeScriptedRunner([new Error('spawn limactl ENOENT')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    expect(await runtime.isAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

describe('runtime.prepare', () => {
  it('skips boot when the VM is already running and transfers podkit + sidecar', async () => {
    // Calls in order:
    //  1. instanceStatus → running
    //  2. transferBinary probe (sha256sum) → match → skip
    //  3. transferSystemdUnit probe → match → skip
    //  4. ensurePersonaSidecar: limactl copy
    //  5. ensurePersonaSidecar: sudo install
    //  6. ensurePersonaSidecar: rm -f temp
    const { runner, calls } = makeScriptedRunner([
      listJsonRunning(),
      ok(podkitSha), // sha256 match → skip
      ok(daemonUnitSha), // systemd unit sha match → skip
      ok(), // copy sidecar
      ok(), // install sidecar
      ok(), // rm temp
    ]);

    const runtime = createLimaTestVmRuntime({
      subprocess: runner,
      resolvePodkitBinary: () => podkitBinary,
      resolveDummyHcdDaemonBinary: () => path.join(tmpRoot, 'no-such-daemon'), // not present → skip
      resolveDummyHcdDaemonUnit: () => daemonUnit,
      resolveGpodToolBinary: () => undefined, // not configured → skip
      personas: [], // empty registry → tiny sidecar
    });

    await runtime.prepare();

    // No `limactl start` should have been issued.
    const startCalls = calls.filter(
      (c) => c.args[0] === 'start' && c.args[1] === LIMA_TEST_VM_NAME
    );
    expect(startCalls).toHaveLength(0);
    // Sidecar install must target SIDECAR_VM_PATH.
    const installCall = calls.find(
      (c) => c.args.includes('install') && c.args.includes(SIDECAR_VM_PATH)
    );
    expect(installCall).toBeDefined();
  });

  it('boots the VM when stopped', async () => {
    const { runner, calls } = makeScriptedRunner([
      listJsonStopped(),
      ok(), // limactl start
      ok(podkitSha), // sha256 match → skip
      ok(daemonUnitSha), // systemd unit sha match → skip
      ok(), // copy sidecar
      ok(), // install sidecar
      ok(), // rm temp
    ]);

    const runtime = createLimaTestVmRuntime({
      subprocess: runner,
      resolvePodkitBinary: () => podkitBinary,
      resolveDummyHcdDaemonBinary: () => path.join(tmpRoot, 'no-such-daemon'),
      resolveDummyHcdDaemonUnit: () => daemonUnit,
      resolveGpodToolBinary: () => undefined,
      personas: [],
    });

    await runtime.prepare();

    expect(calls[1]!.args).toEqual(['start', LIMA_TEST_VM_NAME]);
  });

  it('throws a clear error when the instance is missing entirely', async () => {
    const { runner } = makeScriptedRunner([listJsonMissing()]);
    const runtime = createLimaTestVmRuntime({
      subprocess: runner,
      resolvePodkitBinary: () => podkitBinary,
      resolveDummyHcdDaemonBinary: () => path.join(tmpRoot, 'no-such-daemon'),
      resolveDummyHcdDaemonUnit: () => daemonUnit,
      resolveGpodToolBinary: () => undefined,
      personas: [],
    });

    let caught: Error | undefined;
    try {
      await runtime.prepare();
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('is not registered with Lima');
    expect(caught!.message).toContain('limactl start');
  });

  it('transfers the dummy-hcd-daemon when the host binary exists', async () => {
    // After boot-check, podkit probe, daemon probe, systemd unit probe,
    // sidecar copy/install/cleanup.
    const { runner, calls } = makeScriptedRunner([
      listJsonRunning(),
      ok(podkitSha), // podkit sha match → skip
      // dummy-hcd-daemon transfer: probe → match (use same fake sha) so we
      // skip copy. To make this deterministic, compute the daemon sha.
      ok(createHash('sha256').update(fs.readFileSync(daemonBinary)).digest('hex')),
      ok(daemonUnitSha), // systemd unit sha match → skip
      ok(), // sidecar copy
      ok(), // sidecar install
      ok(), // sidecar cleanup
    ]);

    const runtime = createLimaTestVmRuntime({
      subprocess: runner,
      resolvePodkitBinary: () => podkitBinary,
      resolveDummyHcdDaemonBinary: () => daemonBinary,
      resolveDummyHcdDaemonUnit: () => daemonUnit,
      resolveGpodToolBinary: () => undefined,
      personas: [],
    });

    await runtime.prepare();

    // The daemon probe must reference the standard vm path.
    const daemonProbe = calls.find(
      (c) =>
        c.args[0] === 'shell' &&
        c.args.join(' ').includes('sha256sum') &&
        c.args.join(' ').includes(DEFAULT_DUMMY_HCD_DAEMON_VM_PATH)
    );
    expect(daemonProbe).toBeDefined();
  });

  it('warns but does not fail when gpod-tool transfer fails', async () => {
    const ghostGpodTool = path.join(tmpRoot, 'no-such-gpod-tool');

    const { runner } = makeScriptedRunner([
      listJsonRunning(),
      ok(podkitSha), // podkit skip
      // No further calls — gpod-tool throws synchronously (missing file)
      // BEFORE issuing any limactl call.
      ok(daemonUnitSha), // systemd unit sha match → skip
      ok(), // sidecar copy
      ok(), // sidecar install
      ok(), // sidecar cleanup
    ]);

    const runtime = createLimaTestVmRuntime({
      subprocess: runner,
      resolvePodkitBinary: () => podkitBinary,
      resolveDummyHcdDaemonBinary: () => path.join(tmpRoot, 'no-such-daemon'),
      resolveDummyHcdDaemonUnit: () => daemonUnit,
      resolveGpodToolBinary: () => ghostGpodTool,
      personas: [],
    });

    // Should not throw.
    await runtime.prepare();
  });

  it('fails loudly when the podkit binary is missing', async () => {
    const { runner } = makeScriptedRunner([listJsonRunning()]);
    const runtime = createLimaTestVmRuntime({
      subprocess: runner,
      resolvePodkitBinary: () => path.join(tmpRoot, 'no-such-podkit'),
      resolveDummyHcdDaemonBinary: () => path.join(tmpRoot, 'no-such-daemon'),
      resolveDummyHcdDaemonUnit: () => daemonUnit,
      resolveGpodToolBinary: () => undefined,
      personas: [],
    });

    let caught: Error | undefined;
    try {
      await runtime.prepare();
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('cannot read podkit binary');
  });

  it('installs the dummy-hcd-daemon systemd unit (probe → copy → install → reload)', async () => {
    // VM has a different sha for the unit, so the helper must do the full
    // copy + install + daemon-reload + cleanup sequence.
    const { runner, calls } = makeScriptedRunner([
      listJsonRunning(),
      ok(podkitSha), // podkit skip
      ok('deadbeef'), // systemd unit probe — wrong sha
      ok(), // limactl copy host → /tmp
      ok(), // sudo install -m 0644
      ok(), // sudo systemctl daemon-reload
      ok(), // rm -f /tmp
      ok(), // sidecar copy
      ok(), // sidecar install
      ok(), // sidecar cleanup
    ]);

    const runtime = createLimaTestVmRuntime({
      subprocess: runner,
      resolvePodkitBinary: () => podkitBinary,
      resolveDummyHcdDaemonBinary: () => path.join(tmpRoot, 'no-such-daemon'),
      resolveDummyHcdDaemonUnit: () => daemonUnit,
      resolveGpodToolBinary: () => undefined,
      personas: [],
    });

    await runtime.prepare();

    // A daemon-reload call must have run as part of the systemd unit install.
    const reloadCall = calls.find(
      (c) =>
        c.args[0] === 'shell' && c.args.includes('systemctl') && c.args.includes('daemon-reload')
    );
    expect(reloadCall).toBeDefined();

    // The install target must be /etc/systemd/system/dummy-hcd-daemon@.service.
    const installCall = calls.find(
      (c) =>
        c.args.includes('install') &&
        c.args.includes('-m') &&
        c.args.includes('0644') &&
        c.args.includes('/etc/systemd/system/dummy-hcd-daemon@.service')
    );
    expect(installCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// applyState
// ---------------------------------------------------------------------------

describe('runtime.applyState', () => {
  it('delegates to applyState() and uses the fast path when snapshot exists', async () => {
    const { runner, calls } = makeScriptedRunner([
      // applyState: snapshot list probe
      ok('base-no-ffmpeg\n'),
      // applyState: snapshot apply
      ok(),
    ]);

    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await runtime.applyState(noFfmpeg);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(['snapshot', 'list', LIMA_TEST_VM_NAME, '--quiet']);
    expect(calls[1]!.args).toEqual([
      'snapshot',
      'apply',
      LIMA_TEST_VM_NAME,
      '--tag',
      'base-no-ffmpeg',
    ]);
  });

  it('propagates errors from the underlying applyState', async () => {
    const { runner } = makeScriptedRunner([
      ok('base-no-ffmpeg\n'),
      fail(1, 'snapshot apply failed: image locked'),
    ]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });

    let caught: Error | undefined;
    try {
      await runtime.applyState(noFfmpeg);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/failed to restore snapshot/);
    expect(caught!.message).toContain('image locked');
  });
});

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

describe('runtime.run', () => {
  it('shells into the VM with `limactl shell <vm> -- sh -c <wrapped>` and captures output', async () => {
    const { runner, calls } = makeScriptedRunner([ok('hello world\n')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });

    const result = await runtime.run('echo hello world');

    expect(result.stdout).toBe('hello world\n');
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args.slice(0, 5)).toEqual(['shell', LIMA_TEST_VM_NAME, '--', 'sh', '-c']);
    expect(calls[0]!.args[5]).toBe('echo hello world');
  });

  it('honours opts.cwd via `cd` prefix', async () => {
    const { runner, calls } = makeScriptedRunner([ok('')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await runtime.run('pwd', { cwd: '/var/device-testing' });
    expect(calls[0]!.args[5]).toBe(`cd '/var/device-testing'; pwd`);
  });

  it('honours opts.env via export prefix', async () => {
    const { runner, calls } = makeScriptedRunner([ok('')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await runtime.run('env | grep FOO', { env: { FOO: 'bar baz' } });
    expect(calls[0]!.args[5]).toBe(`export FOO='bar baz'; env | grep FOO`);
  });

  it('rejects an env key with an invalid shell name', async () => {
    const { runner } = makeScriptedRunner([]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await expect(runtime.run('true', { env: { 'BAD-KEY': 'x' } })).rejects.toThrow(
      /invalid variable name/
    );
  });

  it('passes opts.timeoutMs through to the underlying subprocess runner', async () => {
    const { runner, calls } = makeScriptedRunner([ok('')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await runtime.run('sleep 60', { timeoutMs: 1000 });
    expect(calls[0]!.opts?.timeoutMs).toBe(1000);
  });

  it('surfaces a non-zero exit code without throwing', async () => {
    const { runner } = makeScriptedRunner([fail(2, 'whoops')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    const result = await runtime.run('false');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('whoops');
  });

  it('wraps a transport-level ENOENT in a clear error', async () => {
    const { runner } = makeScriptedRunner([new Error('spawn limactl ENOENT')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    let caught: Error | undefined;
    try {
      await runtime.run('true');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('brew install lima');
  });
});

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

describe('runtime.teardown', () => {
  it('restores the base-healthy snapshot when it exists', async () => {
    const { runner, calls } = makeScriptedRunner([
      // snapshotExists → list
      ok('base-healthy\n'),
      // restoreSnapshot
      ok(),
    ]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await runtime.teardown();
    expect(calls[1]!.args).toEqual([
      'snapshot',
      'apply',
      LIMA_TEST_VM_NAME,
      '--tag',
      'base-healthy',
    ]);
  });

  it('skips the restore (no error) when base-healthy is missing', async () => {
    const { runner, calls } = makeScriptedRunner([ok('')]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await runtime.teardown();
    expect(calls).toHaveLength(1);
    // Only the snapshotExists list call ran — no `apply`.
    expect(calls[0]!.args).toContain('list');
  });

  it('does not shut down the VM', async () => {
    const { runner, calls } = makeScriptedRunner([ok('base-healthy\n'), ok()]);
    const runtime = createLimaTestVmRuntime({ subprocess: runner });
    await runtime.teardown();
    const hasStop = calls.some((c) => c.args[0] === 'stop' || c.args.includes('shutdown'));
    expect(hasStop).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensurePersonaSidecar
// ---------------------------------------------------------------------------

describe('ensurePersonaSidecar', () => {
  const fakePersona: DevicePersona = {
    id: 'fake-persona',
    description: 'fake',
    schemaVersion: 2,
    usbDescriptor: {
      vendorId: 0x05ac,
      productId: 0x1209,
      deviceSerial: 'ABC',
      deviceClass: 0,
      deviceSubclass: 0,
      deviceProtocol: 0,
      bMaxPacketSize0: 64,
      bcdUSB: 0x0200,
      bcdDevice: 0x0001,
      bNumConfigurations: 1,
      configurations: [
        {
          bConfigurationValue: 1,
          bNumInterfaces: 1,
          bmAttributes: 0x80,
          bMaxPower: 0xfa,
          interfaces: [
            {
              bInterfaceNumber: 0,
              bAlternateSetting: 0,
              bInterfaceClass: 0x08,
              bInterfaceSubClass: 0x06,
              bInterfaceProtocol: 0x50,
              endpoints: [],
            },
          ],
        },
      ],
      stringDescriptors: {},
    },
    sysInfoExtendedXml: '<?xml version="1.0"?><x/>',
    lsblkJson: null,
    systemProfilerJson: null,
    diskutilPlist: null,
    partitionLayout: { luns: [{ lun: 0, partitions: [] }] },
    massStorageBackingFile: null,
    expectedCapabilities: null,
    expectedReadiness: { status: 'unknown', checks: [] } as never,
    expectedDoctorOutput: {},
    provenance: { provenanceDoc: '', source: 'synthesised' },
  };

  it('builds + copies + installs the sidecar, then cleans up', async () => {
    let copiedHostTmp: string | undefined;
    const { runner, calls } = makeScriptedRunner([
      (call) => {
        // limactl copy <host-tmp> <vm>:<vm-tmp>
        copiedHostTmp = call.args[1];
        return ok();
      },
      ok(), // install
      ok(), // rm -f vm-tmp
    ]);

    const result = await ensurePersonaSidecar({
      vmName: LIMA_TEST_VM_NAME,
      personas: [fakePersona],
      subprocess: runner,
    });

    expect(result.vmPath).toBe(SIDECAR_VM_PATH);

    // Copy + install + cleanup.
    expect(calls).toHaveLength(3);
    expect(calls[0]!.args[0]).toBe('copy');
    expect(calls[1]!.args).toContain('install');
    expect(calls[1]!.args).toContain('-D');
    expect(calls[1]!.args).toContain(SIDECAR_VM_PATH);
    expect(calls[2]!.args).toContain('rm');

    // Host-side temp must have been cleaned up.
    expect(copiedHostTmp).toBeDefined();
    expect(fs.existsSync(copiedHostTmp!)).toBe(false);
  });

  it('still cleans up the host temp when install fails', async () => {
    let copiedHostTmp: string | undefined;
    const { runner } = makeScriptedRunner([
      (call) => {
        copiedHostTmp = call.args[1];
        return ok();
      },
      fail(1, 'install: cannot create regular file: Permission denied'),
    ]);

    let caught: Error | undefined;
    try {
      await ensurePersonaSidecar({
        vmName: LIMA_TEST_VM_NAME,
        personas: [fakePersona],
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('sudo install failed');
    expect(copiedHostTmp).toBeDefined();
    expect(fs.existsSync(copiedHostTmp!)).toBe(false);
  });

  it('emits a valid sidecar JSON (parseable by parseSidecar)', async () => {
    let copiedHostTmp: string | undefined;
    let capturedJson: string | undefined;
    const { runner } = makeScriptedRunner([
      (call) => {
        copiedHostTmp = call.args[1];
        // Read the JSON before the finally-block deletes it.
        capturedJson = fs.readFileSync(copiedHostTmp!, 'utf8');
        return ok();
      },
      ok(),
      ok(),
    ]);

    await ensurePersonaSidecar({
      vmName: LIMA_TEST_VM_NAME,
      personas: [fakePersona],
      subprocess: runner,
    });

    expect(capturedJson).toBeDefined();
    const parsed = parseSidecar(capturedJson!);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.personas['fake-persona']).toBeDefined();
    expect(parsed.personas['fake-persona']!.usbDescriptor.vendorId).toBe('0x05ac');
  });

  it('requires vmName', async () => {
    await expect(ensurePersonaSidecar({ vmName: '', personas: [fakePersona] })).rejects.toThrow(
      /vmName is required/
    );
  });
});

// ---------------------------------------------------------------------------
// stageBackingFile + resetBackingFile
// ---------------------------------------------------------------------------

describe('stageBackingFile', () => {
  let imgPath: string;
  let imgSha: string;
  beforeEach(() => {
    imgPath = path.join(tmpRoot, 'backing.img');
    const bytes = Buffer.from('FAT32-image-bytes');
    fs.writeFileSync(imgPath, bytes);
    imgSha = createHash('sha256').update(bytes).digest('hex');
  });

  it('skips copy + install when the VM already has the same sha256', async () => {
    const { runner, calls } = makeScriptedRunner([ok(imgSha + '\n')]);
    await stageBackingFile({
      vmName: LIMA_TEST_VM_NAME,
      hostImagePath: imgPath,
      vmPath: '/var/device-testing/backing.img',
      subprocess: runner,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.join(' ')).toContain('sha256sum');
  });

  it('runs probe → copy → install → cleanup on first stage', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe: absent
      ok(), // copy
      ok(), // install
      ok(), // rm temp
    ]);
    await stageBackingFile({
      vmName: LIMA_TEST_VM_NAME,
      hostImagePath: imgPath,
      vmPath: '/var/device-testing/backing.img',
      subprocess: runner,
    });
    expect(calls).toHaveLength(4);
    expect(calls[1]!.args[0]).toBe('copy');
    expect(calls[2]!.args).toEqual(
      expect.arrayContaining([
        'sudo',
        'install',
        '-D',
        '-m',
        '0644',
        '/var/device-testing/backing.img',
      ])
    );
  });

  it('throws when the host image is missing', async () => {
    const { runner } = makeScriptedRunner([]);
    await expect(
      stageBackingFile({
        vmName: LIMA_TEST_VM_NAME,
        hostImagePath: path.join(tmpRoot, 'no-such-image'),
        vmPath: '/var/device-testing/backing.img',
        subprocess: runner,
      })
    ).rejects.toThrow(/cannot read host image/);
  });
});

describe('resetBackingFile', () => {
  let imgPath: string;
  beforeEach(() => {
    imgPath = path.join(tmpRoot, 'backing.img');
    fs.writeFileSync(imgPath, Buffer.from('FAT32-image-bytes'));
  });

  it('copy strategy: re-stages the image to vmPath', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe at vmPath
      ok(), // copy
      ok(), // install
      ok(), // rm temp
    ]);
    await resetBackingFile({
      vmName: LIMA_TEST_VM_NAME,
      hostImagePath: imgPath,
      vmPath: '/var/device-testing/backing.img',
      strategy: 'copy',
      subprocess: runner,
    });
    expect(calls[2]!.args).toContain('/var/device-testing/backing.img');
  });

  it('swap strategy: stages to <vmPath>.ref then sudo-cp to vmPath', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(''), // probe at <vmPath>.ref
      ok(), // copy → vm tmp
      ok(), // install → <vmPath>.ref
      ok(), // rm tmp
      ok(), // sudo cp .ref → vmPath
    ]);
    await resetBackingFile({
      vmName: LIMA_TEST_VM_NAME,
      hostImagePath: imgPath,
      vmPath: '/var/device-testing/backing.img',
      strategy: 'swap',
      subprocess: runner,
    });
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.args).toEqual([
      'shell',
      LIMA_TEST_VM_NAME,
      '--',
      'sudo',
      'cp',
      '-f',
      '/var/device-testing/backing.img.ref',
      '/var/device-testing/backing.img',
    ]);
    // The reference install must have used the .ref path.
    const refInstall = calls.find(
      (c) => c.args.includes('install') && c.args.includes('/var/device-testing/backing.img.ref')
    );
    expect(refInstall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// startDaemonForPersona + stopDaemon
// ---------------------------------------------------------------------------

describe('startDaemonForPersona', () => {
  it('issues `sudo systemctl start dummy-hcd-daemon@<id>.service`', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    await startDaemonForPersona({
      vmName: LIMA_TEST_VM_NAME,
      personaId: 'ipod-video-5g-iflash-1tb',
      subprocess: runner,
    });
    expect(calls[0]!.args).toEqual([
      'shell',
      LIMA_TEST_VM_NAME,
      '--',
      'sudo',
      'systemctl',
      'start',
      'dummy-hcd-daemon@ipod-video-5g-iflash-1tb.service',
    ]);
  });

  it('propagates systemctl failures', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'Unit dummy-hcd-daemon@foo.service not found')]);
    await expect(
      startDaemonForPersona({
        vmName: LIMA_TEST_VM_NAME,
        personaId: 'foo',
        subprocess: runner,
      })
    ).rejects.toThrow(/failed to start dummy-hcd-daemon@foo\.service/);
  });

  it('requires vmName and personaId', async () => {
    await expect(startDaemonForPersona({ vmName: '', personaId: 'foo' })).rejects.toThrow(
      /vmName is required/
    );
    await expect(startDaemonForPersona({ vmName: 'x', personaId: '' })).rejects.toThrow(
      /personaId is required/
    );
  });
});

describe('stopDaemon', () => {
  it('stops a specific persona instance when personaId is set', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    await stopDaemon({
      vmName: LIMA_TEST_VM_NAME,
      personaId: 'echo-mini',
      subprocess: runner,
    });
    expect(calls[0]!.args).toContain('dummy-hcd-daemon@echo-mini.service');
  });

  it('stops all instances when personaId is omitted', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    await stopDaemon({ vmName: LIMA_TEST_VM_NAME, subprocess: runner });
    expect(calls[0]!.args).toContain('dummy-hcd-daemon@*.service');
  });

  it('treats systemd exit 5 (no-such-unit) as success — idempotent stop', async () => {
    // systemctl exits 5 when the unit isn't loaded / not running. Tier-3
    // teardown calls `stopDaemon` unconditionally; this case must not throw.
    const { runner } = makeScriptedRunner([fail(5, 'Unit dummy-hcd-daemon@*.service not loaded.')]);
    await stopDaemon({ vmName: LIMA_TEST_VM_NAME, subprocess: runner });
  });

  it('propagates other non-zero systemctl exits', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'Failed to stop unit: connection refused')]);
    let caught: Error | undefined;
    try {
      await stopDaemon({ vmName: LIMA_TEST_VM_NAME, subprocess: runner });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/failed to stop/);
  });
});

// ---------------------------------------------------------------------------
// Sanity: the runner is wired up to the registry / index
// ---------------------------------------------------------------------------

describe('integration: index exports', () => {
  it('exposes a default singleton and a factory', async () => {
    const mod = await import('../index.js');
    expect(mod.limaTestVmRunner.id).toBe('lima-test-vm');
    expect(typeof mod.createLimaTestVmRuntime).toBe('function');
    // The runtime is registered alongside local-linux.
    const ids = mod.listRunners().map((r) => r.id);
    expect(ids).toContain('lima-test-vm');
    expect(ids).toContain('local-linux');
  });

  it('applyState delegate on the registered singleton accepts a SystemState', async () => {
    // Just verify the signature plumbing — no real call.
    const mod = await import('../index.js');
    expect(typeof mod.limaTestVmRunner.applyState).toBe('function');
    // It accepts a SystemState; calling it would hit real limactl, so we don't.
    expect(healthy.id).toBe('healthy');
  });
});
