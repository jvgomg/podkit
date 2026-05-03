---
id: TASK-292.03
title: P1.3 — SCSI transport (Linux SG_IO + macOS IOKit)
status: Done
assignee: []
created_date: '2026-05-03 11:29'
updated_date: '2026-05-03 13:27'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
  - backlog/docs/doc-031 - Spec-Phase-0-FFI-SCSI-inquiry-spike.md
parent_task_id: TASK-292
ordinal: 8030
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the SCSI transport in `@podkit/ipod-firmware` covering both Linux (SG_IO ioctl via koffi) and macOS (IOKit SCSITaskUserClient via koffi, or helper binary if P0 spike concluded that). One platform-dispatch entry point (`scsiReadVpdPages(bus, dev)`).

See spec doc-032, Scope > inquiry/scsi/. Implementation strategy comes from doc-031 spike findings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 scsiReadVpdPages(bus, dev) returns a byte array on Linux against a real iPod
- [x] #2 scsiReadVpdPages(bus, dev) returns a byte array on macOS against a real iPod
- [x] #3 Reads VPD page 0xC0 index, then iterates subpages, concatenates response data
- [x] #4 Linux: uses SG_IO ioctl on /dev/sgN or /dev/sdN
- [x] #5 macOS: uses IOKit SCSITaskUserClient (or helper binary path per P0)
- [x] #6 Unit tests with fake byte streams cover CDB construction, response assembly, short-read, sense data, timeout error paths
- [x] #7 No new privilege requirements vs existing podkit USB udev rules
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ported the P0 spike to `packages/ipod-firmware/src/inquiry/scsi/` with six files: `index.ts` (platform dispatch + shared VPD loop), `types.ts` (constants, `parseSenseData`, `buildVpdCdb`, `ScsiSyscall` injection seam), `errors.ts` (discriminated `ScsiError` + `errnoToKind`), `linux.ts` (SG_IO via koffi + sysfs `/dev/sgN` resolver from bus/devnum), `macos.ts` (IOKit via koffi). Added `koffi` ^2.13.0 to dependencies and `trustedDependencies`.

Risks closed (all 6 from FINDINGS.md):
1. Sense-data inspection — `makeSgIoSyscall` and `makeMacosSyscall` populate the sense buffer and return `kind: 'check-condition'`. The shared loop's `unwrapResult` parses sense via `parseSenseData` and throws `ScsiError({ kind: 'sense-check-condition', sense: { senseKey, asc, ascq, format } })`. Both fixed (0x70/0x71) and descriptor (0x72/0x73) formats supported.
2. Hardcoded `allocLen = 252` — `readOneVpdPageWithRetry` reads the 16-bit page-length field (offsets 2-3) and re-issues the read with `header + declared` if truncated; capped at `MAX_VPD_ALLOC_LEN = 65535`. Test verifies the re-read uses the correct allocation length.
3. Linux EACCES/EBUSY/ENOENT/EPERM/EIO translation — `errnoToKind` maps in `errors.ts`. The `open(2)` path uses Node's err.code; the `ioctl` path uses koffi `__errno_location()` then `errnoToKind`. EIO maps to `sense-check-condition` so the caller knows to inspect sense.
4. `bindMethod` re-binding — macOS now binds device-level methods (`CreateSCSITask`) once at session open; per-task methods (`SetCDB`, `SetSG`, `SetTimeout`, `ExecuteSync`, `Release`) are bound once per task (a CreateSCSITask returns a fresh interface each call so the per-task bind is unavoidable; what we eliminated was re-binding within a single task's lifecycle).
5. Vtable version assertion — `assertVtableVersion` reads the UInt16 at slot 4 (`TASK_DEV_VERSION_OFFSET = 4 * PTR`) and throws `ScsiError({ kind: 'vtable-version-mismatch', got, expected })`. Expected value is 1, observed during the spike. Unit-tested against a stub binding that returns version=99.
6. Per-read crypto blob — documented in TSDoc on `scsiReadVpdPages` ("Caveats: per-read crypto blob ... callers ... must not rely on byte-stability across calls").

Architectural note: the platform-shared transport loop (`readAllVpdSubpages`) is driven through an injectable `ScsiSyscall` function. Each platform module exports a session opener returning `{ syscall, close }`; tests inject a fake `ScsiSyscall` and a fake `LinuxBinding`/macOS binding to drive every code path without touching koffi or the kernel. This is the lever that makes all 6 risk-closure tests possible.

koffi quirks worth flagging:
- ESM `import koffi from 'koffi'` works under tsx but the import shape under bun is `koffi.default ?? koffi` — used dynamic import + nullish-or for both runtimes.
- `koffi` 2.16.1 (resolved from `^2.13.0`) used; same as spike.
- `verbatimModuleSyntax: true` blocks `require('koffi')`; switched both platform modules to async dynamic import inside the lazy loader. The session opener and dispatcher became `async`/`Promise<...>` as a result.

Hardware validation (both passed):
- macOS (nano 2G, fingerprint 05ac/1260): 6,279 bytes vs fixture nano-2g-4gb-green.xml 6,280 bytes (delta -1, the trailing newline noted in FINDINGS.md). FireWireGUID=000A27001A0647CB, SerialNumber=YM7275YSVQH, FamilyID=9 — all match `documents/test-devices.md` inventory. ~62 ms per call.
- Linux (linka, nano 4G via /dev/sg3, fingerprint 05ac/1263 bus=1 devnum=13): **14,296 bytes vs fixture nano-4g-8gb-black.xml 14,296 bytes (delta 0, exact match)**. FireWireGUID=000A27001DCECFB5, SerialNumber=5U851AEH3R0, FamilyID=15. ~97 ms per call. Sysfs resolver correctly mapped (bus=1, devnum=13) → /dev/sg3.

Tests: 85 pass, 0 fail. ACs covered:
- #1 Linux real-iPod read — validated against linka nano 4G.
- #2 macOS real-iPod read — validated against locally connected nano 2G.
- #3 0xC0 index → subpage iteration → concat — `readAllVpdSubpages` test.
- #4 Linux SG_IO — `makeSgIoSyscall` test exercises the ioctl path; hardware uses `/dev/sg3`.
- #5 macOS IOKit SCSITaskUserClient — `makeMacosSyscall` + `assertVtableVersion` tests; hardware uses real IOKit.
- #6 Unit tests for CDB construction (`buildVpdCdb`), response assembly (loop tests), short-read re-read, sense, timeout, errno paths.
- #7 No new privileges — Linux relies on the existing podkit udev rule (already validated by the spike); macOS uses iPodSBC kext that ships with macOS.

Did NOT touch: `tools/scsi-spike/` (stays until 292.11), `packages/ipod-firmware/src/index.ts` (team lead reconciliation after A2 finishes), any other package.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
SCSI VPD inquiry transport ported from spike. Linux (SG_IO via koffi) and macOS (IOKit SCSITaskUserClient via koffi) implementations behind a single platform-dispatching `scsiReadVpdPages(fp, opts)` entry point. All 6 risks from FINDINGS.md closed: sense-data parsing, page-length-driven short-read re-read, errno→ScsiErrorKind translation, per-task method binding cache, vtable version assertion, per-read crypto blob documented in TSDoc. Hardware validated against nano 2G on macOS (6,279 bytes — matches fixture modulo the trailing newline known from spike) and nano 4G on Linux (14,296 bytes — exact byte match). 85 tests pass; typecheck, lint, and build all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
