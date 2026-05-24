/**
 * Tier-3 smoke test: two `dummy-hcd-daemon@<persona>.service` units running
 * side-by-side.
 *
 * # Why this exists
 *
 * The dummy-hcd daemon used to hardcode both its configfs gadget directory
 * (`podkit-test`) and FunctionFS mountpoint (`/dev/ffs-podkit`). A second
 * `systemctl start dummy-hcd-daemon@<id>.service` collided on either resource
 * and the kernel never enumerated both devices, blocking every multi-iPod
 * scenario the runner needs to exercise (dual-iPod discovery, replug-while-
 * other-bound, multi-device doctor flows). The systemd template now passes
 * `--gadget-name podkit-%i` and `--ffs-mount /dev/ffs-podkit-%i` so each
 * unit owns a distinct configfs tree and FunctionFS mountpoint. This test
 * is the tripwire that the per-persona derivation actually keeps the two
 * units isolated end-to-end.
 *
 * # Persona pair
 *
 * `echo-mini` (mass-storage only, no FunctionFS function) plus
 * `ipod-video-5g-iflash-1tb` (FunctionFS + mass-storage). The pair
 * exercises both gadget shapes — pure-mass-storage and FFS-bearing — so a
 * future regression that only touches one branch still surfaces here.
 *
 * # Assertions
 *
 *   1. Both units enter `active (running)` after `systemctl start`.
 *   2. Each persona's configfs directory exists at
 *      `/sys/kernel/config/usb_gadget/podkit-<id>`.
 *   3. The kernel surfaces at least two more `/dev/sg*` nodes than the
 *      pre-test baseline (the boot disk has its own sg nodes; we count
 *      deltas, not absolutes).
 *   4. `systemctl stop` removes both configfs trees and leaves no orphan
 *      gadget directory behind.
 *
 * # Setup approach
 *
 * Uses the production systemd template (unlike `mass-storage-binding.tier3.
 * test.ts` which writes a synthetic sidecar): we want the wiring tested as
 * the runner actually drives it, including the per-persona flags now
 * baked into `ExecStart`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  LIMA_TEST_VM_NAME,
  limaTestVmRunner,
  startDaemonForPersona,
  stopDaemon,
} from '../runners/lima-test-vm.js';
import { healthy } from '../system-states/healthy.js';
import { echoMini } from '../personas/echo-mini/persona.js';
import { ipodVideo5gIflash1tb } from '../personas/ipod-video-5g-iflash-1tb/persona.js';
import {
  TIER3_COLD_TIMEOUT_MS,
  TIER3_WARM_TIMEOUT_MS,
  resolveTier3Availability,
} from './tier3-runtime-setup.js';

const tier3Available = await resolveTier3Availability();

// ---------------------------------------------------------------------------
// Persona pair — see module header for the rationale.
// ---------------------------------------------------------------------------

const PERSONA_A = echoMini;
const PERSONA_B = ipodVideo5gIflash1tb;

/** Per-persona configfs directory; mirrors the systemd template's `podkit-%i`. */
function gadgetDirFor(personaId: string): string {
  return `/sys/kernel/config/usb_gadget/podkit-${personaId}`;
}

interface VmResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function vm(cmd: string, timeoutMs: number = TIER3_WARM_TIMEOUT_MS): Promise<VmResult> {
  return limaTestVmRunner.run(cmd, { timeoutMs });
}

/** Count `/dev/sg*` nodes currently present in the VM. */
async function countScsiGenericNodes(): Promise<number> {
  // `ls -1 /dev/sg* 2>/dev/null | wc -l` reports 0 when no node exists.
  // We do not use `find /dev -maxdepth 1` because the test VM's busybox
  // variants do not always implement `-maxdepth` consistently — `ls` +
  // `wc -l` is portable and the count is what we care about.
  const result = await vm('ls -1 /dev/sg* 2>/dev/null | wc -l');
  if (result.exitCode !== 0) {
    throw new Error(`countScsiGenericNodes: ls failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  const n = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`countScsiGenericNodes: non-numeric stdout: ${JSON.stringify(result.stdout)}`);
  }
  return n;
}

/** Wait until both `systemctl is-active` checks report `active`. */
async function waitForBothUnitsActive(
  personaA: string,
  personaB: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatusA = '(not yet probed)';
  let lastStatusB = '(not yet probed)';
  while (Date.now() < deadline) {
    const [a, b] = await Promise.all([
      vm(`sudo systemctl is-active dummy-hcd-daemon@${personaA}.service`),
      vm(`sudo systemctl is-active dummy-hcd-daemon@${personaB}.service`),
    ]);
    lastStatusA = a.stdout.trim();
    lastStatusB = b.stdout.trim();
    if (lastStatusA === 'active' && lastStatusB === 'active') return;
    await sleep(200);
  }
  throw new Error(
    `waitForBothUnitsActive: timed out after ${timeoutMs}ms. ` +
      `${personaA}=${lastStatusA}, ${personaB}=${lastStatusB}.`
  );
}

/** Wait until both gadget configfs directories are gone (cleanup verification). */
async function waitForGadgetsGone(personaIds: readonly string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checks = await Promise.all(
      personaIds.map(async (id) => {
        const r = await vm(
          `if [ -d ${gadgetDirFor(id)} ]; then echo present; else echo absent; fi`
        );
        return { id, present: r.stdout.trim() === 'present' };
      })
    );
    if (checks.every((c) => !c.present)) return;
    await sleep(150);
  }
  // Reprobe once to include the still-present ids in the failure message.
  const final = await Promise.all(
    personaIds.map(async (id) => {
      const r = await vm(`if [ -d ${gadgetDirFor(id)} ]; then echo present; else echo absent; fi`);
      return { id, status: r.stdout.trim() };
    })
  );
  throw new Error(
    `waitForGadgetsGone: timed out after ${timeoutMs}ms with stragglers: ` +
      final.map((f) => `${f.id}=${f.status}`).join(', ')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!tier3Available)('Tier 3: dual-daemon lifecycle', () => {
  beforeAll(async () => {
    // prepare() reinstalls the systemd template on any change (sha256-keyed),
    // so a fresh checkout with the per-persona ExecStart picks up automatically.
    await limaTestVmRunner.prepare();
    await limaTestVmRunner.applyState(healthy);
    // Defensive: scrub any stale dummy-hcd unit from a prior crashed run.
    await stopDaemon({ vmName: LIMA_TEST_VM_NAME });
  }, TIER3_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await stopDaemon({ vmName: LIMA_TEST_VM_NAME });
    await limaTestVmRunner.teardown();
  }, TIER3_COLD_TIMEOUT_MS);

  it(
    'runs two personas concurrently with distinct configfs gadgets and tears down cleanly',
    async () => {
      const baselineSgCount = await countScsiGenericNodes();

      try {
        // 1. Start both units. startDaemonForPersona issues `systemctl start`;
        //    Type=simple means the call returns once the daemon is forked, not
        //    once it's done binding — `waitForBothUnitsActive` covers the gap.
        await startDaemonForPersona({ vmName: LIMA_TEST_VM_NAME, personaId: PERSONA_A.id });
        await startDaemonForPersona({ vmName: LIMA_TEST_VM_NAME, personaId: PERSONA_B.id });

        // 2. Both units report active. Sets the precondition for the gadget
        //    + /dev/sg* assertions below; without this we'd race the daemon's
        //    UDC bind on the first probe.
        await waitForBothUnitsActive(PERSONA_A.id, PERSONA_B.id, TIER3_WARM_TIMEOUT_MS);

        // 3. Distinct configfs gadgets exist. The test of the per-persona
        //    naming change: a regression to a hardcoded directory name would
        //    leave only one present.
        const dirA = await vm(
          `if [ -d ${gadgetDirFor(PERSONA_A.id)} ]; then echo present; else echo absent; fi`
        );
        const dirB = await vm(
          `if [ -d ${gadgetDirFor(PERSONA_B.id)} ]; then echo present; else echo absent; fi`
        );
        expect(dirA.stdout.trim()).toBe('present');
        expect(dirB.stdout.trim()).toBe('present');

        // 4. Both daemons drive a mass-storage LUN, so the kernel surfaces
        //    one extra /dev/sg* per running unit. Assert against the
        //    pre-start baseline — the boot disk already contributes sg
        //    nodes and the absolute count varies across VM images.
        //    Poll because dummy_hcd enumeration is asynchronous after UDC bind.
        const deadline = Date.now() + TIER3_WARM_TIMEOUT_MS;
        let current = baselineSgCount;
        while (Date.now() < deadline) {
          current = await countScsiGenericNodes();
          if (current >= baselineSgCount + 2) break;
          await sleep(150);
        }
        expect(current).toBeGreaterThanOrEqual(baselineSgCount + 2);
      } finally {
        // Stop both regardless of outcome so a body-level failure doesn't
        // leave the VM with bound gadgets for the next test session.
        await stopDaemon({ vmName: LIMA_TEST_VM_NAME, personaId: PERSONA_A.id }).catch(() => {});
        await stopDaemon({ vmName: LIMA_TEST_VM_NAME, personaId: PERSONA_B.id }).catch(() => {});
      }

      // 5. Cleanup: no orphan configfs directories survive shutdown.
      await waitForGadgetsGone([PERSONA_A.id, PERSONA_B.id], TIER3_WARM_TIMEOUT_MS);
    },
    TIER3_COLD_TIMEOUT_MS
  );
});
