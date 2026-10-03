---
id: TASK-535
title: >-
  Shipped-image docker-dist cell fails: `device add exited 0 but wrote no
  SysInfoExtended`
status: To Do
assignee: []
created_date: '2026-10-03 18:54'
labels:
  - testing
  - docker
  - vm
milestone: m-20
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
priority: high
type: bug
ordinal: 305000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`bun run test:e2e:docker-dist --force` on the remote substrate (deviceRemote, x86_64) on 2026-10-03 failed this cell in 3 of 3 runs, including one on unmodified HEAD `8313d7c7`:

`VM: Docker dist image e2e (musl image + synthesized USB iPod) > SystemState: healthy > shipped image: device add → sync → read-back over USB passthrough`

```
error: device add exited 0 but wrote no SysInfoExtended
```

`device add --json` reports `"verification": "verified"`, `"saved": true`, and add stderr is empty. The persona daemon journal since the add has `-- No entries --`. The other 5 docker-dist tests pass.

TASK-530 and TASK-533 were closed recently on docker-dist passing on the remote substrate, so this is either a regression since then or a flake that hits this cell every time on this substrate. Find which first. Compare with DRAFT-023 (`device add --json` reports verified after the live USB inquiry failed). It may be the same defect seen from the test's side.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Established whether the cell passed at the commit that closed TASK-533, on the same substrate
- [ ] #2 Root cause identified: the in-container inquiry not reaching the gadget, or SysInfoExtended written somewhere the test does not read
- [ ] #3 docker-dist green on the remote substrate across repeated forced runs
<!-- AC:END -->
