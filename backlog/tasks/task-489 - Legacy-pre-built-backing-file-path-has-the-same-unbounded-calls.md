---
id: TASK-489
title: Legacy pre-built backing-file path has the same unbounded calls
status: To Do
assignee: []
created_date: '2026-08-28 20:36'
labels:
  - testing
  - vm
  - tech-debt
dependencies: []
references:
  - test-packages/device-testing/src/runners/lima-test-vm.ts
  - test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts
priority: low
ordinal: 268000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`stageBackingFile` and `resetBackingFile` in `test-packages/device-testing/src/runners/lima-test-vm.ts` (~lines 225-290) carry the identical defect that was fixed elsewhere in the harness: an unbounded `sha256sum` probe and an unbounded `limactl copy`. A wedged SSH session in either blocks indefinitely with no output and nothing naming what was being waited for — the shape that produced a 20-minute hook wait in the sibling module before it was bounded.

**Why it was deliberately left.** These serve the legacy *pre-built* `imagePath` case, which **no current persona uses** — every persona today is synthesised from a recipe. Only scripted unit tests reach this code. Fixing it is mechanical and the instrument is settled (route through `runLimactl`, derive the bound from image size at a throughput floor, exactly as `lima-test-vm-backing-files.ts` now does), but the fix would be unexercised by the VM suite, so it was judged a separate task rather than an untested drive-by change.

**Worth deciding first: is this code still wanted at all?** If no persona uses the pre-built path and none is planned, deleting it is better than bounding it — dead code that looks live is its own hazard, and it would remove the third copy of this pattern rather than adding a third set of constants to maintain. Check whether any persona definition, fixture or doc still references `imagePath` before choosing.

If it stays, the bound should reuse the same derivation as the synthesis path rather than inventing a new one, and `limactl copy` should reuse the substrate's `FILE_COPY_TIMEOUT_MS`.

Low priority: unreachable from the VM suite as it stands, so it cannot cause a real hang today.
<!-- SECTION:DESCRIPTION:END -->
