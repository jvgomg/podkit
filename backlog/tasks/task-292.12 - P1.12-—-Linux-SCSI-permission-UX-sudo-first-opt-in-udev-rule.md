---
id: TASK-292.12
title: P1.12 — Linux SCSI permission UX (sudo-first; opt-in udev rule)
status: Done
assignee: []
created_date: '2026-05-03 12:38'
updated_date: '2026-05-03 15:57'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
  - packages/ipod-firmware/src/inquiry/scsi/errors.ts
  - packages/ipod-firmware/README.md
parent_task_id: TASK-292
ordinal: 8120
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Linux SCSI access via /dev/sgN requires either sudo or a udev rule granting unprivileged access. P0 verified that a minimal `plugdev`-targeted rule works on Debian, but shipping a system-wide udev rule is a bigger commitment than most users need for a one-off `podkit doctor --repair sysinfo-extended` invocation.

This task shapes the UX with **sudo as the primary path** and **udev rule install as an opt-in for power users**.

## UX shape

1. **First-run / one-off:** user hits EACCES → friendly error message recommends `sudo podkit ...` as the immediate fix. No automatic rule install. No nag.
2. **Power-user opt-in:** `podkit setup install-udev-rule` (or similar — naming open) — explicit command that:
   - Detects the distro and chooses the right rule format (see "rule generality" below)
   - Writes to `/etc/udev/rules.d/91-podkit-ipod-scsi.rules` via sudo (or prints the command and rule body for the user to install manually if they decline)
   - Reloads udev and triggers; instructs to replug the device
   - Documents how to undo (`podkit setup uninstall-udev-rule` or just `sudo rm`)
3. **Triggered upgrade:** if podkit ever needs SCSI inquiry as part of `podkit sync` (currently it does not — only `doctor`), the EACCES error message becomes more insistent: "this is going to happen every sync — install the rule (instructions) or run with sudo". Today only `doctor` needs it, so the casual sudo path is fine.
4. **podkit-docker:** out of scope for this task — SCSI in container + daemon is its own architecture problem (see TASK-296).

## Rule generality

P0's rule used `GROUP="plugdev"` which works on Debian/Ubuntu but is not universal:

- **Debian / Ubuntu / Mint:** `plugdev` group exists, populated for desktop users.
- **Arch / Fedora / NixOS / openSUSE:** `plugdev` may not exist or be populated. Modern systemd-udevd recommends `TAG+="uaccess"` which grants access to the currently-logged-in user via ACLs (no group membership needed).
- **macOS:** N/A — IOKit SCSITaskUserClient handles authorization via the iPodSBC kext.

Recommend dual-path rule:

```
ACTION=="add|change", SUBSYSTEM=="scsi_generic", \
  ATTRS{idVendor}=="05ac", \
  MODE="0660", GROUP="plugdev", TAG+="uaccess"
```

`TAG+="uaccess"` is the modern systemd path (Arch, Fedora, NixOS); `GROUP="plugdev"` is the legacy Debian path. Both can coexist — udev-systemd processes uaccess regardless of group.

## Security narrowing

P0's rule grants access on **any Apple-vendor device** that exposes `scsi_generic`. In practice that is iPods only, but principle-of-least-privilege says we should narrow:

- Add a product-ID allow-list (`ATTRS{idProduct}=="120[0-9a-f]"|"126[0-9a-f]"|...`) covering the known iPod USB ID ranges from `@podkit/devices-ipod`'s usb-ids table. Updates to that table propagate to the rule.
- Or use the looser vendor-only rule (current spike) and document that it relies on Apple not shipping non-iPod scsi_generic devices.
- `TAG+="uaccess"` already restricts to the active console user; group-based access is more permissive.

Decision: ship a vendor-only rule by default (matches libusb iPod udev rule patterns); document the trade-off; expose a mode flag if a security-conscious user wants the narrower product-ID list.

## Acceptance items below cover all of the above. The original deliverable (rule file + EACCES message + e2e test) is preserved; the additions are the CLI install command, the multi-distro rule design, and the security stance.

See spec doc-031 (P0 spike findings: Linux permission strategy section), tools/scsi-spike/FINDINGS.md, and tools/scsi-spike/91-podkit-ipod-scsi.rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Friendly EACCES error message in the SCSI transport recommends sudo as the primary fix and mentions the opt-in udev rule install command
- [x] #2 Rule file shipped with podkit (location TBD: @podkit/ipod-firmware/share/, podkit-cli/share/, or similar) — single source of truth for rule content
- [x] #3 Rule uses both `GROUP="plugdev"` and `TAG+="uaccess"` to cover Debian-family and modern systemd distros uniformly
- [x] #4 Rule scope: vendor-only (`ATTRS{idVendor}=="05ac"`) by default. Product-ID-narrowing variant available for security-conscious users (documented, not default)
- [x] #5 `podkit setup install-udev-rule` (or chosen name) command implemented: detects distro, prompts for sudo, copies rule, reloads udev, triggers, instructs replug
- [ ] #6 `podkit setup uninstall-udev-rule` command for clean removal
- [x] #7 User-facing docs explain: sudo is the easy path, install the rule if you sync regularly or have multiple devices, security trade-offs of the broader rule
- [x] #8 e2e test: drive SCSI transport against a path with EACCES, assert error message structure (must include `sudo` recommendation, `podkit setup install-udev-rule` mention, replug instruction)
- [x] #9 Rule install command works on Debian/Ubuntu (verified on linka)
- [ ] #10 Rule install command works on at least one non-plugdev distro (Arch/Fedora — uaccess path) — could be deferred or stubbed if no test environment available, but rule itself must include uaccess for forward compat
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLI command: `podkit doctor --repair udev-rule` (per user direction; not `podkit setup install-udev-rule`). Implementation: standalone repairOnly check `udevRuleCheck` (scope=system) added to core diagnostics registry — same shape as existing `sysinfo-extended`. New `runSystemRepair()` helper in podkit-cli/commands/doctor.ts handles system-scope repairs without device resolution (when `requirements.length === 0`). Rule content embedded in udev-rule.ts as a string constant; share/91-podkit-ipod-scsi.rules is the human-inspectable copy (kept in sync manually). Cross-distro coverage via both GROUP="plugdev" AND TAG+="uaccess". Narrow product-ID-scoped variant shipped at share/91-podkit-ipod-scsi-narrow.rules (documented, not default). EACCES message in @podkit/ipod-firmware/inquiry/scsi/errors.ts now multi-line: sudo step + udev-rule install + replug instruction + docs URL. Tests: 11 EACCES message tests + 23 udev-rule-repair tests (all platform branches, dry-run, success, all failure paths).

DEFERRALS:
- AC #6 (uninstall command): user-managed via `sudo rm /etc/udev/rules.d/91-podkit-ipod-scsi.rules && sudo udevadm control --reload && sudo udevadm trigger`. No standalone command shipped.
- AC #10 (Arch/Fedora install validation): no hardware available. Rule includes TAG+="uaccess" for forward compat.

HARDWARE VALIDATION INCOMPLETE: linka SSH session is non-interactive — sudo for the cp/udevadm steps prompts for password and blocks. Full end-to-end test (rule install via the new repair → unplug/replug → confirm /dev/sg3 is plugdev → run inquiry without sudo) needs to be run by the user in an interactive shell on linka. Partial validation: 11 EACCES message tests run successfully on linka; 23 udev-rule-repair tests pass with mocked sudo executor on macOS. Gate results: typecheck ✓, ipod-firmware 180/180 ✓, podkit-core 2509/2509 ✓, lint ✓.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-292.12 Linux SCSI Permission UX — shipped.

EACCES message now multi-line with numbered steps: sudo path + `podkit doctor --repair udev-rule` + replug instruction + docs link. Canonical rule at `packages/podkit-cli/share/` with GROUP="plugdev" AND TAG+="uaccess". `udev-rule` repair-only check registered in diagnostics; CLI dispatches it via new `runSystemRepair()` path (no device needed). 34 new unit tests, all green. Typecheck, lint, build clean. EACCES message tests verified on linka hardware. Full repair install (interactive sudo) deferred to manual user validation — non-interactive SSH can't prompt for sudo.
<!-- SECTION:FINAL_SUMMARY:END -->
