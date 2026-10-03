---
id: TASK-535
title: >-
  Shipped-image docker-dist cell fails: `device add exited 0 but wrote no
  SysInfoExtended`
status: Done
assignee: []
created_date: '2026-10-03 18:54'
updated_date: '2026-10-03 20:04'
labels:
  - testing
  - docker
  - vm
milestone: m-20
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
modified_files:
  - test-packages/device-testing-daemon/scripts/build.ts
  - test-packages/device-testing-daemon/src/build-targets.ts
  - test-packages/device-testing-daemon/src/__tests__/build-targets.test.ts
  - test-packages/device-testing-daemon/package.json
  - test-packages/device-testing-daemon/README.md
  - test-packages/device-testing-daemon/tsconfig.json
  - turbo.json
priority: high
type: bug
ordinal: 305000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`bun run test:e2e:docker-dist --force` on the remote substrate (deviceRemote, x86_64) on 2026-10-03 failed this cell in 3 of 3 runs, including one on unmodified HEAD `8313d7c7`:

`VM: Docker dist image e2e (musl image + synthesized USB iPod) > SystemState: healthy > shipped image: device add → sync → read-back over USB passthrough`

```
error: device add exited 0 but wrote no SysInfoExtended
```

`device add --json` reports `"verification": "verified"`, `"saved": true`, and add stderr is empty. The persona daemon journal since the add has `-- No entries --`. The other 5 docker-dist tests pass.

TASK-530 and TASK-533 were closed recently on docker-dist passing on the remote substrate, so this is either a regression since then or a flake that hits this cell every time on this substrate. Find which first. Compare with DRAFT-023 (`device add --json` reports verified after the live USB inquiry failed). It may be the same defect seen from the test's side.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Established whether the cell passed at the commit that closed TASK-533, on the same substrate
- [x] #2 Root cause identified: the in-container inquiry not reaching the gadget, or SysInfoExtended written somewhere the test does not read
- [x] #3 docker-dist green on the remote substrate across repeated forced runs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root cause: a stale x64 persona daemon, shipped because the daemon build ignored PODKIT_TARGET_ARCH

Not a code regression and not a flake. The deciding variable is the build host.

**Chain, each link measured on deviceRemote (x86_64) from an arm64 Mac:**
- `device add` in the container STALLs on page 0 (`controlTransfer failed on page 0: LIBUSB_TRANSFER_STALL`). The host-side `podkit device add` in the VM fails identically, so the container is not implicated.
- `--json` hides that warning (`offerFirmwareInquiry` warns only when `out.isText`), which is why the test saw empty stderr and `verification: verified`. That is DRAFT-023's defect, triggered here.
- The persona daemon's journal has no SETUP event: the kernel stalls before userspace. ftrace: `composite_setup` → `ffs_func_req_match` returns false, `ffs_func_setup` never runs. A kprobe on `ffs_func_req_match` shows `cfg0=0 bRequestType=0xc0 req=0x40 val=2 idx=0`, so the only way to return false is `user_flags` lacking `FUNCTIONFS_ALL_CTRL_RECIP`.
- A kprobe on `ffs_ep0_write` (user-memory fetch) shows the installed daemon writes descriptor flags `0x3`. Source writes `0x43`; the flag was added in d68fccdc (2026-07-11).
- The local `dist/dummy-hcd-daemon-linux-x64` was dated 2026-06-08. `scripts/build.sh` with no target built for `bun -e process.arch` — arm64 on the Mac — and never refreshed the x64 file. turbo.json's comment claimed the script read `PODKIT_TARGET_ARCH`; it did not. `vm:install` then shipped the June binary, and the ELF arch guard passed because it really is x64.

**AC #1:** TASK-533's 5/5 green runs at 3ebcd1db were driven from an amd64 Linux host, where `auto` builds x64 fresh. Daemon source is unchanged since then, so the cell's outcome depends on the driving host, not the commit: green from amd64, red from an arm64 Mac at any commit since the x64 artifact went stale. Also explains "no ep0 errors in the journal" for TASK-533's unattributed Sep-30 page-0 variant (that run was from the Mac).

## Fix
`scripts/build.sh` → `scripts/build.ts`. With no target named it resolves via `@podkit/substrate`'s `resolveTargetArch` (PODKIT_TARGET_ARCH, then host), so the same aliases and precedence as every other artifact. Pure `resolveBuildTargets` is unit-tested.

## Validation (remote deviceRemote x86_64, driven from the arm64 Mac)
- Before the fix: HEAD failed the image cell (1/1), with the same symptom.
- After the fix: `bun run test:e2e:docker-dist --force` passed 3/3 runs, 18/18 tests, image cell included.
- `bun run test` passed (69/69 tasks). Daemon unit tests passed 65/65. Lint is clean.

## Not done here, worth a follow-up
- `vm-install.ts` ships whatever file sits at `dist/dummy-hcd-daemon-linux-<arch>`. It does no freshness check against `src/**`, and it skips a missing binary as best-effort. A build path that bypasses the turbo wrapper (and so `PODKIT_TARGET_ARCH`) can still leave a stale artifact to ship.
- DRAFT-023 (`--json` hides the inquiry-failure warning and still reports `verified`) is real. It is what made this look like a silent pass. It is now confirmed independently of its premise.

## Follow-ups landed
- **Stale daemon guard.** `scripts/build.ts` writes `<binary>.inputs.json`: the sha256 of every file Bun's `--metafile` says it bundled. Every install path refuses a daemon whose stamp is missing or corrupt, or whose inputs have changed since the build (`StaleArtifactError`). The paths are `vm-install.ts`, `harness.ts install`, `transfer-binary.ts` and `deviceHarness.prepare()`. `vm-install` now also treats a missing daemon as fatal. An explicit `PODKIT_DUMMY_HCD_DAEMON_BINARY` is trusted.
- **JSON-hidden failure (DRAFT-023, now TASK-538).** Closed.

Validation on deviceRemote: docker-dist 6/6. `test:vm` passed 39 + 194 on its re-run. The first run lost one cell to an scp exit 1 against the substrate, the link flakiness TASK-518 also recorded.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The docker-dist image cell failed because the remote substrate ran a June build of the persona daemon. That build wrote FunctionFS descriptor flags 0x3 and lacked `FUNCTIONFS_ALL_CTRL_RECIP`, which was added in July. The kernel's `ffs_func_req_match` therefore refused the iPod's DEVICE-recipient vendor read (bmRequestType 0xC0) and STALLed it before userspace saw it. `device add` continued without SysInfoExtended, and `--json` hid the warning (DRAFT-023).

The binary was stale because `scripts/build.sh` with no target built for the host (arm64 on the Mac) and ignored `PODKIT_TARGET_ARCH`, despite turbo.json's comment. The x64 artifact was never refreshed. TASK-533's green runs were driven from an amd64 host, where the host build happened to be correct. So the result depended on which host drove the run, not on the commit.

Fix: `scripts/build.ts`. It resolves the target through `@podkit/substrate`'s `resolveTargetArch`: `PODKIT_TARGET_ARCH` first, then the host. The pure `resolveBuildTargets` is unit-tested.

Diagnosed with ftrace and kprobes on `ffs_func_req_match` and `ffs_ep0_write` on the substrate.

Verified: docker-dist 3/3 forced runs green on the remote substrate, and the full test suite is green.
<!-- SECTION:FINAL_SUMMARY:END -->
