---
id: TASK-479.11
title: >-
  Repair copy stops framing the SysInfoExtended write as a prerequisite for
  display
status: To Do
assignee: []
created_date: '2026-08-23 13:20'
updated_date: '2026-08-23 13:45'
labels:
  - identity
  - ux
  - copy
milestone: m-18
dependencies:
  - TASK-479.13
parent_task_id: TASK-479
priority: medium
ordinal: 252000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Several user-facing strings tell the user to run `podkit doctor --repair sysinfo-extended` **in order to see** their device's identity. Once TASK-479.13 lands, identity is read live from firmware and that framing is false — the write is no longer a prerequisite for display.

Worse, the framing was always slightly dishonest: it asks the user to let podkit write a file to their device in exchange for a nicer name on screen.

## The honest framing

The write makes the device **self-describing for libgpod and other tools**. That matters for sync and for database initialisation, because libgpod resolves identity only from files on disk. It does not matter for podkit's own display.

## This sweep must not over-correct

`SYSINFO_SUGGESTION_REPAIR` (`packages/podkit-core/src/device/readiness/stages/sysinfo.ts:21-22`) is attached to **eleven** stage failures — `:189, 210, 227, 244, 264, 283, 307, 352, 379` among them. Several of those are genuinely about the write, not display: hash58/hash72/hashAB devices need SysInfoExtended **on disk** for the database checksum (`ipod-identity.ts:134-135`, `sysinfo.ts:329-356`). Its current wording ("to read device identity from USB") is already honest for those cases.

So the job is to **split** two claims that are currently one string:

- "you need this on disk for libgpod / for the checksum" — keep, it is true
- "you need this to see what your device is" — delete, it is no longer true

A blanket reword deletes correct advice.

## Known sites

- `packages/podkit-core/src/device/unknown-ipod-model.ts:44` — "Run `podkit doctor --repair sysinfo-extended` to write the identity …"
- `packages/podkit-core/src/device/readiness/stages/sysinfo.ts:21-22` — `SYSINFO_SUGGESTION_REPAIR`, per the split above
- `packages/podkit-core/src/diagnostics/checks/sysinfo-consistency.ts:84` — "SysInfoExtended not present on device (run --repair sysinfo-extended to create it)"
- `packages/podkit-cli/src/commands/device/shared.ts` — `assertInitIdentitySufficient`'s shuffle refusal

Not exhaustive — sweep `sysinfo-extended` across user-facing strings including the docs site and pinned VM expectations.

## Stale `--format json` docs to fold in

Four doc strings claim a `--format json` that these commands do not have (they take the global `--json`):

- `docs/reference/cli-commands.md:240`
- `docs/getting-started/docker-daemon.md:141`
- `docs/troubleshooting/common-issues.md:318`
- `docs/user-guide/devices/adding-devices.md:208`

Unrelated to the identity work but found during the same review, and cheap to fix while sweeping docs.

## Note on the shuffle refusal

`assertInitIdentitySufficient` refuses to initialise an iPod shuffle whose model number is unknown, because the database layer would otherwise pick the wrong `iTunesSD` format and the device would silently play nothing. That refusal stays — it fires *after* the cascade, so it only triggers when live inquiry also failed, which is still correct. Only its **copy** changes: it currently implies the repair-write is the only route to a model number.

## Scope

Copy and docs. No behaviour change — but the diff does include updates to tests and VM expectations that pin the changed strings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No user-facing string presents `--repair sysinfo-extended` as a route to seeing device identity
- [ ] #2 Reworded copy states what the write is actually for: making the device self-describing to libgpod and other tools
- [ ] #3 `SYSINFO_SUGGESTION_REPAIR`'s eleven attachment sites are split — checksum/libgpod cases keep their (true) advice, display-motivated cases lose it
- [ ] #4 `assertInitIdentitySufficient`'s shuffle refusal still fires, with copy that no longer implies the repair-write is the only route to a model number
- [ ] #5 The sweep covers core, CLI, diagnostics checks, the docs site, and pinned VM test expectations
- [ ] #6 The four stale `--format json` doc references are corrected to the global `--json`
- [ ] #7 No behaviour change — the diff is strings, docs, and the test and VM expectations that pin them
<!-- AC:END -->
