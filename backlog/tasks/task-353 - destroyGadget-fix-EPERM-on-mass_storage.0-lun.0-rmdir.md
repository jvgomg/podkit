---
id: TASK-353
title: 'destroyGadget: fix EPERM on mass_storage.0/lun.0 rmdir'
status: Done
assignee: []
created_date: '2026-05-24 09:22'
updated_date: '2026-05-24 09:36'
labels:
  - vm-testing
  - tier-3
  - dummy-hcd
  - bug
  - follow-up
milestone: m-19
dependencies: []
priority: low
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Symptom:** `destroyGadget` in `tools/device-testing/dummy-hcd/src/gadget.ts` occasionally fails with EPERM when rmdir'ing `functions/mass_storage.0/lun.0`. The wrapping `tryRmdir` swallows the error so the daemon exits cleanly, but the configfs tree is left behind, holding a UDC reservation and starving subsequent dummy-hcd-daemon@.service starts.

**Workaround currently shipped:** `packages/device-testing/src/tier3/dual-daemon-lifecycle.tier3.test.ts` calls a defensive `sweepOrphanGadgets()` helper in `beforeAll` that scrubs every `/sys/kernel/config/usb_gadget/podkit-*` tree before the test runs. This papers over the bug for the Tier-3 harness but the production daemon path still leaks.

**Hypothesis:** lun.0 rmdir requires writing an empty string to its `file` attribute first (similar to how UDC must be unbound before configs/c.1 children can be rm'd). Investigate `kernel.org/doc/html/latest/usb/gadget_configfs.html` for the exact teardown ordering required for `usb_f_mass_storage`.

**Why this matters:** without a fix, every Tier-3 dual-daemon iteration has to either pay the sweep cost or risk UDC exhaustion. Future tests that exercise destroyGadget directly (not via the sweep helper) will hit the same leak.

## Scope
1. Reproduce the EPERM in isolation (run mass-storage gadget create → destroy in a loop)
2. Identify the teardown step the current `destroyGadget` is missing
3. Patch `destroyGadget` (or `unbindGadget`) to perform that step
4. Remove `sweepOrphanGadgets` from `dual-daemon-lifecycle.tier3.test.ts` and verify the test still passes without it
5. Tier-3 baseline GREEN

## References
- `tools/device-testing/dummy-hcd/src/gadget.ts` — `destroyGadget`, `tryRmdir`
- `packages/device-testing/src/tier3/dual-daemon-lifecycle.tier3.test.ts` — `sweepOrphanGadgets` helper + the "known dummy_hcd quirk" comment
- https://www.kernel.org/doc/html/latest/usb/gadget_configfs.html
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 EPERM reproducer documented (script or test)
- [x] #2 #2 destroyGadget patched so the configfs tree fully tears down without leaking lun.0
- [x] #3 #3 sweepOrphanGadgets helper removed from dual-daemon-lifecycle.tier3.test.ts and test still passes
- [x] #4 #4 Tier-3 baseline remains GREEN
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Root cause:** `usb_f_mass_storage` pins the implicit `lun.0` directory to its parent function. Direct `rmdir functions/mass_storage.0/lun.0` returns EPERM unconditionally. The kernel removes lun.0 as part of the parent's own teardown when `rmdir functions/mass_storage.0` runs.

**Reproducer** (executed in-VM, ad-hoc — not committed since the fix is verified end-to-end by the existing dual-daemon test):
```
G=/sys/kernel/config/usb_gadget/test
# ... create gadget with mass_storage.0/lun.0/file=/tmp/img ...
rmdir $G/functions/mass_storage.0/lun.0
# → rmdir: failed: Operation not permitted
rmdir $G/functions/mass_storage.0
# → exit 0 (and lun.0 is gone)
```

**Fix:** `tools/device-testing/dummy-hcd/src/gadget.ts` `destroyGadget` —
1. Removed `${gadgetPath}/functions/mass_storage.0/lun.0` from the rmdir list.
2. Added a pre-rmdir step to write empty string to `lun.0/file` (releases the backing-file open count). Guarded by `existsSync` so FFS-only personas don't log a spurious warning.
3. Docstring updated with the EPERM rationale so the omission doesn't look like a bug to a future reader.

**Sweep workaround removed:** `packages/device-testing/src/tier3/dual-daemon-lifecycle.tier3.test.ts` no longer needs the `sweepOrphanGadgets` helper or its call in `beforeAll`. Deleted both.

**Verification:**
- Dual-daemon test passes 3x back-to-back with `/sys/kernel/config/usb_gadget/` empty after each run and no UDC claims surviving.
- Tier-3 baseline (personas-baseline + mass-storage-binding + backing-file-content + dual-daemon): 14 pass / 0 fail / ~60s.
- Unit tests: 425 / 0 fail.

Files:
- tools/device-testing/dummy-hcd/src/gadget.ts
- packages/device-testing/src/tier3/dual-daemon-lifecycle.tier3.test.ts
- tools/device-testing/dummy-hcd/dist/dummy-hcd-daemon-linux-arm64 (rebuilt)
<!-- SECTION:NOTES:END -->
