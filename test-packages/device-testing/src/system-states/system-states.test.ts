/**
 * Smoke tests for the SystemState registry.
 *
 * Asserts:
 *  - Registry contains all expected states.
 *  - Each state satisfies the schema invariants (schemaVersion, etc.).
 *  - `healthy` state's expectedDoctorSystemOutput matches the golden file.
 *  - Every fixture's `checks[].id` is a real doctor system-scope check id
 *    (no phantoms — the VM cross-check would fail otherwise, but it's
 *    cheaper to fail in unit tests when a registry rename happens).
 *
 * The end-to-end "doctor under this state actually emits these checks"
 * assertion lives in `test-packages/e2e-vm-tests/src/system-state-cross-
 * check.e2e.test.ts` — that test runs `apply-state.sh` + `podkit doctor
 * --scope system --json` inside the VM and compares the parsed output to
 * `expectedDoctorSystemOutput`.
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
  'device-mount-fits-estimate-failed-sweep',
  'device-mount-fits-estimate-source-drifts',
] as const;

/**
 * Registry of valid doctor system-scope check ids. Mirrors the system-scope
 * subset of `packages/podkit-core/src/diagnostics/index.ts`'s CHECKS list.
 * The unit test below asserts every fixture's `checks[].id` is in this set
 * so a registry rename (or a fixture typo) fails here before the VM
 * cross-check runs.
 *
 * If a new system-scope check lands in the registry, add its id here AND
 * add it to the relevant fixtures (the cross-check will fail with a clear
 * "missing check" diff if you forget).
 */
const KNOWN_SYSTEM_CHECK_IDS = new Set<string>([
  'codec-encoders',
  'inquiry-methods',
  'video-encoder',
  'debris-transcode-tmp',
  'udev-rule',
]);

// ── Registry size + key presence ─────────────────────────────────────────────

describe('systemStates registry', () => {
  it('contains exactly 9 states', () => {
    expect(systemStates.size).toBe(9);
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

    it(`"${id}" expectedExitCode is 0 or 2 (never 1 — that's command error)`, () => {
      const state = systemStates.get(id);
      // System-only doctor uses exit 0 (healthy) or 2 (issues-found);
      // exit 1 is reserved for command-level errors (e.g. CORE_LOAD_FAILED)
      // and is never emitted by a clean diagnostic run.
      expect([0, 2]).toContain(state?.expectedExitCode ?? -1);
    });
  }
});

// ── Phantom-ID guard ─────────────────────────────────────────────────────────

describe('no phantom check ids', () => {
  for (const id of EXPECTED_IDS) {
    it(`"${id}" references only registered system-scope check ids`, () => {
      const state = systemStates.get(id);
      const fixtureIds = (state?.expectedDoctorSystemOutput.checks ?? []).map((c) => c.id);
      const phantoms = fixtureIds.filter((cid) => !KNOWN_SYSTEM_CHECK_IDS.has(cid));
      expect(phantoms).toEqual([]);
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
