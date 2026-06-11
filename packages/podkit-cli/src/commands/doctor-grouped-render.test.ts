/**
 * Renderer-level tests for the unified `System` / `Device Readiness` /
 * `Database Health` section structure.
 *
 * Drives `printGroupedChecks` with synthetic check fixtures so we can pin
 * grouping, ordering, and empty-section omission without bootstrapping a
 * real device or the full `runDoctorDiagnostics` pipeline.
 *
 * After the scope-collapse refactor (Approach A), every check declares one of
 * three required scopes — there is no defaulting and no `category` field.
 */

import { describe, it, expect } from 'bun:test';
import { printGroupedChecks } from './doctor-render.js';
import { OutputContext, BufferExitCodeSink } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTextOutput(): { out: OutputContext; stdout: BufferSink } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = new OutputContext({
    mode: 'text',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
    exitCode: new BufferExitCodeSink(),
  });
  return { out, stdout };
}

interface FakeCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  scope: 'system' | 'device-readiness' | 'database-health';
  repairOnly?: boolean;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('printGroupedChecks — section ordering', () => {
  it('renders System then Device Readiness then Database Health', () => {
    const { out, stdout } = makeTextOutput();
    const checks: FakeCheck[] = [
      {
        id: 'codec-encoders',
        name: 'Codec Encoders',
        status: 'pass',
        summary: 'ok',
        scope: 'system',
      },
      {
        id: 'usb-link',
        name: 'USB Connection',
        status: 'pass',
        summary: 'ok',
        scope: 'device-readiness',
      },
      {
        id: 'artwork-rebuild',
        name: 'Artwork Integrity',
        status: 'pass',
        summary: 'ok',
        scope: 'database-health',
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    const sysIdx = text.indexOf('System');
    const readyIdx = text.indexOf('Device Readiness');
    const dbIdx = text.indexOf('Database Health');

    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(readyIdx).toBeGreaterThan(sysIdx);
    expect(dbIdx).toBeGreaterThan(readyIdx);
  });
});

describe('printGroupedChecks — empty section omission', () => {
  it('omits the System header when no system checks are present', () => {
    const { out, stdout } = makeTextOutput();
    const checks: FakeCheck[] = [
      {
        id: 'orphan-files',
        name: 'Orphan Files',
        status: 'pass',
        summary: 'no orphans',
        scope: 'database-health',
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    expect(text).not.toMatch(/^System$/m);
    expect(text).not.toContain('Device Readiness');
    expect(text).toContain('Database Health');
    expect(text).toContain('Orphan Files');
  });

  it('omits the Database Health header when no database checks are present (mass-storage subset)', () => {
    const { out, stdout } = makeTextOutput();
    const checks: FakeCheck[] = [
      {
        id: 'codec-encoders',
        name: 'Codec Encoders',
        status: 'pass',
        summary: 'ok',
        scope: 'system',
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    expect(text).toContain('System');
    expect(text).not.toContain('Device Readiness');
    expect(text).not.toContain('Database Health');
  });

  it('emits no headers when every check is repairOnly', () => {
    const { out, stdout } = makeTextOutput();
    const checks: FakeCheck[] = [
      {
        id: 'sysinfo-extended',
        name: 'SysInfoExtended',
        status: 'skip',
        summary: 'repair-only',
        scope: 'database-health',
        repairOnly: true,
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    expect(text).not.toContain('System');
    expect(text).not.toContain('Device Readiness');
    expect(text).not.toContain('Database Health');
    expect(text.trim()).toBe('');
  });
});

describe('printGroupedChecks — categorisation rules', () => {
  it('routes database-health checks into the Database Health section', () => {
    const { out, stdout } = makeTextOutput();
    const checks: FakeCheck[] = [
      {
        id: 'orphan-files',
        name: 'Orphan Files',
        status: 'pass',
        summary: 'ok',
        scope: 'database-health',
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    expect(text).toContain('Database Health');
    expect(text).not.toContain('Device Readiness');
    expect(text).toContain('Orphan Files');
  });

  it('skips repairOnly checks even when scope is set', () => {
    const { out, stdout } = makeTextOutput();
    const checks: FakeCheck[] = [
      {
        id: 'artwork-reset',
        name: 'Artwork Reset',
        status: 'skip',
        summary: 'repair-only',
        scope: 'database-health',
        repairOnly: true,
      },
      {
        id: 'artwork-rebuild',
        name: 'Artwork Integrity',
        status: 'pass',
        summary: 'ok',
        scope: 'database-health',
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    expect(text).toContain('Database Health');
    expect(text).toContain('Artwork Integrity');
    expect(text).not.toContain('Artwork Reset');
  });
});

describe('printGroupedChecks — mass-storage scenario (Echo Mini)', () => {
  it('renders System (Codec / Video Encoder) + Database Health (Orphan Files), no Device Readiness, no iPod Firmware Inquiry', () => {
    const { out, stdout } = makeTextOutput();
    // Mirrors the post-fix Echo Mini state described in the task:
    // - Codec Encoders + Video Encoder (system)
    // - Orphan Files (Mass Storage) (database-health)
    // - iPod Firmware Inquiry Methods is NOT applicable → not in the input
    const checks: FakeCheck[] = [
      {
        id: 'codec-encoders',
        name: 'Codec Encoders',
        status: 'pass',
        summary: 'all encoders available',
        scope: 'system',
      },
      {
        id: 'video-encoder',
        name: 'Video Encoder (H.264)',
        status: 'pass',
        summary: 'libx264 available',
        scope: 'system',
      },
      {
        id: 'orphan-files-mass-storage',
        name: 'Orphan Files (Mass Storage)',
        status: 'pass',
        summary: 'no orphans',
        scope: 'database-health',
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    // System header + both system checks
    expect(text).toContain('System');
    expect(text).toContain('Codec Encoders');
    expect(text).toContain('Video Encoder (H.264)');

    // No "iPod Firmware Inquiry" — the input doesn't include it because
    // applicableTo gates it out before the renderer runs.
    expect(text).not.toContain('iPod Firmware Inquiry');

    // No Device Readiness because mass-storage has no device-readiness checks today
    expect(text).not.toContain('Device Readiness');

    // Database Health with the mass-storage orphan check
    expect(text).toContain('Database Health');
    expect(text).toContain('Orphan Files (Mass Storage)');
  });
});

describe('printGroupedChecks — status markers', () => {
  it('prefixes each check with its status marker', () => {
    const { out, stdout } = makeTextOutput();
    const checks: FakeCheck[] = [
      {
        id: 'a',
        name: 'A pass',
        status: 'pass',
        summary: 'ok',
        scope: 'system',
      },
      {
        id: 'b',
        name: 'B fail',
        status: 'fail',
        summary: 'broken',
        scope: 'database-health',
      },
      {
        id: 'c',
        name: 'C warn',
        status: 'warn',
        summary: 'partial',
        scope: 'database-health',
      },
    ];

    printGroupedChecks(out, checks);
    const text = stdout.text();

    expect(text).toMatch(/✓ A pass/); // ✓
    expect(text).toMatch(/✗ B fail/); // ✗
    expect(text).toMatch(/! C warn/);
  });
});
