---
id: TASK-289
title: 'PRD: offline device capability caching for pre-transcoding'
status: To Do
assignee: []
created_date: '2026-05-02 15:45'
updated_date: '2026-06-15 10:44'
labels: []
milestone: m-21
dependencies: []
documentation:
  - documents/device-identification.md#generation-tables-authority-vs-fallback
  - documents/device-identification.md#usage-contexts
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design how podkit could cache device capability information for offline use, enabling audio and video pre-transcoding when an iPod is not connected.

Investigate:
- What device capability data is needed to run a sync (or the transcoding portion of a sync)? Walk through the sync pipeline and identify every point where device capabilities are consulted — artwork dimensions, audio codec selection, video resolution/bitrate/profile constraints, checksum type.
- What is the minimum data that needs to be cached? Is generation ID sufficient (derive from tables), or do we need firmware-reported data (artwork formats, codec constraints)?
- Where and how should this be stored? Device config file, standalone cache, derived from previous SysInfoExtended captures?
- What's the UX? How does a user set up caching, trigger pre-transcoding, and handle the case where cached data turns out to be wrong when the device is finally connected?
- How does this interact with the device capability architecture from TASK-286?

Output: a PRD document proposing the architecture and UX for offline capability caching and pre-transcoding. This is a design document, not implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 PRD document created covering architecture and UX for offline caching
- [ ] #2 Every device capability touchpoint in the sync pipeline identified
- [ ] #3 Minimum required cached data defined
- [ ] #4 Storage mechanism proposed
- [ ] #5 UX for setup, triggering, and error handling proposed
- [ ] #6 Interaction with device capability architecture documented
<!-- AC:END -->
