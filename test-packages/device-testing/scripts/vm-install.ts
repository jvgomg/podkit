#!/usr/bin/env bun
/**
 * Turbo task body for `@podkit/device-testing#vm:install`.
 *
 * Sits between turbo's "binaries built" signal and the bytes-in-VM state. The
 * Linux-binary turbo tasks own the compile; this script owns the transfer and
 * the cache marker.
 *
 * Flow:
 *
 *   1. Ensure the VM is reachable. Stale-binary refresh is meaningless against
 *      a stopped or missing VM; we surface the same actionable error
 *      `harness.ts install` would.
 *   2. Transfer the podkit / dummy-hcd-daemon / gpod-tool binaries + systemd
 *      unit using the existing transfer primitives. Each helper sha256-skips
 *      when the VM already has the right bytes, so this is cheap on a no-op
 *      run.
 *   3. Write a single-line marker at `.turbo/vm-install-marker` containing the
 *      sha256s + VM name. Turbo's `outputs` glob picks the file up and stores
 *      it in the cache; the next run with unchanged inputs replays the cache
 *      hit and skips this script entirely.
 *
 * `harness:install` (the developer-facing UX) and this script are deliberately
 * separated: harness:install is interactive (logs each transfer, runs
 * `cmdStatus` at the end), while this script is silent on cache hit and exits
 * with a single summary line. Both end at the same place — the VM has the
 * same bytes — but the entry points differ.
 *
 * @see documents/architecture/testing/vm-build-orchestration.md
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  instanceStatus,
  LIMA_DEVICE_HARNESS_VM_NAME,
  DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
  resolveDefaultPodkitBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from '../src/runners/lima-test-vm.js';
import {
  transferBinary,
  transferGpodTool,
  DEFAULT_PODKIT_VM_PATH,
  DEFAULT_GPOD_TOOL_VM_PATH,
} from '../src/runners/lima-test-vm-binary.js';
import {
  transferSystemdUnit,
  resolveDefaultDummyHcdDaemonUnit,
  DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH,
} from '../src/runners/lima-test-vm-systemd.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..');
const MARKER_PATH = path.join(PACKAGE_ROOT, '.turbo', 'vm-install-marker');

interface Summary {
  vmName: string;
  podkitSha: string;
  daemonSha: string | null;
  gpodToolSha: string;
  unitSha: string;
}

async function main(): Promise<number> {
  const vmName = LIMA_DEVICE_HARNESS_VM_NAME;

  const status = await instanceStatus().catch(() => 'missing' as const);
  if (status === 'missing') {
    process.stderr.write(
      `[vm:install] Lima instance \`${vmName}\` is not registered.\n` +
        `[vm:install] Run \`bun run harness:setup\` to create it.\n`
    );
    return 1;
  }
  if (status === 'stopped') {
    process.stderr.write(
      `[vm:install] Lima instance \`${vmName}\` is stopped.\n` +
        `[vm:install] Run \`bun run harness:start\` first.\n`
    );
    return 1;
  }

  // 1. Podkit binary — fatal if missing on host. The build:linux-binary
  //    turbo task is a `dependsOn` of this script's task, so a successful
  //    invocation guarantees the artefact exists; a missing file means turbo
  //    cached a stale "success" signal or the build silently produced no
  //    output. Either way: refuse rather than silently re-use yesterday's
  //    bytes.
  const podkitPath = resolveDefaultPodkitBinary();
  if (!fs.existsSync(podkitPath)) {
    process.stderr.write(
      `[vm:install] podkit linux binary not found at ${podkitPath}.\n` +
        `[vm:install] The dependent build task should have produced it. ` +
        `Run \`bunx turbo run @podkit/device-testing#build:linux-binary --force\` to diagnose.\n`
    );
    return 1;
  }
  const podkitResult = await transferBinary({ vmName, binaryPath: podkitPath });
  process.stdout.write(
    `[vm:install] podkit → ${vmName}:${DEFAULT_PODKIT_VM_PATH}` +
      ` (${podkitResult.skipped ? 'skipped — sha256 matches' : 'installed'}; ` +
      `sha256=${podkitResult.hostSha256.slice(0, 12)}...)\n`
  );

  // 2. gpod-tool — REQUIRED. Same reasoning as podkit.
  const gpodToolPath = resolveDefaultGpodToolBinary();
  if (!fs.existsSync(gpodToolPath)) {
    process.stderr.write(
      `[vm:install] gpod-tool linux binary not found at ${gpodToolPath}.\n` +
        `[vm:install] The dependent build task should have produced it.\n`
    );
    return 1;
  }
  const gpodResult = await transferGpodTool({ vmName, binaryPath: gpodToolPath });
  process.stdout.write(
    `[vm:install] gpod-tool → ${vmName}:${DEFAULT_GPOD_TOOL_VM_PATH}` +
      ` (${gpodResult.skipped ? 'skipped — sha256 matches' : 'installed'}; ` +
      `sha256=${gpodResult.hostSha256.slice(0, 12)}...)\n`
  );

  // 3. dummy-hcd-daemon — best-effort. Persona tests need it; doctor-only
  //    tests don't. Match the harness.ts and lima-test-vm.ts policy.
  const daemonPath = resolveDefaultDummyHcdDaemonBinary();
  let daemonSha: string | null = null;
  if (fs.existsSync(daemonPath)) {
    const daemonResult = await transferBinary({
      vmName,
      binaryPath: daemonPath,
      vmPath: DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
    });
    daemonSha = daemonResult.hostSha256;
    process.stdout.write(
      `[vm:install] dummy-hcd-daemon → ${vmName}:${DEFAULT_DUMMY_HCD_DAEMON_VM_PATH}` +
        ` (${daemonResult.skipped ? 'skipped — sha256 matches' : 'installed'}; ` +
        `sha256=${daemonResult.hostSha256.slice(0, 12)}...)\n`
    );
  } else {
    process.stdout.write(
      `[vm:install] dummy-hcd-daemon binary missing at ${daemonPath} — ` +
        `skipping (build via \`bunx turbo run @podkit/device-testing-daemon#build\`).\n`
    );
  }

  // 4. systemd unit — always run; helper sha256-skips when already current.
  const unitResult = await transferSystemdUnit({
    vmName,
    hostUnitPath: resolveDefaultDummyHcdDaemonUnit(),
  });
  process.stdout.write(
    `[vm:install] systemd unit → ${vmName}:${DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH}` +
      ` (${unitResult.skipped ? 'skipped — sha256 matches' : 'installed'}; ` +
      `sha256=${unitResult.hostSha256.slice(0, 12)}...)\n`
  );

  // 5. Write the turbo marker. The marker's contents capture the bytes-in-VM
  //    state so a reader (test, debugger) can correlate cache hits with the
  //    exact artefacts in play. Turbo cares only about the file existing for
  //    its outputs glob; we make the body informative.
  const summary: Summary = {
    vmName,
    podkitSha: podkitResult.hostSha256,
    daemonSha,
    gpodToolSha: gpodResult.hostSha256,
    unitSha: unitResult.hostSha256,
  };
  fs.mkdirSync(path.dirname(MARKER_PATH), { recursive: true });
  fs.writeFileSync(MARKER_PATH, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  process.stdout.write(
    `[vm:install] marker written → ${path.relative(PACKAGE_ROOT, MARKER_PATH)}\n`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[vm:install] unexpected error: ${msg}\n`);
    process.exit(1);
  });
