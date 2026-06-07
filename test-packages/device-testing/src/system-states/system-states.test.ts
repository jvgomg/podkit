/**
 * Smoke tests for the SystemState registry.
 *
 * Asserts:
 *  - Registry contains all 6 expected states.
 *  - Each state satisfies the schema invariants (schemaVersion, etc.).
 *  - `healthy` state's expectedDoctorSystemOutput matches the golden file.
 *  - Each failing state reports at least one non-pass check.
 *
 * Golden file: __fixtures__/healthy-doctor-output.golden.json
 * Update it intentionally when the healthy state's doctor output changes.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { SystemState } from './types.js';
import { systemStates } from './index.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Helpers ──────────────────────────────────────────────────────────────────

const EXPECTED_IDS = [
  'healthy',
  'no-ffmpeg',
  'no-libgpod',
  'no-udev',
  'no-sg-perms',
  'corrupt-configfs',
  'device-mount-near-full',
] as const;

// States whose `expectedDoctorSystemOutput.overallStatus` is anything other
// than `'healthy'`. `device-mount-near-full` provisions a per-test loopback
// mount that the system-scope doctor cannot see, so its expected doctor
// output mirrors `healthy` exactly — exclude from the failing-states
// invariants.
const FAILING_IDS = EXPECTED_IDS.filter(
  (id) => id !== 'healthy' && id !== 'device-mount-near-full'
);

// ── Registry size + key presence ─────────────────────────────────────────────

describe('systemStates registry', () => {
  it('contains exactly 7 states', () => {
    expect(systemStates.size).toBe(7);
  });

  for (const id of EXPECTED_IDS) {
    it(`contains key "${id}"`, () => {
      expect(systemStates.has(id)).toBe(true);
    });
  }
});

// ── Schema invariants ────────────────────────────────────────────────────────

describe('schema invariants', () => {
  for (const id of EXPECTED_IDS) {
    it(`"${id}" has schemaVersion 1`, () => {
      const state = systemStates.get(id);
      expect(state?.schemaVersion).toBe(1);
    });

    it(`"${id}" has a non-empty id matching its registry key`, () => {
      const state = systemStates.get(id);
      expect(state?.id).toBe(id);
    });

    it(`"${id}" has a non-empty description`, () => {
      const state = systemStates.get(id);
      expect(typeof state?.description).toBe('string');
      expect((state?.description ?? '').length).toBeGreaterThan(0);
    });

    it(`"${id}" expectedDoctorSystemOutput has at least one check`, () => {
      const state = systemStates.get(id);
      expect(state?.expectedDoctorSystemOutput.checks.length).toBeGreaterThan(0);
    });
  }
});

// ── Golden file assertion for `healthy` ──────────────────────────────────────

describe('healthy state golden snapshot', () => {
  it('expectedDoctorSystemOutput deep-equals the golden file', () => {
    const goldenPath = join(__dir, '__fixtures__', 'healthy-doctor-output.golden.json');
    const golden = JSON.parse(
      readFileSync(goldenPath, 'utf8')
    ) as SystemState['expectedDoctorSystemOutput'];
    const state = systemStates.get('healthy');
    expect(state?.expectedDoctorSystemOutput).toEqual(golden);
  });
});

// ── Failing states ───────────────────────────────────────────────────────────

describe('failing states', () => {
  it('healthy state has overallStatus "healthy"', () => {
    const state = systemStates.get('healthy');
    expect(state?.expectedDoctorSystemOutput.overallStatus).toBe('healthy');
  });

  for (const id of FAILING_IDS) {
    it(`"${id}" overallStatus is not "healthy"`, () => {
      const state = systemStates.get(id);
      expect(state?.expectedDoctorSystemOutput.overallStatus).not.toBe('healthy');
    });

    it(`"${id}" has at least one check with status "fail" or "warn"`, () => {
      const state = systemStates.get(id);
      const hasFailOrWarn = state?.expectedDoctorSystemOutput.checks.some(
        (c) => c.status === 'fail' || c.status === 'warn'
      );
      expect(hasFailOrWarn).toBe(true);
    });

    it(`"${id}" expectedExitCode is non-zero`, () => {
      const state = systemStates.get(id);
      expect(state?.expectedExitCode).not.toBe(0);
    });
  }
});

// ── Named failure mapping ─────────────────────────────────────────────────────

describe('named failure checks', () => {
  it('no-ffmpeg has a failing ffmpeg check', () => {
    const state = systemStates.get('no-ffmpeg');
    const ffmpegCheck = state?.expectedDoctorSystemOutput.checks.find((c) => c.id === 'ffmpeg');
    expect(ffmpegCheck?.status).toBe('fail');
  });

  it('no-libgpod has a failing libgpod-runtime check', () => {
    const state = systemStates.get('no-libgpod');
    const check = state?.expectedDoctorSystemOutput.checks.find((c) => c.id === 'libgpod-runtime');
    expect(check?.status).toBe('fail');
  });

  it('no-udev has a failing udev-rule check', () => {
    const state = systemStates.get('no-udev');
    const check = state?.expectedDoctorSystemOutput.checks.find((c) => c.id === 'udev-rule');
    expect(check?.status).toBe('fail');
  });

  it('no-sg-perms has a warning inquiry-methods check', () => {
    const state = systemStates.get('no-sg-perms');
    const check = state?.expectedDoctorSystemOutput.checks.find((c) => c.id === 'inquiry-methods');
    expect(check?.status).toBe('warn');
  });

  it('corrupt-configfs has a failing configfs-mount check', () => {
    const state = systemStates.get('corrupt-configfs');
    const check = state?.expectedDoctorSystemOutput.checks.find((c) => c.id === 'configfs-mount');
    expect(check?.status).toBe('fail');
  });

  it('device-mount-near-full mirrors healthy at the doctor system scope', () => {
    // The near-full loopback is a per-test artefact, invisible to system-
    // scope doctor checks. Expected doctor output must equal healthy's
    // exactly so the smoke + golden invariants continue to hold.
    const healthyState = systemStates.get('healthy');
    const nearFullState = systemStates.get('device-mount-near-full');
    expect(nearFullState?.expectedDoctorSystemOutput).toEqual(
      healthyState!.expectedDoctorSystemOutput
    );
    expect(nearFullState?.expectedExitCode).toBe(0);
  });
});
