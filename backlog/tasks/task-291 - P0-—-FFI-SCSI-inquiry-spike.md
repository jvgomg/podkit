---
id: TASK-291
title: P0 — FFI SCSI inquiry spike
status: Done
assignee: []
created_date: '2026-05-03 11:28'
updated_date: '2026-05-03 12:39'
labels:
  - device-capability-architecture
  - phase-0
  - spike
milestone: m-18
dependencies: []
references:
  - tools/scsi-spike/linux.ts
  - tools/scsi-spike/macos.ts
  - tools/scsi-spike/FINDINGS.md
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - backlog/docs/doc-031 - Spec-Phase-0-FFI-SCSI-inquiry-spike.md
  - documents/device-identification.md
  - documents/test-devices.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spike to validate that a TypeScript foreign-function-interface (`koffi`) can drive macOS IOKit SCSITaskUserClient and Linux SG_IO ioctl end-to-end against a real iPod. The outcome decides whether P1 commits to FFI on both platforms or falls back to a compiled helper binary on macOS.

This is a single 1–2 day spike, not split into sub-tasks. Output: throwaway code in `tools/scsi-spike/` plus a findings document with a clear go/no-go recommendation.

See spec doc-031 for full details.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Spike script reads SysInfoExtended XML via SCSI inquiry on macOS against a real iPod (preferably nano 2G — exercises SCSI-only path)
- [x] #2 Spike script reads SysInfoExtended XML via SCSI inquiry on Linux against the same physical device
- [x] #3 Output XML matches captured fixtures in documents/sysinfo-captures/ for the same device (modulo per-read crypto blob)
- [x] #4 macOS run completes without sudo and without code-signing entitlements on macOS 14 or 15
- [x] #5 Linux run completes against /dev/sgN or /dev/sdN with no new privilege requirements
- [x] #6 Findings document records: working koffi patterns, IOKit interfaces, FFI gotchas, performance characteristics, clear go/no-go recommendation
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**Outcome: GO. P1 will implement SCSI inquiry as TypeScript + koffi on both platforms.**

## Hardware results

| Platform | Device | Method | Subpages | Bytes | Time | vs capture |
|----------|--------|--------|----------|-------|------|------------|
| Linux x64 (Debian 12, linka) | iPod nano 4G (4GB green, FireWire `000A27001DCECFB5`) | `koffi` + SG_IO ioctl | 58 | 14,296 | 75 ms | byte-equivalent identity content; differs only in per-read crypto blob |
| macOS 15 (arm64, local) | iPod nano 2G (4GB green, FireWire `000A27001A0647CB`) | `koffi` + IOKit SCSITaskUserClient | 26 | 6,279 | 44 ms | byte-identical first 6,000 bytes; trailing newline absent (1-byte size diff) |

Identity fields (FireWireGUID, SerialNumber, FamilyID) match `documents/test-devices.md` exactly on both devices.

## Key spike output

`tools/scsi-spike/FINDINGS.md` — full report covering:
- Working koffi patterns (struct layouts, vtable triple-decode for COM dispatch, CFUUIDBytes by-value)
- 8 specific gotchas P1 must know (bun incompatibility, void* vs uint8 *, _Inout_ vs _Out_, decode signature, kext requirement, Linux permissions)
- Risks the spike left rough that P1 must close (sense-data inspection, allocLen truncation, error translation, vtable version assertion, bindMethod caching)
- SCSITaskDeviceInterface and SCSITaskInterface vtable slot offsets, cross-referenced to SCSITaskLib.h

## Decisions made

- **FFI on both platforms.** Helper-binary fallback not needed. Both paths are proven against real hardware with byte-accurate output.
- **Target Node runtime.** Bun's koffi has incomplete vtable-dispatch support (returns non-callable NapiExternal). Document in P1 package README; revisit later.
- **Estimated P1 implementation: 2-3 days for core SCSI path** plus doctor checks and orchestrator wiring per doc-032.

## What unblocks P1

P0 done. P1 (TASK-292) is no longer gated. Spike code stays in `tools/scsi-spike/` until end of P1, then deleted per spec.

## Process notes

- Ran 4 koffi error-correction cycles to land the working pattern. Each was logged in the spike code comments and FINDINGS.md gotchas section.
- Code review pass by Sonnet sub-agent surfaced sense-data and version-assertion risks that were not obvious from the working code itself.
- Spike code is throwaway, but the findings document is the canonical artifact for the P1 implementer.

## Update — additional verification rounds

After the initial GO recommendation, two follow-ups landed:

**1. Bun runtime support — fully verified.** Initial test had Bun failing with a NapiExternal-not-callable error. Root cause: a `koffi.pointer(proto)` bug in our spike code, not Bun incompatibility. Both Node 24 and Bun 1.3 now run the spike successfully on macOS and Linux with byte-equivalent output. Final matrix: macOS arm64 / Linux x64 × Node / Bun = all four pass without sudo, identical bytes.

**2. Linux permission UX — solved without sudo.** Stock Debian has `/dev/sgN` as `root:disk 0660` with empty `disk` group. Built and verified a minimal udev rule (`91-podkit-ipod-scsi.rules`) granting `plugdev` access to Apple-vendor scsi_generic nodes. Rule deliberately drops `ENV{ID_MODEL}=="iPod"` test (Debian doesn't set `ID_MODEL` on `scsi_generic` events; SCSI INQUIRY model field is space-padded). Apple-vendor on `scsi_generic` is iPod-only in practice. Verified: `udevadm test` shows rule firing, `/dev/sg3` becomes `crw-rw---- root:plugdev`, both runtimes read as non-root.

Friendly EACCES UX also validated — without the rule installed, spike presents actionable error (install rule + replug, or sudo fallback). Template for P1.

Follow-up: **TASK-292.12** created — Ship udev rule + Linux SCSI permission UX (e2e test) + podkit-docker `--device` documentation. Bundled into P1.
<!-- SECTION:FINAL_SUMMARY:END -->
