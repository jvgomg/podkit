---
id: TASK-247.12
title: HITL testing session for device readiness
status: To Do
assignee: []
created_date: '2026-03-26 01:56'
labels:
  - testing
  - device
dependencies:
  - TASK-247.01
  - TASK-247.02
  - TASK-247.03
  - TASK-247.04
  - TASK-247.05
  - TASK-247.06
  - TASK-247.07
  - TASK-247.08
  - TASK-247.09
  - TASK-247.10
  - TASK-247.11
parent_task_id: TASK-247
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hands-on testing session with real hardware to stress-test all device readiness features before shipping to users.

**PRD:** doc-023 | **Parent:** TASK-247

**Test scenarios with real hardware (TERAPOD + any other available devices):**

1. **Happy path:** Healthy, mounted iPod — verify all 6 stages pass, summary shows track count + free space
2. **Missing database:** Delete iTunesDB, run scan — verify `needs-init` level and guidance
3. **Missing SysInfo:** Delete SysInfo file, run scan — verify `needs-repair` level and guidance
4. **Corrupt SysInfo:** Write garbage to SysInfo, run scan — verify corrupt detection
5. **Unmounted device:** Eject device (keep connected), run scan — verify mount stage behavior
6. **Interactive mount prompt:** Eject, run scan on TTY — verify prompt appears and mount + continue works
7. **--mount flag:** Eject, run scan --mount — verify automatic mount and continued checks
8. **Device disconnect during scan:** Physically disconnect cable during scan — verify graceful failure
9. **Permission errors:** Test on Linux without sudo — verify interpreted error messages
10. **Multiple devices:** If available, connect two iPods — verify independent readiness per device
11. **--report flag:** Run scan --report — verify output is useful for GitHub issue pasting
12. **Doctor integration:** Run doctor on healthy device, then on device with missing DB
13. **Device info:** Run device info — verify readiness summary appears
14. **Device init:** Run init on already-initialized device — verify "already initialized" message
15. **JSON output:** Run scan --format json — verify structured readiness data

**Also verify:**
- No regressions in existing sync workflow
- Performance: scan on healthy device completes in under 2s
- Error messages are clear and actionable for a non-technical user
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 15 test scenarios executed with real hardware
- [ ] #2 No crashes or unhandled errors in any scenario
- [ ] #3 Error messages verified as clear and actionable
- [ ] #4 Performance verified: healthy scan under 2s
- [ ] #5 No regressions in existing sync workflow
- [ ] #6 Any issues found during testing are fixed
<!-- AC:END -->
