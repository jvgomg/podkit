/**
 * Smoke tests for the daemon entry point.
 *
 * `runDaemon()` is exercised in-process. We never reach configfs/FunctionFS
 * because the persona reading happens before any kernel touchpoints.
 *
 *   - missing persona → exit 2 with the available-personas list
 *   - missing sidecar → exit 2 with a "cannot read" message
 *   - --dry-run + real persona → exit 0 (reads sidecar, prints summary)
 *
 * All tests stub stdout/stderr so the test runner output stays clean.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeSidecar } from '../../../../../packages/device-testing/src/personas/sidecar.js';

import { runDaemon } from '../main.js';

function makeSidecarFile(content: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'dummy-hcd-test-'));
  const file = join(dir, 'personas.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

interface IoCapture {
  stdout: string;
  stderr: string;
  restore: () => void;
}

function captureIo(): IoCapture {
  const out: { stdout: string; stderr: string } = { stdout: '', stderr: '' };
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: any) => {
    out.stdout += typeof chunk === 'string' ? chunk : (chunk?.toString?.() ?? '');
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: any) => {
    out.stderr += typeof chunk === 'string' ? chunk : (chunk?.toString?.() ?? '');
    return true;
  };
  // Also capture console.log output (used by --dry-run summary).
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    out.stdout += `${args.map(String).join(' ')}\n`;
  };
  return {
    get stdout() {
      return out.stdout;
    },
    get stderr() {
      return out.stderr;
    },
    restore() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = origOut;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = origErr;
      console.log = origLog;
    },
  };
}

describe('runDaemon', () => {
  let io: IoCapture;
  const tmps: string[] = [];

  beforeEach(() => {
    io = captureIo();
  });
  afterEach(() => {
    io.restore();
    for (const path of tmps.splice(0)) {
      try {
        rmSync(path, { force: true });
      } catch {
        // best-effort
      }
    }
  });

  it('returns exit-code 2 for an unknown persona', async () => {
    const sidecar = makeSidecarFile({
      schemaVersion: 1,
      personas: {
        'real-persona': {
          id: 'real-persona',
          description: 'r',
          usbDescriptor: { vendorId: '0x05ac', productId: '0x1209' },
          sysInfoExtendedXml: '<x/>',
        },
      },
    });
    tmps.push(sidecar);
    const code = await runDaemon(['--persona', 'nonexistent', '--sidecar', sidecar]);
    expect(code).toBe(2);
    expect(io.stderr).toContain('nonexistent');
    expect(io.stderr).toContain('available');
  });

  it('returns exit-code 2 when the sidecar file is missing', async () => {
    const code = await runDaemon([
      '--persona',
      'p',
      '--sidecar',
      '/tmp/this-file-does-not-exist-' + Date.now() + '.json',
    ]);
    expect(code).toBe(2);
    expect(io.stderr).toContain('cannot read sidecar');
  });

  it('returns exit-code 2 when the sidecar is malformed', async () => {
    const sidecar = makeSidecarFile({ schemaVersion: 99, personas: {} });
    tmps.push(sidecar);
    const code = await runDaemon(['--persona', 'p', '--sidecar', sidecar]);
    expect(code).toBe(2);
    expect(io.stderr).toContain('not supported');
  });

  it('--dry-run prints a summary and exits 0', async () => {
    const sidecar = makeSidecarFile({
      schemaVersion: 1,
      personas: {
        'ipod-video-5g': {
          id: 'ipod-video-5g',
          description: 'iPod 5G test persona',
          usbDescriptor: {
            vendorId: '0x05ac',
            productId: '0x1209',
            serial: '000A27001605D1A0',
          },
          sysInfoExtendedXml: '<plist><dict/></plist>',
        },
      },
    });
    tmps.push(sidecar);
    const code = await runDaemon(['--persona', 'ipod-video-5g', '--sidecar', sidecar, '--dry-run']);
    expect(code).toBe(0);
    expect(io.stdout).toContain('ipod-video-5g');
    expect(io.stdout).toContain('0x05ac/0x1209');
  });

  it('errors clearly when --persona is missing', async () => {
    const code = await runDaemon(['--sidecar', '/dev/null']);
    expect(code).toBe(2);
    expect(io.stderr).toContain('--persona');
  });

  it('emits --help to stdout and exits 0', async () => {
    const code = await runDaemon(['--help']);
    expect(code).toBe(0);
    expect(io.stdout).toContain('Usage:');
  });

  it('serializes a real-shaped sidecar payload + parses it back', async () => {
    // Round-trip via the @podkit/device-testing public API to confirm the
    // daemon and the runner share the same schema entry.
    const json = serializeSidecar({
      schemaVersion: 1,
      personas: {
        p1: {
          id: 'p1',
          description: 'test',
          usbDescriptor: { vendorId: '0x05ac', productId: '0x1209' },
          sysInfoExtendedXml: 'hello',
        },
      },
    });
    const sidecar = makeSidecarFile(JSON.parse(json));
    tmps.push(sidecar);
    const code = await runDaemon(['--persona', 'p1', '--sidecar', sidecar, '--dry-run']);
    expect(code).toBe(0);
  });
});
