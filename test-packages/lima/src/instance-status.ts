/**
 * Lima instance status probe. Reports whether a named instance is running,
 * stopped, or missing — the foundational read the lifecycle primitives branch
 * on. Routed through the injected `SubprocessRunner` so it is unit-testable
 * with scripted `limactl list --json` outputs.
 *
 * @module
 */

import { defaultSubprocessRunner, type SubprocessRunner } from '@podkit/device-types';
import { LIMA_DEVICE_HARNESS_VM_NAME } from './registry.js';
import type { LimactlResult } from './limactl.js';

/** Tri-state Lima instance status. */
export type InstanceStatus = 'running' | 'stopped' | 'missing';

interface LimactlListEntry {
  name?: string;
  status?: string;
}

/**
 * Probe the Lima instance status. Returns `missing` for both "limactl not
 * installed" and "no such instance", since callers reach the same
 * "unavailable" conclusion either way.
 */
export async function instanceStatus(
  vmName: string = LIMA_DEVICE_HARNESS_VM_NAME,
  subprocess: SubprocessRunner = defaultSubprocessRunner
): Promise<InstanceStatus> {
  let result: LimactlResult;
  try {
    result = await subprocess.run('limactl', ['list', '--json']);
  } catch {
    return 'missing';
  }
  if (result.exitCode !== 0) {
    return 'missing';
  }
  // `limactl list --json` prints one JSON object per line (NDJSON). Parse each
  // line independently; ignore parse errors so an unexpected Lima version
  // change does not turn into a hard failure.
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: LimactlListEntry;
    try {
      entry = JSON.parse(trimmed) as LimactlListEntry;
    } catch {
      continue;
    }
    if (entry.name !== vmName) continue;
    const status = (entry.status ?? '').toLowerCase();
    if (status === 'running') return 'running';
    return 'stopped';
  }
  return 'missing';
}
