---
id: TASK-292.13
title: >-
  Linux SCSI permission UX: full hardware review on linka (deferred until all
  discovery code lands)
status: Done
assignee: []
created_date: '2026-05-03 15:53'
updated_date: '2026-05-08 08:12'
labels:
  - device-capability-architecture
  - hardware-validation
  - linux
  - deferred
milestone: m-18
dependencies:
  - TASK-292.12
parent_task_id: TASK-292
ordinal: 9999
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-292.12 — the udev-rule install repair was unit-tested and shipped, but the full end-to-end install flow on real hardware is unverified because non-interactive SSH cannot prompt for sudo.

This task: set up the podkit repo on the linka Linux box, run the full UX flow against nano 4G, capture feedback, fix any rough edges, and ship e2e tests that work in the Linux VM testing stack.

## Scope

1. **Repo setup on linka**
   - Clone or rsync podkit to ~/podkit on linka (Debian 12, bun 1.3.13 via mise, james in plugdev + sudo).
   - `bun install`, `bun run build --filter podkit`, verify `podkit --version` invocable.
   - Document the dev-on-linka setup steps in `docs/developers/development.md`'s Linux section.

2. **End-to-end UX walk-through (interactive, on the linka console)**
   - Remove existing rule: `sudo rm /etc/udev/rules.d/91-podkit-ipod-scsi.rules && sudo udevadm control --reload && sudo udevadm trigger`. Replug nano 4G. Confirm `/dev/sg3` is `root:disk` 0660.
   - Run `podkit doctor --repair sysinfo-extended -d <nano-4g>` WITHOUT sudo. Should fail with the new EACCES message (sudo recommendation + udev-rule install + replug + docs URL). Capture the actual output verbatim.
   - Run `podkit doctor --repair udev-rule`. sudo prompts natively for the cp + udevadm calls. Verify rule installed at `/etc/udev/rules.d/91-podkit-ipod-scsi.rules` with `TAG+="uaccess"`.
   - Replug nano 4G. Confirm `/dev/sg3` is now `root:plugdev` 0660.
   - Re-run `podkit doctor --repair sysinfo-extended -d <nano-4g>` WITHOUT sudo. Should succeed.
   - Capture user feedback on the message wording, prompts, error recovery, etc.

3. **Fixes from feedback**
   - Adjust EACCES message text, repair output, sudo handling, docs URL placeholder, etc. based on what felt clunky in step 2.

4. **e2e tests for the Linux VM testing stack**
   - The repo has a Linux VM testing stack — `mise run test:linux` and `tools/lima/run-tests.sh`. Add e2e tests that exercise the EACCES path and the udev-rule install path inside the VM (without needing real iPod hardware — fake the SCSI device or use loopback, or mock the install step against /tmp paths).
   - At minimum: drive the SCSI transport against a path with EACCES (chmod a synthetic path), assert the error message structure verbatim. The udev-rule install can be a dry-run-only e2e (skip the actual /etc/udev write inside the VM).
   - Tests should run as part of `mise run test:linux`.

5. **Address deferred ACs from TASK-292.12**
   - AC #6: ship a `podkit doctor --uninstall udev-rule` or document the `sudo rm` steps prominently in the docs site.
   - AC #10: validate the rule on a non-Debian distro (Arch or Fedora) — could spin up a Lima VM with one of those for the test, or document this as still pending.

## Acceptance criteria

- Full end-to-end UX flow on linka completed and recorded (commands + outputs in this task's notes or a doc).
- EACCES message + repair output reviewed by user; any wording fixes applied.
- e2e tests exist and pass under `mise run test:linux` covering the EACCES path.
- TASK-292.12 deferred ACs (#6, #10) closed or explicitly punted to a follow-up with reasoning.
- documents/test-devices.md updated with linka's nano 4G "podkit doctor SCSI / USB" rows.

## Context

- TASK-292.12 implementation notes have the deferral details.
- linka SSH: `ssh james@linka` (Tailscale, passwordless to the box but sudo needs interactive password).
- nano 4G on linka USB: vendor 0x05ac, product 0x1263, /dev/sg3 when udev rule active.
- Rule files: `packages/podkit-cli/share/91-podkit-ipod-scsi.rules` (default, vendor-only) + `91-podkit-ipod-scsi-narrow.rules` (product-ID-narrowed variant).
- Repair implementation: `packages/podkit-core/src/diagnostics/checks/udev-rule.ts`.
- EACCES message: `packages/ipod-firmware/src/inquiry/scsi/errors.ts` (defaultMessage `case 'eacces'`).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Folded into TASK-S-B (linka full sweep). The udev-rule install + EACCES UX + sudo-first flow is exercised end-to-end as part of the consolidated linka session, not as its own out-of-band task.
<!-- SECTION:NOTES:END -->
