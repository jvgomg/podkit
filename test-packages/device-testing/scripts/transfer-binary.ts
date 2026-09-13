#!/usr/bin/env bun
/**
 * Standalone driver for `transferBinary`. Pushes the latest
 * linux-x64/arm64 podkit binary (and the dummy-hcd-daemon, if a host build
 * exists) into the device substrate without running the rest of the install
 * pipeline. Useful when iterating only on the podkit binary; for the full
 * install flow (podkit + daemon + gpod-tool + systemd unit) use
 * `bun run harness:install` instead.
 *
 * Resolution rules:
 *   - The substrate is whichever one this machine has selected — see
 *     `PODKIT_SUBSTRATE` in `.env.example`. This script used to carry its own
 *     `PODKIT_DEVICE_HARNESS_VM_NAME` override, which was a second selection
 *     mechanism nothing else honoured; a machine that had configured one and
 *     not the other would push a binary to a box it was not testing.
 *   - Podkit binary resolved from `packages/podkit-cli/bin/podkit-linux-${arch}`
 *     where `${arch}` is `process.arch` mapped to `x64`/`arm64`. Override
 *     via PODKIT_LINUX_BINARY.
 *
 * Note: this script intentionally does NOT re-transfer gpod-tool. gpod-tool
 * is a required harness dependency installed by `bun run harness:install`;
 * use that command if you need to refresh it.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transferBinary } from '../src/runners/lima-test-vm-binary.js';
import { resolveDeviceSubstrate } from '../src/runners/substrate.js';
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

async function main(): Promise<void> {
  const { link } = resolveDeviceSubstrate({ notice: (line) => console.log(`==> ${line}`) });
  const vmName = link.description;
  const podkitPath = resolvePodkitBinary();

  if (!fs.existsSync(podkitPath)) {
    console.error(
      `ERROR: podkit linux binary not found at ${podkitPath}.\n` +
        `       Run: bun run harness:install   (builds + transfers in one go)\n` +
        `       Or:  bunx turbo run @podkit/device-testing#build:linux-binary\n` +
        `       Override path: PODKIT_LINUX_BINARY=<path>`
    );
    process.exit(1);
  }

  console.log(`==> transferring podkit binary to ${vmName}...`);
  console.log(`    host: ${podkitPath}`);
  const podkitResult = await transferBinary({ link, binaryPath: podkitPath });
  if (podkitResult.skipped) {
    console.log(
      `    skipped — ${vmName} already has matching sha256 (${podkitResult.hostSha256.slice(0, 12)}...)`
    );
  } else {
    console.log(
      `    installed at ${podkitResult.vmPath} (sha256=${podkitResult.hostSha256.slice(0, 12)}...)`
    );
  }

  const daemonPath = resolveDefaultDummyHcdDaemonBinary();
  if (fs.existsSync(daemonPath)) {
    console.log(`==> transferring dummy-hcd-daemon to ${vmName}...`);
    console.log(`    host: ${daemonPath}`);
    const daemonResult = await transferBinary({
      link,
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
        `    Build it: bunx turbo run @podkit/device-testing-daemon#build\n` +
        `    Override the path via PODKIT_DUMMY_HCD_DAEMON_BINARY=<path>.`
    );
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`ERROR: ${msg}`);
  process.exit(1);
});
