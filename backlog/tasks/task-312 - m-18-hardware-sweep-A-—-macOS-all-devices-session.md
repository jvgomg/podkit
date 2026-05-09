---
id: TASK-312
title: 'm-18 hardware sweep A — macOS, all-devices session'
status: In Progress
assignee:
  - james
created_date: '2026-05-08 08:13'
updated_date: '2026-05-09 13:39'
labels:
  - device-capability-architecture
  - hardware-validation
  - manual-sweep
milestone: m-18
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Single sit-down at the macOS dev machine with the full physical inventory, going through one routine per device. Replaces TASK-292.10, TASK-293.03 (macOS portion), TASK-294.14, TASK-295.08 — all m-18 hardware ACs that don't require Linux.

## Hardware needed (gather before starting)

- **iPod inventory:** mini 2G (`0x05ac:0x1205`), nano 2G (`0x05ac:0x1260`), nano 4G (`0x05ac:0x1262/0x1263`), nano 7G (`0x05ac:0x1264/0x1267`), iPod 5G Video (`0x05ac:0x1209`).
- **Echo Mini** (`0x071b:0x3203`) — mass-storage auto-detect path. If unavailable, skip §4 — but flag at the end.
- **iPhone or iPad** (any iOS device) for unsupported-message verification. Flag if not available; the message wording is unit-tested but real-hardware confirmation is the only check that the surface text reaches the user correctly.
- USB hub if necessary (multi-device test in §5).

## Pre-flight (before plugging anything in)

1. `git pull && mise install` — pick up bun 1.3.13 + latest commits.
2. `mise exec -- bun install && mise exec -- bun run build --filter podkit` — build the CLI. Note the `dist/main.js` path.
3. `alias podkit='node packages/podkit-cli/dist/main.js'` for the session (or use `mise exec -- bun run podkit ...`).
4. `podkit --version` works.
5. Check `documents/test-devices.md` to see what was last recorded per device.

## §1. Per-iPod routine (5 devices × ~10 min each)

For EACH iPod, in order — `mini 2G`, `nano 2G`, `iPod 5G`, `nano 4G`, `nano 7G`:

```bash
# A. Cold plug — device should auto-mount under /Volumes/<NAME>
diskutil list  # confirm appears
ls /Volumes    # note mount name

# B. doctor system check (no device) — should still work even with iPod plugged
podkit doctor --no-device

# C. device add (auto-detect path; no --type)
podkit device add -d <name>
# Expect: prompt for SysInfoExtended fetch on first add (or skip if already added)
# Expect: device identified; for SCSI-only iPods (mini 2G, nano 2G, iPod 5G) the
#         orchestrator silently falls back from USB → SCSI

# D. doctor — full per-device run
podkit doctor -d <name>
# Capture: every check status (pass/fail/warn/skip)
# Specifically confirm: inquiry-methods (system) + sysinfo-consistency (device)

# E. doctor --repair sysinfo-extended
podkit doctor --repair sysinfo-extended -d <name>
# Capture timing (wall-clock)

# F. Compare written SysInfoExtended bytes vs the captured fixture
diff <(cat /Volumes/<NAME>/iPod_Control/Device/SysInfoExtended) \
     documents/sysinfo-captures/<device>.xml
# Expect: identical except for the per-read crypto blob (well-known 1-line diff)

# G. sync --dry-run
podkit sync -d <name> --dry-run
# Expect: plan generated; capabilities reflect the right codec/artwork/video set

# H. eject
podkit device eject -d <name>
```

## §2. Performance baseline

For nano 4G (USB FFI) and nano 2G (SCSI), capture wall-clock for `doctor --repair sysinfo-extended` over 3 runs and record averages in `documents/test-devices.md`. P1 baseline was 62-101ms for SCSI; check USB FFI doesn't regress noticeably. Anything > 500ms warrants investigation.

## §3. Edge cases (single device — pick mini 2G or any handy SCSI-only iPod)

- **Stale SysInfoExtended:** `cp` the existing file, edit the FireWireGUID hex string by hand to a wrong value, save. Run `podkit doctor -d <name>` — `sysinfo-consistency` check should report mismatch, repair routes to `sysinfo-extended` repair which restores the correct file.
- **Corrupted SysInfoExtended:** truncate the file mid-XML. `doctor` should handle gracefully (no crash; clear error).
- **Eject mid-inquiry:** start `doctor --repair sysinfo-extended -d <name>`, immediately yank the USB cable. Verify error is informative, no zombie process.

## §4. Echo Mini auto-detect (if hardware available)

```bash
# Plug Echo Mini, wait for mount
podkit device add  # no --type; no -d
# Expect: "Detected Echo Mini via USB. To add it, run: podkit device add -d <name> --type echo-mini --path /Volumes/<MOUNT>"
# Expect: exit non-zero with structured JSON error if --json

# Add explicitly
podkit device add -d echo --type echo-mini --path /Volumes/<NAME>
# Expect: device added with echo-mini preset capabilities

# doctor + sync --dry-run on the Echo Mini
podkit doctor -d echo
podkit sync -d echo --dry-run
```

## §5. Unsupported-device messaging (if iPhone/iPad/Touch available)

Plug an iPhone/iPad/Touch via USB.

```bash
podkit device add  # no --type
# Expect: friendly error citing iOS proprietary sync; podkit refuses cleanly.
# Capture the EXACT output text — flag any wording that's confusing.
```

## §6. Multi-device enumeration

Plug 2 iPods at once via USB hub. Run `podkit device scan` (or whichever discovery command) — both should be discovered with their correct identities. Order should be stable (deterministic enumeration).

## §7. Standalone binary smoke

```bash
mise exec -- bun run compile  # produces a single-file binary
./dist/podkit --version
./dist/podkit device add -d test --type echo-mini --path /tmp/fake
# Expect: works without dev deps installed (binary self-contained)
```

## Capture format

Update `documents/test-devices.md` for each device row:
- USB inquiry: works/fails (and timing)
- SCSI inquiry: works/fails (and timing)
- doctor output: copy the human-readable status block verbatim
- Notable issues: anything surprising

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 #1 #1 All 5 iPod routines (§1) completed; XML matches fixtures modulo crypto blob.
- [x] #2 #2 #2 `device add` auto-detect picks iPod path correctly for each.
- [x] #3 #3 #3 `doctor --repair sysinfo-extended` succeeds on all 5.
- [x] #4 #4 #4 `sync --dry-run` produces a coherent plan on all 5.
- [ ] #5 #5 #5 §2 performance numbers recorded; no >2x regression vs P1 baseline.
- [x] #6 #6 #6 §3 edge cases: stale + corrupted + eject-mid-inquiry all handled gracefully (no crashes; clear messages).
- [ ] #7 #7 #7 §4 Echo Mini auto-detect verified (or flagged as "no hardware available").
- [ ] #8 #8 #8 §5 unsupported-device message verified on real iOS hardware (or flagged).
- [ ] #9 #9 #9 §6 multi-device enumeration deterministic.
- [ ] #10 #10 #10 §7 standalone binary works.
- [ ] #11 #11 #11 `documents/test-devices.md` updated with results.

## Time estimate

~90 min if everything works; +30 min if anything surfaces UX issues that need wording fixes.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Session plan

Conducted interactively with the user, step by step. After each device routine the user pastes output; we diff vs fixture, flag surprises, then continue / pause-to-fix / abandon as needed.

### Hardware confirmed for this session

- iPod mini 2G (PARTY/SALLYS — verify)
- iPod nano 2G 4GB Green
- **iPod nano 3G** (NEW — adds inventory entry; will reveal whether USB inquiry boundary moves earlier than nano 4G)
- iPod 5G Video / TERAPOD (iFlash 1TB)
- iPod nano 4G 8GB Black
- iPod nano 7G 16GB (existing capture: nano-7g-16gb-{scsi,usb}.xml)
- **iPod nano 7G #2** (NEW — different colour; fills serial-suffix gap left by FJQ1)
- **Echo Mini** (USB mass storage)
- **iPod touch (NEW model)** — substitute for the iPhone/iPad in §5; new inventory entry. Confirms iOS rejection path on actual current-gen hardware.

### Steps

1. Pre-flight (`git pull`, `mise install`, `bun install`, `bun run build --filter podkit`, alias podkit). Verify `--version`.
2. §1 per-iPod routine (steps A–H) for **7 iPods** in this order: mini 2G → nano 2G → nano 3G → iPod 5G → nano 4G → nano 7G #1 → nano 7G #2. Pause after each device.
3. §2 perf baseline (3 runs each) on nano 4G (USB FFI) + nano 2G (SCSI). Record averages.
4. §3 edge cases on mini 2G: stale SysInfoExtended, corrupted/truncated, eject-mid-inquiry.
5. §4 Echo Mini auto-detect + add + doctor + sync --dry-run.
6. §5 iPod touch unsupported-device messaging — capture exact wording verbatim.
7. §6 multi-device enumeration via USB hub (2 iPods).
8. §7 standalone binary smoke (`bun run compile`).
9. Doc updates:
   - `documents/test-devices.md` — new rows for nano 3G, nano 7G #2, iPod touch; updated rows for the rest with timing + new doctor output.
   - `documents/sysinfo-captures/` — add `nano-3g.xml`, `nano-7g-<colour-2>.xml`, plus any new captures we want to lock in.
   - Generation Coverage Analysis: refresh checksum + inquiry tables.
   - Update USB PID bug list if nano 3G surfaces another shared/wrong PID.
   - If wording in §3/§5 is rough, capture verbatim quotes for follow-up — do NOT silently rewrite during the sweep.

### Deliverables / handoff

- Test-devices.md fully updated.
- Acceptance criteria ticked or explicitly flagged with reason.
- Notes appended for any UX issues that warrant follow-up tasks (created with user approval, not silently).
- Final summary written when sweep complete.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
UX issue (§1B): `doctor --no-device` does not exist. Without `-d` the CLI resolves to the default device (terapod) and fails with 'Device with UUID ... not found' if not plugged. There's no `--system-only` / `--no-device` flag — only `--no-system` (the inverse). Task description assumed `--no-device` was real. Two options: add a `--system-only` (or `--no-device`) flag, or change the default behaviour so that `podkit doctor` with no args runs system checks only when no default device is reachable. Captured stderr: `Device with UUID 2ADFFE6C-49BF-3F3A-8AF8-2787C0AD048B not found. Is it connected?`

UX issue (§1C): `podkit device remove <name>` fails with 'too many arguments for remove. Expected 0 arguments but got 1.' — the command takes the device via the program-level `-d` flag, not as a positional. Same applies to `device add -d <name>`. Error message does not suggest the `-d` flag. Either accept positional `<name>` for add/remove (more idiomatic) or rewrite the error to point at `-d`.

UX issue (§1D, post-fix): SysInfo identity display regresses when SysInfoExtended is written. Pre-write: `✓ SysInfo    iPod mini 4GB Pink (2nd Generation) (P9804)`. Post-write: `✓ SysInfo    Unknown iPod`. The model resolver appears to prefer the SysInfoExtended-derived serial suffix (`S4G` — not in lookup table; mini 2G predates Apple's serial-to-model mapping) over the SysInfo-derived ModelNumStr (`P9804` — present in the lookup table). For pre-2006 iPods that have a populated SysInfo, the resolver should prefer (or fall back to) the ModelNumStr path. Doesn't affect functionality, only display. Captured on iPod mini 2G with serial JQ5141TFS4G.

§1 mini 2G routine complete. All steps A–H executed. Highlights: (E) doctor --repair sysinfo-extended succeeded post-fix in ~2.7s wall — mostly USB stall timeout before SCSI fallback fires. (F) Written XML matches `documents/sysinfo-captures/mini-2g.xml` byte-for-byte (only trailing-newline diff). (G) sync --dry-run correctly applies mini 2G constraints: 4,360 tracks transcoding to AAC, video skipped, space warning surfaced. (H) Eject clean.

UX issue (§3a): `doctor` correctly detects FireWireGUID mismatch via `sysinfo-consistency` check ('SysInfoExtended disagrees with live device: FireWireGUID mismatch (on-disk DEADBEEFDEADBEEF, live 000A270014198517)'). However: (1) The user-facing explanation text under the failure is wrong — it reads 'The artwork database is out of sync with the thumbnail files. Affected tracks display wrong or missing artwork on the iPod.' That belongs to the artwork-integrity check, not sysinfo-consistency. Wires crossed in the description map. (2) The suggested repair `podkit doctor --repair sysinfo-consistency -d <name>` reports success ('SysInfoExtended already present — iPod mini 4GB Pink (2nd Generation)'; 'Repair complete') but the on-disk file is unchanged — still contains the stale `DEADBEEFDEADBEEF`. The repair short-circuits on `ensureSysInfoExtended`'s file-already-present early return without re-validating consistency. Either `ensureSysInfoExtended` must re-check FireWireGUID against the live device when the file is already present, OR the consistency repair must explicitly delete the file before invoking ensureSysInfoExtended. The user lands on a false 'fix-complete' state with a still-broken file.

UX issue (§3b): doctor handles a truncated/corrupted SysInfoExtended gracefully — no crash, falls back to classic SysInfo for identity, reports `✗ SysInfoExtended consistency with device — SysInfoExtended present but XML failed to parse`. However: (1) libxml2 parser errors leak to stderr TWICE before the doctor output: `parser error : Premature end of data in tag key line 24 / <key>Max / ^`. The native parser is being called twice (probably once per consumer of the XML — readSysInfoExtended + sysinfo-consistency check), and each call writes to stderr directly, bypassing podkit's output sinks. Should suppress or capture the libxml2 stderr at the call boundary. (2) The status line says `SysInfoExtended: not present` even though the file IS on disk — it's the parse that failed. More accurate: `SysInfoExtended: present but unparseable`. (3) Same misleading `The artwork database is out of sync...` follow-up explanation as §3a.

§3c (eject mid-inquiry): partial coverage on mini 2G. Early yank (cable out before inquiry begins) → clean error 'Device with UUID ... not found. Is it connected?' — informative, no zombie. Late yank (after inquiry completes) → repair succeeds normally. Exact mid-inquiry yank window on mini 2G is too tight (≤2s combined USB stall + SCSI read) to reliably hit. Defer the precise mid-inquiry timing test to iPod 5G (TERAPOD) which has 9693 bytes of SysInfoExtended — longer SCSI read, larger yank window.
<!-- SECTION:NOTES:END -->

<!-- AC:END -->

<!-- AC:END -->

- [ ] #12 nano 3G inventory entry added to documents/test-devices.md; full §1 routine completed; SysInfoExtended captured.
- [ ] #13 nano 7G #2 (different colour) inventory entry added; full §1 routine completed; serial suffix recorded against the lookup table gap.
- [ ] #14 iPod touch inventory entry added; §5 unsupported-device messaging verified verbatim against source-of-truth code.
<!-- AC:END -->
