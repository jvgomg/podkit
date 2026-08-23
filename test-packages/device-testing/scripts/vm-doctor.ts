#!/usr/bin/env bun
/**
 * Baseline-drift preflight for the device-harness VM.
 *
 * Hashes the host-side baseline sources
 * (`podkit-device.yaml` + `apply-state.sh`) and compares to the
 * hash file written by `harness:setup` at
 * `/var/lib/podkit-device-harness/baseline-hash` inside the VM. A mismatch
 * means the running VM was provisioned from a different version of the
 * yaml/script than the one currently on disk; the next test run will
 * observe state that does not match the source-of-truth files.
 *
 * Exit codes:
 *   0  hashes match (or doctor is being run against a missing VM and that
 *      is currently treated as the harness's own concern — `harness:setup`
 *      will create the VM and write the hash).
 *   1  drift detected, or a probe failed in a way that prevents the
 *      doctor from giving a meaningful answer.
 *
 * The doctor deliberately does NOT auto-rebuild the VM. Rebuilding takes
 * minutes; an explicit error with the exact remediation command is a
 * better UX than silent disruption. The remediation is always:
 *
 *   bun run harness:destroy && bun run harness:setup
 *
 * `harness:setup` writes the current hash post-install (see
 * `cmdSetup` in `harness.ts`).
 *
 * @see documents/architecture/testing/vm-build-orchestration.md
 * @module
 */

import { instanceStatus, LIMA_DEVICE_HARNESS_VM_NAME } from '../src/runners/lima-test-vm.js';
import { runLimactl } from '../src/runners/lima-limactl.js';
import { defaultSubprocessRunner } from '../src/subprocess.js';
import {
  computeBaselineHash,
  deviceBaselineFiles,
  BASELINE_VM_HASH_PATH,
} from '../src/baseline-hash.js';

function remediation(reason: string): string {
  return [
    `[vm:doctor] ${reason}`,
    '',
    'To rebuild the VM from the current source-of-truth files:',
    '  bun run harness:destroy && bun run harness:setup',
    '',
    'Skipping this check leaves VM tests observing a VM whose provisioning',
    'does not match the YAML / apply-state.sh on disk.',
    '',
  ].join('\n');
}

async function main(): Promise<number> {
  const vmName = LIMA_DEVICE_HARNESS_VM_NAME;

  // 1. VM must be reachable. We treat `missing` as an upstream concern
  //    (harness:setup will create + hash). We treat `stopped` as a clear
  //    error message — drift cannot be checked against a stopped VM.
  const status = await instanceStatus().catch(() => 'missing' as const);
  if (status === 'missing') {
    process.stdout.write(
      `[vm:doctor] Lima instance \`${vmName}\` is missing — no drift to check.\n` +
        `[vm:doctor] Run \`bun run harness:setup\` to create it.\n`
    );
    // Missing VM is not drift; the harness's own check will catch this and
    // surface a more specific message. Doctor passes so test:vm proceeds to
    // the harness preflight, which gives the better error.
    return 0;
  }
  if (status === 'stopped') {
    process.stderr.write(
      `[vm:doctor] Lima instance \`${vmName}\` is stopped — cannot check baseline drift.\n` +
        `[vm:doctor] Run \`bun run harness:start\` first.\n`
    );
    return 1;
  }

  // 2. Compute host-side baseline hash.
  const { combinedSha, files } = computeBaselineHash(deviceBaselineFiles());

  // 3. Read VM-side hash. Absence is treated as drift — the VM exists but
  //    was never sealed by `harness:setup`. (A pre-vm-doctor VM created
  //    before this orchestration landed falls into this bucket; the
  //    remediation is to rebuild via harness:setup so the hash is sealed.)
  const probe = await runLimactl(defaultSubprocessRunner, [
    'shell',
    vmName,
    '--',
    'sh',
    '-c',
    `cat ${BASELINE_VM_HASH_PATH} 2>/dev/null || true`,
  ]).catch((err) => ({ exitCode: 1, stdout: '', stderr: String(err) }));

  if (probe.exitCode !== 0) {
    process.stderr.write(
      remediation(
        `failed to probe VM for baseline hash at ${BASELINE_VM_HASH_PATH}: ` +
          `${probe.stderr.trim() || 'unknown error'}`
      )
    );
    return 1;
  }

  const vmHash = probe.stdout.trim();

  if (!vmHash) {
    process.stderr.write(
      remediation(
        `VM has no baseline hash at ${BASELINE_VM_HASH_PATH}. ` +
          `The VM was likely created before \`vm:doctor\` shipped, or by a manual \`limactl create\`. ` +
          `Rebuild it so the hash is sealed.`
      )
    );
    return 1;
  }

  if (vmHash !== combinedSha) {
    const driftedNames = files.map((f) => `  - ${f.label}`).join('\n');
    process.stderr.write(
      remediation(
        `baseline drift detected.\n` +
          `\n` +
          `VM hash: ${vmHash}\n` +
          `Host hash: ${combinedSha}\n` +
          `\n` +
          `Tracked files (one of these or their composition changed):\n` +
          `${driftedNames}`
      )
    );
    return 1;
  }

  process.stdout.write(
    `[vm:doctor] baseline OK (${vmHash.slice(0, 12)}...; ${files.length} files tracked).\n`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[vm:doctor] unexpected error: ${msg}\n`);
    process.exit(1);
  });
