#!/usr/bin/env bun
/**
 * Standalone driver for `transferBinary` + `transferGpodTool`. Invoked by
 * the mise task `device-testing:transfer-binary` so developers can push the
 * latest linux-x64/arm64 podkit binary into the Lima test VM without
 * running the rest of the test pipeline.
 *
 * Resolution rules:
 *   - VM defaults to `podkit-device-harness` (override via PODKIT_DEVICE_HARNESS_VM_NAME).
 *   - Podkit binary resolved from `packages/podkit-cli/bin/podkit-linux-${arch}`
 *     where `${arch}` is `process.arch` mapped to `x64`/`arm64`. Override
 *     via PODKIT_LINUX_BINARY.
 *   - gpod-tool is best-effort: if the host artefact is absent, we warn and
 *     continue. Override via PODKIT_GPOD_TOOL_BINARY.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transferBinary, transferGpodTool } from '../src/runners/lima-test-vm-binary.js';
import {
  resolveDefaultDummyHcdDaemonBinary,
  DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
} from '../src/runners/lima-test-vm.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

function resolveArch(): 'x64' | 'arm64' {
  if (process.arch === 'x64') return 'x64';
  if (process.arch === 'arm64') return 'arm64';
  throw new Error(
    `unsupported host arch '${process.arch}'. The builder VM produces ` +
      `linux-x64 and linux-arm64 only.`
  );
}

function resolvePodkitBinary(): string {
  const override = process.env['PODKIT_LINUX_BINARY'];
  if (override) return path.resolve(override);
  const arch = resolveArch();
  return path.join(REPO_ROOT, 'packages', 'podkit-cli', 'bin', `podkit-linux-${arch}`);
}

function resolveGpodToolBinary(): string {
  // Host-side cross-build for gpod-tool is not yet wired up — see
  // test-packages/device-testing/lima/README.md §"gpod-tool sourcing". Developers
  // who built one out-of-band can point at it via env.
  const override = process.env['PODKIT_GPOD_TOOL_BINARY'];
  if (override) return path.resolve(override);
  // Plausible default if a host build ever lands.
  return path.join(REPO_ROOT, 'tools', 'gpod-tool', 'gpod-tool-linux');
}

async function main(): Promise<void> {
  const vmName = process.env['PODKIT_DEVICE_HARNESS_VM_NAME'] ?? 'podkit-device-harness';
  const podkitPath = resolvePodkitBinary();

  if (!fs.existsSync(podkitPath)) {
    console.error(
      `ERROR: podkit linux binary not found at ${podkitPath}.\n` +
        `       Run: bunx turbo run @podkit/device-testing#build:linux-binary\n` +
        `       Or:  mise run device-testing:build-linux\n` +
        `       Override path: PODKIT_LINUX_BINARY=<path>`
    );
    process.exit(1);
  }

  console.log(`==> transferring podkit binary to ${vmName}...`);
  console.log(`    host: ${podkitPath}`);
  const podkitResult = await transferBinary({ vmName, binaryPath: podkitPath });
  if (podkitResult.skipped) {
    console.log(
      `    skipped — ${vmName} already has matching sha256 (${podkitResult.hostSha256.slice(0, 12)}...)`
    );
  } else {
    console.log(
      `    installed at ${podkitResult.vmPath} (sha256=${podkitResult.hostSha256.slice(0, 12)}...)`
    );
  }

  const gpodToolPath = resolveGpodToolBinary();
  if (fs.existsSync(gpodToolPath)) {
    console.log(`==> transferring gpod-tool to ${vmName}...`);
    console.log(`    host: ${gpodToolPath}`);
    const gpodResult = await transferGpodTool({
      vmName,
      binaryPath: gpodToolPath,
    });
    if (gpodResult.skipped) {
      console.log(
        `    skipped — ${vmName} already has matching sha256 (${gpodResult.hostSha256.slice(0, 12)}...)`
      );
    } else {
      console.log(`    installed at ${gpodResult.vmPath}`);
    }
  } else {
    console.log(
      `==> skipping gpod-tool transfer: ${gpodToolPath} does not exist.\n` +
        `    Host-side gpod-tool linux build is not yet wired up\n` +
        `    (see test-packages/device-testing/lima/README.md §"gpod-tool sourcing").\n` +
        `    Override the path via PODKIT_GPOD_TOOL_BINARY=<path>.`
    );
  }

  const daemonPath = resolveDefaultDummyHcdDaemonBinary();
  if (fs.existsSync(daemonPath)) {
    console.log(`==> transferring dummy-hcd-daemon to ${vmName}...`);
    console.log(`    host: ${daemonPath}`);
    const daemonResult = await transferBinary({
      vmName,
      binaryPath: daemonPath,
      vmPath: DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
    });
    if (daemonResult.skipped) {
      console.log(
        `    skipped — ${vmName} already has matching sha256 (${daemonResult.hostSha256.slice(0, 12)}...)`
      );
    } else {
      console.log(`    installed at ${daemonResult.vmPath}`);
    }
  } else {
    console.log(
      `==> skipping dummy-hcd-daemon transfer: ${daemonPath} does not exist.\n` +
        `    Build it: mise run device-testing:build-daemon\n` +
        `    Override the path via PODKIT_DUMMY_HCD_DAEMON_BINARY=<path>.`
    );
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`ERROR: ${msg}`);
  process.exit(1);
});
