---
id: TASK-132
title: Identify iPod models needed for hardware validation matrix
status: To Do
assignee: []
created_date: '2026-03-12 11:12'
labels:
  - phase-0
  - hardware-validation
  - planning
milestone: ipod-db Core (libgpod replacement)
dependencies: []
references:
  - docs/devices/supported-devices.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the complete hardware validation matrix and identify which additional iPod models are needed to validate all code paths in @podkit/ipod-db.

**Currently available:** iPod Video 5th gen (no hash, RGB565)

**Models needed for full validation:**

| Model | Why | Hash | Validates |
|-------|-----|------|-----------|
| iPod Classic (any gen) | hash58 algorithm | hash58 | Checksum correctness, firmware acceptance |
| iPod Nano 3rd or 4th gen | hash58 on Nano | hash58 | Hash58 on different device family |
| iPod Nano 5th gen | hash72 algorithm | hash72 | AES-CBC hash, HashInfo file handling |
| iPod Shuffle (any gen) | No artwork, different DB | None | Shuffle-specific database handling |
| iPod Mini (any gen) | Older device format | None | Minimal header format compatibility |

**Priority order:**
1. **iPod Classic** (any generation) — Most important gap. Validates hash58, sparse artwork, and the most popular target device
2. **iPod Nano 3rd/4th gen** — Validates hash58 on Nano family
3. **iPod Nano 5th gen** — Validates hash72
4. **Others** — Lower priority, can be community-tested

**Actions:**
- Document which models are available for testing
- Document which models still need validation
- Create individual hardware validation tasks for each acquired device
- Consider reaching out to iPod community for testing volunteers
- Track validation status in supported-devices.md

**Note:** hashAB devices (Touch 4, iPhone 4, iPad 1, Nano 6) require the proprietary libhashab binary. These can only be validated if the library is available. This is the same limitation libgpod has.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Complete hardware validation matrix documented
- [ ] #2 Priority order for acquiring test devices established
- [ ] #3 Available vs needed devices clearly listed
- [ ] #4 Individual validation tasks created for each available device
- [ ] #5 Validation status tracking added to supported-devices.md
<!-- AC:END -->
