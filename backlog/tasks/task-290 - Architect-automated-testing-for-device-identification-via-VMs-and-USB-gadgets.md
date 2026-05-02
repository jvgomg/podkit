---
id: TASK-290
title: Architect automated testing for device identification via VMs and USB gadgets
status: To Do
assignee: []
created_date: '2026-05-02 15:45'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-identification.md
  - documents/test-devices.md
  - tools/lima/virtual-ipod.yaml
  - packages/virtual-ipod-server/src/gadget.ts
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design how to automate testing of device identification codepaths using VMs and mocked USB gadgets, reducing dependence on physical iPod hardware for testing.

Consider:
- Can the existing virtual iPod system (Lima VM + USB gadget via configfs/dummy_hcd) be extended to respond to SCSI inquiry and USB vendor transfers with known SysInfoExtended XML?
- What would a test matrix look like? Device generations x inquiry methods x platforms x identification fidelity levels.
- How to simulate different iPod generations — can we configure the USB gadget with different product IDs, serial numbers, and inquiry responses?
- How to simulate failure modes — device that doesn't respond to USB inquiry, empty SysInfo, corrupted SysInfoExtended.
- Integration with CI — can these tests run in GitHub Actions or similar?
- Interaction with the SysInfoExtended XML captures from real devices (documents/sysinfo-captures/) — can these serve as test fixture data for the mocked responses?

This is a collaborative design task. Output: architecture document proposing the automated testing approach, with enough detail to create implementation tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Architecture document created for automated device identification testing
- [ ] #2 Virtual iPod USB gadget extension approach documented
- [ ] #3 Test matrix defined (generations x methods x platforms x fidelity)
- [ ] #4 Failure mode simulation approach documented
- [ ] #5 CI integration feasibility assessed
- [ ] #6 Use of real device SysInfoExtended captures as test fixtures considered
<!-- AC:END -->
