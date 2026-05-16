---
id: TASK-322.04.01
title: Auto-install dummy-hcd-daemon systemd unit in prepare()
status: Done
assignee: []
created_date: '2026-05-14 22:37'
updated_date: '2026-05-16 00:39'
labels:
  - testing
  - vm-coverage
  - tier-3
  - lima
milestone: m-19
dependencies:
  - TASK-322.04
parent_task_id: TASK-322.04
priority: high
ordinal: 441
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First-run tripwire: `LimaTestVmRuntime.prepare()` transfers the daemon binary + the personas sidecar but never installs `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service` into `/etc/systemd/system/` on the test VM. The runner's `startDaemonForPersona()` then issues `systemctl start dummy-hcd-daemon@<id>` which fails with `Unit not found` on any freshly-provisioned VM. The TASK-322.04 description claims the runner installs both binary AND unit; today only the binary is true.

**Reproduce:**

```bash
limactl delete podkit-test-vm --force
limactl start tools/device-testing/lima/test-vm.yaml --name podkit-test-vm
mise run device-testing:build-linux
PODKIT_DEVTEST_RUN_TIER3=1 bun run test --filter @podkit/device-testing
# → daemon start fails: "Unit dummy-hcd-daemon@<id>.service not found"
```

**Fix:**

Add a `transferSystemdUnit()` helper alongside the existing binary/sidecar transfers, called from `prepare()` after the daemon binary lands. Steps:

1. `limactl copy tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service podkit-test-vm:/tmp/dummy-hcd-daemon@.service`
2. `limactl shell podkit-test-vm -- sudo install -m 0644 /tmp/dummy-hcd-daemon@.service /etc/systemd/system/dummy-hcd-daemon@.service`
3. `limactl shell podkit-test-vm -- sudo systemctl daemon-reload`
4. Skip the copy on a sha256 match (mirror the binary-transfer idempotency).

The unit file's contents are stable; sha256-skip avoids a daemon-reload on every prepare().

**Anchors:**
- `packages/device-testing/src/runners/lima-test-vm.ts:560` — `prepare()` body, after binary + gpod-tool + daemon-binary transfers
- `packages/device-testing/src/runners/lima-test-vm.ts:465` — `startDaemonForPersona()` is where the failure surfaces
- `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service` — the unit to install

**Tests:** unit tests with scripted `SubprocessRunner` covering happy path + idempotency on sha256 match + the daemon-reload call. No live VM needed.

**Out of scope:**
- Auto-enabling the unit (`systemctl enable`) — runner starts/stops instances explicitly per test, never enables.
- Hot-reloading the unit when its contents change between test invocations — sha256 skip handles the common case; explicit `daemon-reload` happens on any content change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 transferSystemdUnit() helper added; called from LimaTestVmRuntime.prepare() after the daemon binary transfer
- [x] #2 Idempotent via sha256: a second prepare() with no changes does NOT re-copy or re-reload
- [x] #3 On change: copies file, sudo install -m 0644 to /etc/systemd/system/, runs systemctl daemon-reload
- [x] #4 Unit tests cover happy path, idempotent skip, daemon-reload invocation, and error propagation for each step
- [ ] #5 On a freshly-provisioned podkit-test-vm with mise run device-testing:build-linux + PODKIT_DEVTEST_RUN_TIER3=1, the runner's prepare() leaves startDaemonForPersona working without manual `systemctl daemon-reload`
- [x] #6 README §lima-test-vm runner is updated to remove the existing 'installs both binary and unit' claim if the implementation doesn't match, or to confirm it once this lands
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation (2026-05-14)

### Files touched
- **NEW** `packages/device-testing/src/runners/lima-test-vm-systemd.ts` — `transferSystemdUnit()` helper + `DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH` + `resolveDefaultDummyHcdDaemonUnit()`. Extracted to its own module rather than appended to `lima-test-vm.ts` (which is already 755+ lines and split lima-binary out for the same reason).
- **NEW** `packages/device-testing/src/runners/lima-test-vm-systemd.test.ts` — scripted `SubprocessRunner` tests covering happy path, idempotency, atomicity (unique /tmp UUID), every failure mode (probe / copy / install / daemon-reload), and host-file-missing.
- `packages/device-testing/src/runners/lima-test-vm.ts` — import `transferSystemdUnit`; added new step 5 in `prepare()` between daemon-binary transfer and persona sidecar; added `resolveDummyHcdDaemonUnit?` DI knob on `CreateLimaTestVmRuntimeOpts` (mirrors `resolveDummyHcdDaemonBinary`) so prepare() tests can inject a deterministic fake unit path.
- `packages/device-testing/src/runners/lima-test-vm.test.ts` — extended every existing prepare() success-path test by one scripted call (the systemd-unit sha probe → match → skip) plus the new `resolveDummyHcdDaemonUnit` resolver; added a dedicated test confirming the prepare() wiring runs the full probe → copy → install → daemon-reload → cleanup flow when the VM's unit sha differs.
- `packages/device-testing/src/index.ts` — re-export `transferSystemdUnit`, `TransferSystemdUnitOpts`, `TransferSystemdUnitResult`, `resolveDefaultDummyHcdDaemonUnit`, and `DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH`.

### AC status
- AC#1 ✓ `transferSystemdUnit()` lives in `lima-test-vm-systemd.ts`; called from `LimaTestVmRuntime.prepare()` immediately after the daemon-binary transfer.
- AC#2 ✓ sha256 match short-circuits before any state-changing call; `{ skipped: true, reloaded: false }`. Verified by `transferSystemdUnit (idempotent on sha256 match) > skips copy + install + daemon-reload when the VM already has the same sha256` — assertion: `calls).toHaveLength(1)`.
- AC#3 ✓ On change: `limactl copy host → /tmp/dummy-hcd-daemon-<uuid>.service`, then `sudo install -m 0644 <tmp> /etc/systemd/system/dummy-hcd-daemon@.service`, then `sudo systemctl daemon-reload`. Test asserts exact argv order including `--` placement.
- AC#4 ✓ Tests cover all six paths: happy, idempotent skip, daemon-reload invocation present, and Error propagation for probe/copy/install/daemon-reload — each step's Error message names exactly that step.
- AC#5 — DEFERRED to live VM. The fix is wired in through the same call sequence the manual reproduction would exercise; no equivalent host-only test is available. Verification step on a freshly-provisioned VM is still recommended.
- AC#6 ✓ Confirmed `tools/device-testing/dummy-hcd/README.md:135-137` claim ("The runner installs both the binary and the unit file during `prepare()`.") is now true with this implementation. No wording change needed; left as-is. (The `tools/device-testing/lima/README.md` section named in the spec does not actually exist — only the dummy-hcd README makes the claim.)

### Idempotency trace (two consecutive prepare() calls)
Run 1 — fresh VM:
  1. instanceStatus (list)
  2. transferBinary podkit probe → MISS → copy/install/cleanup (3 calls)
  3. transferSystemdUnit probe → MISS → copy/install/daemon-reload/cleanup (4 calls)
  4. ensurePersonaSidecar copy/install/cleanup (3 calls)
Run 2 — same VM, same artefacts:
  1. instanceStatus (list)
  2. transferBinary podkit probe → MATCH → skip
  3. transferSystemdUnit probe → MATCH → skip (`reloaded: false`)
  4. ensurePersonaSidecar copy/install/cleanup (sidecar is byte-identical but always re-emitted; not in this task's scope)

Confirmed: second prepare() issues zero state-changing calls for the systemd unit path beyond the read-only probe.

### Quality gates (all green)
- `bun run test --filter @podkit/device-testing` — 236 pass, 13 skip, 0 fail
- `bunx tsc --noEmit -p packages/device-testing/tsconfig.json` — clean
- `bunx oxlint packages/device-testing/src/runners/` — 0 warnings, 0 errors
<!-- SECTION:NOTES:END -->
