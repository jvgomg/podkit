/**
 * VM coverage — udev rule USB scope (commit `cdebfb3`).
 *
 * Pins the installed udev-rule contract end-to-end inside the test VM:
 *
 *   - The active rule file at `/etc/udev/rules.d/91-podkit-ipod.rules`
 *     contains BOTH a `SUBSYSTEM=="scsi_generic"` clause and a
 *     `SUBSYSTEM=="usb"` clause for Apple vendor `05ac`.
 *   - The ATTR-case distinction holds: `ATTRS{idVendor}` (plural) on the
 *     SCSI clause; `ATTR{idVendor}` (singular) on the USB clause. The
 *     plural vs singular form is load-bearing because the scsi_generic
 *     event has to walk the USB parent chain, while the USB event reads
 *     its own attribute directly.
 *   - Mode is `0660`, group is `plugdev`, and `TAG+="uaccess"` is set on
 *     both clauses (cross-distro coverage: plugdev for Debian-family,
 *     uaccess for systemd-logind).
 *   - The doctor system check `udev-rule` reports `status: 'pass'` with
 *     the canonical path in its details — the renderer's contract for the
 *     repair-not-needed case.
 *
 * # Scope limitations
 *
 *   - The "fresh VM, no rule installed → repair → file appears" cycle
 *     requires removing the installed rule, restarting the VM (or
 *     applying a `no-udev` system state), and exercising
 *     `podkit doctor --repair udev-rule`. The `no-udev` system state
 *     exists but its snapshot setter is forthcoming; running the repair
 *     against the live healthy VM would mutate shared VM state for
 *     subsequent tests. The repair-flow itself is covered exhaustively
 *     in `packages/podkit-core/src/diagnostics/checks/udev-rule.test.ts`
 *     (44/44 tests).
 *
 *   - The "legacy `91-podkit-ipod-scsi.rules` cleanup on repair" half of
 *     the AC has the same dependency. We assert here that the legacy
 *     file is NOT currently present (the healthy VM is provisioned with
 *     the post-rename layout), but the cleanup-during-repair path is
 *     covered unit-side.
 *
 *   - The "SSH-session inquiry succeeds without sudo" assertion requires
 *     a real iPod or a fully-bound mass-storage gadget with the right
 *     vendor ID AND the user to NOT be root inside the VM (`lima-test-vm`
 *     SSHes in as the unprivileged Lima user, so this half is satisfiable
 *     — but the assertion needs a bound dummy-hcd persona with `/dev/sg*`
 *     access AND the rule's ACL grant to take effect, which depends on
 *     udev event ordering after the gadget binds). The end-to-end test
 *     of "rule grants access" effectively duplicates the orchestrator-EACCES
 *     coverage; we defer that combined assertion to a follow-up.
 *
 * @see commit cdebfb3
 * @see packages/podkit-cli/share/91-podkit-ipod.rules
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  runJsonCommand,
  healthy,
} from '@podkit/device-testing';

describe('VM: udev rule USB scope', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, VM_COLD_TIMEOUT_MS);

    it(
      'installed udev rule covers both scsi_generic AND usb subsystems for Apple vendor 05ac',
      async () => {
        const result = await limaTestVmRunner.run('cat /etc/udev/rules.d/91-podkit-ipod.rules', {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        expect(result.exitCode).toBe(0);

        // SCSI clause — uses ATTRS{} (plural) because scsi_generic has to
        // walk up to its parent USB device for the idVendor read.
        expect(result.stdout).toMatch(/SUBSYSTEM=="scsi_generic"[\s\S]*?ATTRS\{idVendor\}=="05ac"/);

        // USB clause — uses ATTR{} (singular) because the USB device node
        // exposes idVendor directly.
        expect(result.stdout).toMatch(/SUBSYSTEM=="usb"[\s\S]*?ATTR\{idVendor\}=="05ac"/);

        // Exactly two `idVendor` match references (one per clause) — pins
        // against a future regression where someone copy-pastes a third
        // clause without realising the rule is hot-loaded.
        const vendorMatches = result.stdout.match(/idVendor\}=="05ac"/g) ?? [];
        expect(vendorMatches.length).toBe(2);

        // Mode + group + tag — cross-distro coverage for plugdev (Debian)
        // AND uaccess (systemd-logind). The shipped file uses each token
        // in the SCSI clause AND the USB clause body — exactly twice each
        // in the rule bodies (we match the comma-prefixed forms to skip
        // doc-comment mentions of the same strings).
        const modeMatches = result.stdout.match(/MODE="0660"/g) ?? [];
        expect(modeMatches.length).toBe(2);
        const groupBodyMatches = result.stdout.match(/, GROUP="plugdev"/g) ?? [];
        expect(groupBodyMatches.length).toBe(2);
        const uaccessBodyMatches = result.stdout.match(/, TAG\+="uaccess"/g) ?? [];
        expect(uaccessBodyMatches.length).toBe(2);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'no legacy 91-podkit-ipod-scsi.rules file present alongside the renamed rule',
      async () => {
        // The cdebfb3 commit renamed the file from `91-podkit-ipod-scsi.
        // rules` → `91-podkit-ipod.rules` and added cleanup on repair.
        // A correctly-provisioned VM only has the new name; the legacy
        // file must NOT be loaded by udev alongside it (would cause
        // duplicate rule processing).
        const result = await limaTestVmRunner.run(
          'ls /etc/udev/rules.d/91-podkit-ipod-scsi.rules 2>/dev/null || echo "absent"',
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        expect(result.stdout.trim()).toBe('absent');
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'doctor udev-rule check reports pass with the canonical path',
      async () => {
        // End-to-end cross-check: the udev-rule check (`packages/podkit-
        // core/src/diagnostics/checks/udev-rule.ts`) discovers the rule
        // via its known-paths array, reads the file, and asserts the
        // expected content. A passing status means the in-source
        // `UDEV_RULE_CONTENT` matches what's installed — the byte-for-
        // byte share/source equality pinned in the unit suite.
        //
        // Doctor exits with code 2 when ANY system check warns
        // (`inquiry-methods` warns on this VM because no Apple-vendor
        // gadget is bound during this test). `runJsonCommand` parses
        // the envelope regardless of exit code; we accept exit 0 (all-
        // pass) or 2 (issues-found) since we only care about the
        // udev-rule check's status, not the overall verdict.
        const invocation = await runJsonCommand(
          limaTestVmRunner,
          '/usr/local/bin/podkit doctor --scope system --json',
          VM_WARM_TIMEOUT_MS
        );
        expect([0, 2]).toContain(invocation.exitCode);
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as {
          checks: Array<{
            id: string;
            status: string;
            details?: { path?: string };
          }>;
        };
        const udev = parsed.checks.find((c) => c.id === 'udev-rule');
        expect(udev).toBeDefined();
        expect(udev?.status).toBe('pass');
        expect(udev?.details?.path).toBe('/etc/udev/rules.d/91-podkit-ipod.rules');
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
