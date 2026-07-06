/**
 * Unit tests for the daemon readiness classifier.
 *
 * Pure decision logic: maps a `podkit sync` outcome (exit code + typed error
 * code from the --json envelope) to a readiness status that drives the
 * daemon's notify-and-skip behaviour. The daemon never mutates the device —
 * it only classifies and reports. See doc-052 (daemon section).
 */

import { describe, expect, it } from 'bun:test';

import {
  classifyReadiness,
  formatReadinessNotification,
  type DaemonReadiness,
} from './readiness-classifier.js';

describe('classifyReadiness', () => {
  it('treats a clean exit (0) as ready', () => {
    expect(classifyReadiness({ exitCode: 0 })).toBe('ready');
  });

  it('treats a partial-failure exit (2) as ready — the device synced', () => {
    expect(classifyReadiness({ exitCode: 2 })).toBe('ready');
  });

  it('maps the unknown-model refusal to needs-setup', () => {
    // Inherited from the CLI hard-error (TASK-440): an unidentified iPod must
    // be set up over USB once before it can sync.
    expect(classifyReadiness({ exitCode: 1, code: 'UNKNOWN_IPOD_MODEL' })).toBe('needs-setup');
  });

  it('maps the unsupported-device refusal to unsupported', () => {
    expect(classifyReadiness({ exitCode: 1, code: 'DEVICE_UNSUPPORTED' })).toBe('unsupported');
  });

  it('maps the needs-init signal to needs-init', () => {
    expect(classifyReadiness({ exitCode: 1, code: 'IPOD_NEEDS_INIT' })).toBe('needs-init');
  });

  it('falls back to error for an unrecognised failure code', () => {
    expect(classifyReadiness({ exitCode: 1, code: 'IPOD_OPEN_FAILED' })).toBe('error');
  });

  it('falls back to error when no code is present', () => {
    expect(classifyReadiness({ exitCode: 1 })).toBe('error');
  });
});

describe('formatReadinessNotification', () => {
  const device = { name: 'sdb1', disk: '/dev/sdb1', label: 'IPOD', size: 0 };

  it('gives one-time USB setup guidance for needs-setup', () => {
    const msg = formatReadinessNotification(device, 'needs-setup');
    expect(msg).not.toBeNull();
    expect(msg).toContain('device add');
    expect(msg).toContain('doctor --repair sysinfo-extended');
  });

  it('explains the device is unsupported', () => {
    const msg = formatReadinessNotification(device, 'unsupported');
    expect(msg).not.toBeNull();
    expect(msg!.toLowerCase()).toContain('not supported');
  });

  it('tells the user to initialise a blank device for needs-init', () => {
    const msg = formatReadinessNotification(device, 'needs-init');
    expect(msg).not.toBeNull();
    expect(msg!.toLowerCase()).toContain('init');
  });

  it('returns null for ready and error (handled by other notification paths)', () => {
    expect(formatReadinessNotification(device, 'ready')).toBeNull();
    expect(formatReadinessNotification(device, 'error')).toBeNull();
  });

  it('uses the device label in the message when present', () => {
    const msg = formatReadinessNotification(device, 'needs-setup');
    expect(msg).toContain('IPOD');
  });

  it('does not leak libgpod implementation wording', () => {
    const statuses: DaemonReadiness[] = ['needs-setup', 'unsupported', 'needs-init'];
    for (const s of statuses) {
      expect((formatReadinessNotification(device, s) ?? '').toLowerCase()).not.toContain('libgpod');
    }
  });
});
