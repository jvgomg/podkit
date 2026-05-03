---
id: doc-031
title: 'Spec: Phase 0 — FFI SCSI inquiry spike'
type: other
created_date: '2026-05-03 11:17'
---
## Phase

P0 of doc-030 (PRD: Device Capability Architecture).

## Goal

Validate that a TypeScript foreign-function-interface (`koffi`) can drive macOS IOKit SCSITaskUserClient and Linux SG_IO ioctl end-to-end against a real iPod, producing the same SysInfoExtended XML that `dstaley/ipod-sysinfo` and libgpod produce. The outcome decides whether P1 commits to FFI or falls back to a compiled helper binary on macOS.

## Why this is a separate phase

The architecture commits to TypeScript-everywhere via FFI. macOS IOKit is the riskiest part of that bet — it uses a CFPlugIn / IUnknown vtable model that may not translate cleanly through FFI. Validating before package boilerplate avoids sunk cost if FFI proves unworkable.

Linux SG_IO is mechanically simple (one ioctl with a struct) and is included only to confirm both platforms can land in P1 from a single TypeScript implementation strategy.

## Scope

- A throwaway spike directory at the repo root (e.g. `tools/scsi-spike/`).
- A koffi-based TypeScript program that reads VPD page 0xC0 plus subpages from a connected iPod, on macOS and on Linux.
- A short findings document (markdown, in the spike directory) that the P1 implementer reads to know what FFI patterns work and which gotchas to avoid.

Not in scope:
- Any package boilerplate.
- Any podkit integration.
- Cleanup of the spike directory — it stays as reference material and is removed at the end of P1.

## Acceptance criteria

1. Spike script reads SysInfoExtended XML via SCSI inquiry on macOS, against a real iPod from the test inventory (preferably nano 2G — the device that fails USB inquiry, validating the SCSI-only path).
2. Spike script reads SysInfoExtended XML via SCSI inquiry on Linux, against the same physical device run through Lima or a real Linux machine.
3. Output byte-for-byte matches XML captured in `documents/sysinfo-captures/` for the same device (modulo the per-read cryptographic blob that varies between reads — same field as documented in the living document).
4. macOS run completes without sudo and without code-signing entitlements, on macOS 14 Sonoma or 15 Sequoia.
5. Linux run completes against `/dev/sgN` or `/dev/sdN` with udev rules equivalent to those podkit already documents (no new privilege requirements).
6. Findings document records: koffi API patterns used, IOKit interfaces queried (by name and GUID), any FFI gotchas, performance characteristics (round-trip time per VPD page), and a clear go/no-go for FFI on macOS.

## Investigation areas

The spike needs to answer these explicitly. Each is a likely failure mode if not validated:

- **IOKit master port acquisition** — does koffi cleanly call `IOMainPort` (or the deprecated `IOMasterPort`) and receive a usable `mach_port_t`?
- **Service iteration** — can koffi call `IOServiceGetMatchingService` with a CFDictionary built from `IOServiceMatching("com_apple_driver_iPodSBCNub")`? CFDictionary creation through FFI is the bit most likely to be ugly.
- **Plugin interface query** — `IOCreatePlugInInterfaceForService` returns an `IOCFPlugInInterface**`. Calling its `QueryInterface` to obtain `SCSITaskDeviceInterface` requires invoking through a function-pointer-table struct. Confirm koffi handles this.
- **Exclusive access** — `(*SCSITaskDeviceInterface)->ObtainExclusiveAccess` must succeed. Document whether iTunes or Finder grabs exclusive access first and how to deal with it.
- **SCSI task creation and execution** — `CreateSCSITask`, `SetCommandDescriptorBlock`, `SetTimeoutDuration`, `ExecuteTaskSync`. Verify the CDB byte sequence for INQUIRY VPD `(0x12, 0x01, page, 0, length, 0)`.
- **Response buffer handling** — koffi buffer allocation, sense data extraction, status code interpretation.
- **Linux SG_IO** — confirm the `sg_io_hdr_t` struct definition through koffi's struct typing. INQUIRY CDB is identical to macOS. Compare to libgpod's `tools/ipod-scsi.c`.
- **Cleanup paths** — Mach port teardown, IOKit interface release, ensuring no resource leaks if the spike runs in a loop.

## Method

Order:

1. Linux SG_IO first. It is the easier of the two and confirms koffi struct passing works.
2. macOS IOKit second, knowing Linux as a baseline.

Steps for each platform:

1. Write koffi binding for one VPD subpage read.
2. Read VPD page 0xC0 (the index) — this returns the list of available subpages.
3. Read each subpage by ID, concatenate the data fields.
4. Compare the assembled XML against a known-good capture from `documents/sysinfo-captures/`.
5. Time the operation. Real-device performance characteristics inform the orchestrator design.

The spike does not need to handle errors gracefully or expose a public API. It needs to prove the calls work.

## Deliverables

- Spike code in `tools/scsi-spike/`. Removed at the end of P1.
- `tools/scsi-spike/FINDINGS.md` — a focused 1–3 page document covering: working koffi call patterns, gotchas to avoid in P1, a recommendation (continue with FFI on both platforms / continue with FFI on Linux only / stop and use a helper binary on macOS), supporting evidence.
- A note added to the milestone task tracking the result.

## Decision rule

After the spike:

- **If macOS IOKit works cleanly through koffi:** P1 implements SCSI in TypeScript on both platforms. Default plan.
- **If macOS IOKit fails or the FFI code is unmaintainable:** P1 implements SCSI on Linux via koffi/SG_IO and on macOS via a small Swift helper binary that ships in the repo. The TypeScript surface in `@podkit/ipod-firmware` is the same; the implementation forks at the platform boundary.

The fallback adds build complexity but keeps the architecture intact.

## Risks

- **IOKit kext deprecation.** Apple has been migrating drivers from kexts to DriverKit. The `iPodDriver.kext` is still shipped but Apple may remove it in a future macOS. Outside this spike's scope, but flag in findings.
- **Code signing on macOS.** Some IOKit operations require entitlements when the binary is signed. Spike runs as a regular user from the dev environment; confirm packaged podkit binaries also work (Hardened Runtime considerations) — if not, capture as a P1 risk.
- **iPod busy with another process.** Finder, iTunes, music apps may hold exclusive access. Spike documents the failure mode and how to detect it.

## Time estimate

1–2 days. Linux pass: half a day. macOS pass: full day. Findings write-up: half a day.

## Hardware needed

Any iPod from the inventory works. Nano 2G is preferred because it exercises the SCSI-only path (USB inquiry fails). Nano 4G is a useful secondary because it exercises SCSI on a device where USB also works, allowing byte-comparison.

## Out of scope

- Inquiry method selection logic (P1).
- Plist parsing (P1).
- Doctor checks (P1).
- Anything that ships to users.
