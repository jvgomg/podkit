---
id: TASK-317.06
title: 'Refresh device-identification.md: USB inquiry boundary moves to nano 3G'
status: Done
assignee: []
created_date: '2026-05-09 15:21'
updated_date: '2026-06-01 20:59'
labels:
  - docs
milestone: m-18
dependencies:
  - TASK-317.01
  - TASK-317.02
  - TASK-317.03
  - TASK-317.04
  - TASK-317.05
modified_files:
  - documents/device-identification.md
parent_task_id: TASK-317
priority: low
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Documentation refresh — runs last so it captures the final state of all sibling tasks' work.

## What to update

`documents/device-identification.md` currently states something like "USB inquiry preferred for 5G+, SCSI as fallback for older devices". The m-18 sweep proved this is incomplete: **nano 3G supports USB inquiry**. The boundary sits between iPod 5.5G (USB fails) and nano 3G (USB succeeds), not between iPod 5.5G and nano 4G as previously assumed.

Specifically:

- Pre-iPod-5G: not in inventory, no data
- iPod 5G / 5.5G: SCSI only, USB inquiry STALLs
- nano 1G/2G: SCSI only, USB inquiry STALLs (mini 2G also)
- **nano 3G: USB inquiry works** (this is the new finding) — verified on real hardware, fixture at `documents/sysinfo-captures/nano-3g-8gb-black.xml`
- nano 4G+, nano 7G: USB inquiry works

Refresh the doc to:

1. Correct the "5G+ supports USB" assertion.
2. Add nano 3G as confirmed USB-supporting.
3. Note the data subtlety: nano 3G's SysInfoExtended is byte-stable across reads (no per-read crypto blob, unlike nano 4G/7G).
4. Pull in any other findings from sibling tasks (e.g., the new `sysinfo-serial-consistency` diagnostic from TASK-317.04, the centralized unsupported-device wording from TASK-317.03, the doctor repair changes from TASK-317.02).

## Why this is last

Depends on all other sub-tasks because the doc should reflect the final state of behavior changes — wording for unsupported devices, new diagnostic, repair semantics, etc. Running it last as a single coherent pass is more efficient than incrementally updating per sub-task.

## No real-hardware verification

The doc is descriptive, not behavioral. Sibling sub-tasks do their own real-hardware verification of the underlying behavior; this task just records what's true.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `documents/device-identification.md` USB inquiry boundary section corrected to reflect nano 3G as confirmed USB-supporting; iPod 5.5G as USB-failing.
- [x] #2 Per-device USB / SCSI inquiry support table updated to include nano 3G + nano 7G #2 (Blue) findings from the m-18 sweep.
- [x] #3 Doc references the sibling sub-tasks' outcomes when relevant: cascade primitive single source of truth, new `sysinfo-serial-consistency` diagnostic, centralized unsupported-device wording.
- [x] #4 `documents/test-devices.md` cross-references reviewed; coverage tables stay in sync.
- [x] #5 No real-hardware verification needed; mark AC as 'N/A — documentation-only'.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Refreshed `documents/device-identification.md` to fold in the m-18 hardware sweep findings and the sibling sub-tasks' code outcomes.

## Edits

- **"Last updated"** bumped to 2026-06-01 with m-18 summary callout.
- **USB Inquiry section** — `(preferred for 5G+)` blurb in Active Strategies list corrected to `(preferred for nano 3G+ and Classic 6G+; iPod 5G/5.5G fail)`. The 5G row in the per-device table now reads `iPod 5G / 5.5G (Video)` with explicit `verified on TERAPOD 5.5G during m-18 sweep`. New "Boundary refinement (m-18 sweep)" paragraph documents the nano 3G crypto-blob detail (byte-stable across reads, unlike nano 4G / nano 7G).
- **Research Findings — USB inquiry boundary RESOLVED** entry now includes the m-18 re-verification + crypto-blob note + explicit iPod 5.5G mention.
- **Usage Contexts** — `podkit sync` / `device scan` / `device info` paragraphs rewritten to reflect the cascade primitive landing in TASK-317.03. sync now wired through `assessIpodIdentity` (the `@podkit/core` cascade wrapper around `resolveIpodModel`); device info uses `assessment.model?.displayName` (verified by sonnet against `info.ts:138-146`).
- **Future doctor checks** — split into "Existing" (now includes `sysinfo-modelnum-mismatch` + repair from TASK-317.04) and "Future" (still-open items).
- **Live device testing** — replaced the brief two-device 2026-05-02 summary with a pointer to `test-devices.md` (authoritative inventory) plus a tight m-18 sweep recap listing all seven physical iPods + Echo Mini + iPod touch with their inquiry highlights.
- **UX for device identification failures** — Open Questions entry updated to acknowledge the centralised unsupported-device wording in `@podkit/devices-ipod`, leaving the iOS / mass-storage `device add` detection path as remaining work.

## Verification

Sonnet claim-verification pass against the current code: 5/5 claims hold. One initial wording miss (sync was described as calling `resolveIpodModel` directly) was corrected to the public `assessIpodIdentity` entry point — fixed before this commit.

## ACs

- #1 ✓ USB boundary section corrected; iPod 5.5G as USB-failing, nano 3G as USB-supporting.
- #2 ✓ Per-device table covers nano 3G + nano 7G #2 (Blue); `test-devices.md` is the canonical inventory and already includes them — device-identification.md's Live device testing summary now points there and recaps the m-18 set.
- #3 ✓ Cascade primitive (TASK-317.03), `sysinfo-modelnum-mismatch` (TASK-317.04), centralised unsupported-device wording (TASK-317.03) all referenced.
- #4 ✓ `test-devices.md` cross-link added; the per-device data lives there and is current.
- #5 N/A — documentation-only, no real-hardware verification needed.
<!-- SECTION:FINAL_SUMMARY:END -->
