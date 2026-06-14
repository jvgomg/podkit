---
id: TASK-424
title: 'dummy-hcd-daemon: implement SCSI VPD page 0xC0 inquiry'
status: To Do
assignee: []
created_date: '2026-06-14 07:37'
updated_date: '2026-06-14 07:39'
labels:
  - testing
  - vm-coverage
  - tier-3
  - functionfs
  - scsi
  - follow-up
milestone: m-19
dependencies: []
references:
  - tools/device-testing/dummy-hcd/src/functionfs.ts
  - tools/device-testing/dummy-hcd/src/gadget.ts
  - tools/device-testing/dummy-hcd/src/protocol.ts
  - packages/podkit-core/src/diagnostics/checks/sysinfo-extended.ts
  - packages/ipod-firmware/src/inquiry/scsi/
  - test-packages/e2e-vm-tests/src/doctor-sysinfo-repair.e2e.test.ts
  - documents/architecture/testing/vm-testing.md
priority: medium
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`dummy-hcd-daemon` today serves SysInfoExtended through the **USB vendor control transfer** path (`bmRequestType=0xC0, bRequest=0x40, wValue=0x02`) that libgpod 0.8.3 uses on iPods with USB-mode firmware. It does NOT respond to the **SCSI VPD page 0xC0** inquiry path that the SCSI-fallback iPods (5G video, mini 2G, etc.) take. Every SCSI VPD request for page 0xC0 today returns `CHECK CONDITION` with `key=0x5 asc=0x24 ascq=0x00 (INVALID FIELD IN CDB)`.

This blocks Tier-3 end-to-end coverage of two doctor repair surfaces:

- `doctor --repair sysinfo-consistency` reads live SIE bytes from SCSI VPD 0xC0 (via `inquireViaOrchestrator` in `packages/podkit-core` → SCSI generic transport) to overwrite a stale on-disk copy.
- `doctor --repair sysinfo-extended` on a fresh DB-less iPod queries the same path to write a fresh SIE onto a clean FAT.

Both behaviours have authoritative unit coverage (`sysinfo-consistency-repair.test.ts`, `sysinfo-extended.test.ts`), so the production code paths are pinned. The gap is purely end-to-end VM coverage.

## What

Make `dummy-hcd-daemon` respond to SCSI VPD page 0xC0 inquiries on its mass-storage LUN with the persona's `sysInfoExtendedXml` payload, formatted per the iPod SCSI VPD page 0xC0 wire shape.

The wire shape (matches what libgpod inspects today, see `packages/podkit-core/src/diagnostics/checks/sysinfo-extended.ts` and `packages/ipod-firmware/src/inquiry/scsi/`):

- Standard 4-byte VPD header (`Peripheral Qualifier/Device Type`, `Page Code`, `Page Length MSB`, `Page Length LSB`)
- Page payload = the persona's SIE XML, possibly paged across multiple VPD requests if the payload exceeds a single SCSI transfer

The exact protocol shape should match what `inquireViaOrchestrator` expects to parse; coordinate with the existing client implementation rather than inventing a new wire format.

## Where

- `tools/device-testing/dummy-hcd/src/functionfs.ts` — SETUP-packet loop; today only handles USB vendor control transfers.
- `tools/device-testing/dummy-hcd/src/gadget.ts` — mass-storage gadget config.
- The dummy_hcd mass-storage gadget needs a SCSI interceptor — either via a custom mass-storage backend, or by intercepting INQUIRY commands at the gadget layer. Investigate which is cheaper.

## Out of scope

- VPD pages other than 0xC0. iPods do use a couple of others (0x80 serial, 0x83 device ID); SCSI-fallback identification only requires 0xC0.
- Multi-LUN personas. Today only LUN 0 needs to answer.

## Why this is the smallest unblock

A more ambitious path would be teaching the daemon to be a full SCSI target. Out of scope — the only failing call we need to satisfy is the SIE inquiry. Make that one call work and the two skipped Tier-3 tests light up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 dummy-hcd-daemon responds to SCSI INQUIRY for VPD page 0xC0 on its mass-storage LUN with the persona's sysInfoExtendedXml payload
- [ ] #2 Wire shape matches what `inquireViaOrchestrator()` in `packages/podkit-core` expects to parse (no client-side changes required)
- [ ] #3 In-VM verification: `sg_inq -p 0xc0 /dev/sg<N>` against a running daemon for `ipod-video-5g-iflash-1tb` returns the persona's SIE XML in the VPD payload (or a multi-request paged stream that concatenates to it)
- [ ] #4 Tests `Bug 1 (--repair sysinfo-consistency)` and `Bug 2 (--repair sysinfo-extended)` skipped blocks in `test-packages/e2e-vm-tests/src/doctor-sysinfo-repair.e2e.test.ts` are un-skipped and pass against the new daemon
- [ ] #5 Existing Tier-3 baseline remains GREEN (no regression on the USB vendor control transfer path)
<!-- AC:END -->
