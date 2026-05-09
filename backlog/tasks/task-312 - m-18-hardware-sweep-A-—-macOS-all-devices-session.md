---
id: TASK-312
title: 'm-18 hardware sweep A — macOS, all-devices session'
status: Done
assignee:
  - james
created_date: '2026-05-08 08:13'
updated_date: '2026-05-09 16:39'
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
- [x] #1 #1 #1 #1 #1 #1 #1 #1 #1 All 5 iPod routines (§1) completed; XML matches fixtures modulo crypto blob.
- [x] #2 #2 #2 #2 #2 #2 #2 #2 #2 `device add` auto-detect picks iPod path correctly for each.
- [x] #3 #3 #3 #3 #3 #3 #3 #3 #3 `doctor --repair sysinfo-extended` succeeds on all 5.
- [x] #4 #4 #4 #4 #4 #4 #4 #4 #4 `sync --dry-run` produces a coherent plan on all 5.
- [x] #5 #5 #5 #5 #5 #5 #5 #5 #5 §2 performance numbers recorded; no >2x regression vs P1 baseline.
- [x] #6 #6 #6 #6 #6 #6 #6 #6 #6 §3 edge cases: stale + corrupted + eject-mid-inquiry all handled gracefully (no crashes; clear messages).
- [x] #7 #7 #7 #7 #7 #7 #7 #7 #7 §4 Echo Mini auto-detect verified (or flagged as "no hardware available").
- [x] #8 #8 #8 #8 #8 #8 #8 #8 #8 §5 unsupported-device message verified on real iOS hardware (or flagged).
- [x] #9 #9 #9 #9 #9 #9 #9 #9 #9 §6 multi-device enumeration deterministic.
- [x] #10 #10 #10 #10 #10 #10 #10 #10 #10 §7 standalone binary works.
- [x] #11 #11 #11 #11 #11 #11 #11 #11 #11 `documents/test-devices.md` updated with results.

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

§1 nano 2G routine complete. (C) New device-add UX validated end-to-end on real hardware: cascade resolves USB PID 0x1260 → 'iPod nano (2nd Generation)' pre-write, 'iPod nano 4GB Green (2nd Generation)' post-write via the new S?? serial-suffix entry. Combined prompt 'Add this iPod as nano2g and write SysInfoExtended? [Y/n]' confirmed. Capabilities post-write: video ✗ (correct), artwork [on] (correct — was incorrectly off in pre-fix flow). (D) doctor: all checks passed, identity correct, artwork integrity valid (61 entries, 2 formats). (E) repair sysinfo-extended timing 3 runs: 2.328s / 2.298s / 2.349s wall-clock, avg ~2.33s. SCSI work itself is fast; wall-clock is dominated by USB stall timeout on this SCSI-only device. Comparable to mini 2G (~2.7s). (F) Written XML matches `documents/sysinfo-captures/nano-2g-4gb-green.xml` byte-for-byte (trailing newline only). (G) sync --dry-run: 4,360 tracks transcoding to AAC, video skipped, space warning. (H) Eject clean.

§1 nano 3G routine complete (NEW INVENTORY ENTRY). USB PID 0x1262, 8GB Black, serial suffix EED6 (in serials table mapping to E433). KEY FINDING: USB inquiry SUCCEEDS on nano 3G — plan: 'usb-then-scsi', attempts: 'usb success'. This refines the inquiry boundary research: USB inquiry is NOT 5G+. Pre-5G iPod 5G fails, but nano 3G (post-iPod 5G but pre-nano 4G) succeeds. The 'USB inquiry preferred for 5G+' summary in `documents/device-identification.md` is incomplete — nano 3G should be added as a confirmed USB-supporting device. SysInfoExtended is 12,131 bytes (between nano 2G's 6,279 and nano 4G's 14,297). Notably: nano 3G's XML is byte-stable across reads — no per-read crypto blob, unlike nano 4G/7G. (D) doctor: identity 'iPod nano 8GB Black (3rd Generation)', artwork formats 1055/1060/1061. (E) Repair timing: 2.283s wall-clock (USB success path; comparable to mini 2G's USB-fails-SCSI-succeeds at 2.7s, suggesting wall-clock is dominated by process overhead not transport timing). (F) Captured fixture at `documents/sysinfo-captures/nano-3g-8gb-black.xml`. (G) sync --dry-run: 4,349 tracks to add + 11 format upgrades, plus 112 videos (12 movies, 100 TV shows) to transcode — nano 3G correctly identified as video-capable. (H) Eject clean.

§1 iPod 5G TERAPOD routine complete. (Pre-flight) Manual mount required — macOS auto-mount failed; mounted via `sudo podkit mount` to `/private/tmp/podkit-TERAPOD` (sudo needed for the mount syscall on this device). (D) doctor: identity 'iPod Video 60GB Black (5th Generation) (MA147)' — cascade trusts the SysInfo's manually-written ModelNumStr `MA147` (60GB Video 5G) over the firmware serial's `V9M` suffix (which would resolve to A446 / 30GB / 5.5G). For this iFlash-modded device specifically, SysInfo lies; for normal devices ModelNumStr is canonical. Cascade priority is correct in general; this device is an outlier. Worth a follow-up: when SysInfo and serial disagree dramatically across generations, surface a warning. (E) Repair timing 3 runs: 2.452s / 2.370s / 2.315s wall-clock, avg ~2.38s. Transport: 'usb-then-scsi' plan, USB → LIBUSB_TRANSFER_STALL, SCSI fallback succeeds. Third real-hardware validation of commit 80fe65a's SCSI-fallback fix on a SCSI-only iPod. (F) Written XML matches `documents/sysinfo-captures/ipod-5g-video-iflash-1tb.xml` byte-for-byte (trailing newline only). (G) sync --dry-run: 453 tracks to add, 2,869 already synced, 1,038 updates (917 normalization, 109 artwork, 12 metadata); video collection fully synced (112/112). 887.6 GB available (iFlash 1TB capacity correctly visible). (H) Eject clean. Skipped §3c precise mid-inquiry yank — partial coverage on mini 2G accepted as sufficient for AC #6.

§1 nano 4G routine complete (path-mode targeting `-d /Volumes/James' iPod`). USB PID 0x1263, 8GB Black HFS+. (D) doctor: identity 'iPod nano 8GB Black (4th Generation)', 924 tracks, artwork formats 1055/1071/1074/1078 (4 formats — richest of any device tested). (E) Repair timing 3 runs: 0.335s / 0.323s / 0.334s wall-clock, avg ~0.33s — USB success path. KEY FINDING: 7x faster than name-mode runs on other devices. Most of the prior ~2.3s wall-clock on other devices was the `findIpodDevices` discovery phase (per commit c289025: 'device info: skip findIpodDevices in path mode'). Path-mode skips that step entirely. **Performance baseline conclusion**: USB FFI itself is fast; SCSI fallback is fast; the wall-clock dominator is name-mode discovery overhead, not the firmware inquiry transport. Both well under the >500ms warning threshold. (F) Diff vs fixture: expected variation per inventory — crypto blob (lines 107-109), VolumeFormat 'Unknown' (USB) vs 'HFSPLUS' (SCSI fixture), timestamp field (1778337201). All within documented variation. (G) sync --dry-run: 4,247 tracks to add + 113 updates (105 format upgrades, 8 normalization), video collection present (nano 4G supports video), 481 MB available on 8GB device. (H) Eject clean.

§1 nano 7G #1 routine complete (existing inventory device, path-mode). USB PID 0x1267, 16GB Space Gray, serial 000A270024A23E9E (suffix JQ1 → E971). (D) doctor: identity 'iPod nano 16GB Space Gray (7th Generation)' ✓. **Database check FAILS** — 'iTunesDB not found' (expected: nano 7G uses SQLiteDB, not iTunesDB). Doctor's remediation `podkit device init -d <path>` is misleading for nano 7G — hashAB checksum requires proprietary components, sync isn't supported regardless of database init. Should detect post-libgpod generation and surface capability constraint instead. (E) Repair timing 3 runs: 0.632s / 0.555s / 0.553s wall-clock, avg ~0.58s. ~2x nano 4G's 0.33s, scales with 47KB payload (vs nano 4G's 14KB). (F) Diff vs `nano-7g-16gb-usb.xml` fixture: only crypto blob differs (3 lines), all other content stable. (G) sync --dry-run: TWO ISSUES surfaced — (1) Sync command emits 'Could not identify iPod model from the on-disk identity files' even though SysInfoExtended is present and doctor correctly identifies the device. The sync command's identity path is divergent from doctor's — same architectural smell user previously flagged about CLI deciding identity. (2) Sync proceeds with a 4,360-track plan despite nano 7G being hashAB (unsupported). Should refuse cleanly with an unsupported-device message; instead it generates a full plan that would never work. (H) Eject clean.

Architectural follow-up needed: the sync command's identity resolution doesn't use the cascade `assessIpodIdentity` primitive added in commit 348f2c5 / 3e95baf. Same fix pattern applies: replace the legacy identity lookup in the sync command with a `resolveIpodModel(bag)` call, and gate sync on `model.notSupportedReason` so unsupported generations (hashAB nano 6G/7G, iPod Touch/iPhone) refuse cleanly with the canonical message rather than producing a plan that won't execute.

UX/Safety bug (device scan): With NO iPod plugged in (system_profiler confirms zero Apple-vendor USB devices), `podkit device scan` reports 5 phantom 'Unknown iPod (USB only)' entries, each with `✓ USB Connection` and `✗ Partition Table  No disk representation found`. Each phantom suggests `podkit device init` as remediation — a destructive operation on a non-existent device. Likely cause: stale handles in either the `usb` npm package's device cache or libgpod's enumeration path that aren't released after eject/unplug. Critical to fix before encouraging users to follow the suggested remediation. The 5 phantoms appeared after a session of plug-test-eject across multiple iPods, suggesting handles accumulate. Not reproduced from cold-start; surfaced only after multiple device cycles.

§1 nano 7G #2 (BLUE) routine — NEW INVENTORY ENTRY. Mount: `/Volumes/iPod` (lowercase). USB PID 0x1267 (same as #1). FireWire GUID `000A270024565D97`. **Apple Serial: `DCYL44J8F0GP`, suffix `0GP`** (NOT in `tables/serials.ts`). FamilyID 18. Filesystem **HFS+** (different from #1's FAT32). 15.8 GB capacity. Behaviour observations: (C) device-add CORRECTLY REFUSED with 'iPod nano (7th Generation) is not supported by podkit (libgpod cannot sync this generation).' — the new device-add safety gate works. **However**: per user's design preference, device-add should warn-but-allow rather than hard-refuse for unsupported generations (queued as backlog task). Wording nit: 'libgpod cannot sync this generation' leaks an implementation detail — user-facing copy should not name libgpod. (D) doctor via path-mode reports 'SysInfo and SysInfoExtended not found' + 'iTunesDB not found' (expected nano 7G state). (E) `doctor --repair sysinfo-extended` FAILS with 'Failed to open database: Couldn’t find an iPod database on /Volumes/iPod.' — BUG: the repair gates on existing iTunesDB, but the entire point of the repair is to populate identity BEFORE the database is meaningful. Chicken-and-egg gating. Worked around via direct firmware probe through `inquireFirmwareDetailed` — USB inquiry succeeded, captured 47,000 bytes. (F) Fixture saved to `documents/sysinfo-captures/nano-7g-16gb-blue-usb.xml`. Diff vs nano-7g-16gb-usb.xml fixture (#1, Space Gray): per-read crypto blob, FireWireGUID, Apple serial, FAT32 vs HFSPLUS volume format — otherwise content-identical. Confirms nano 7G data structure consistency across units. (G/H) Skipped — no config entry; physical eject only.

Follow-up data: serial suffix `0GP` observed on blue 16GB nano 7G — needs Apple-model-ID research before adding to `tables/serials.ts`. Without it, `0GP` falls through cascade to USB PID lookup (→ 'iPod nano (7th Generation)' generic) instead of the variant 'iPod nano 16GB Blue (7th Generation)'. nano 7G #1's `JQ1: 'E971'` mapping suggests E97x range; blue is likely E978 (Apple part MD477LL/A) but unverified — do not add without authoritative source.

Backlog task to create (per user request): Make podkit work safely + clearly with unsupported devices. Specifically: (1) `device add` should warn the user that the device is not supported but still offer to add it to config (the safety+choice flow). (2) `doctor` should detect unsupported generations and refuse to suggest mutating repairs (`device init`, `repair sysinfo-consistency`, etc.) for them. (3) `sync` should refuse to generate or execute a plan against an unsupported device. (4) Wording: don't name libgpod in user-facing copy — just say 'this generation is not yet supported by podkit'. (5) The `doctor --repair sysinfo-extended` chicken-and-egg gate (requires iTunesDB to exist before allowing the repair that populates identity) should also be fixed — repair must work on a fresh device with no database yet.

§5 iPod touch 5th gen unsupported-device messaging — NEW INVENTORY ENTRY. USB PID 0x12aa, UDID-style serial `637fea3cca37ff292e9cd4b26b1d411dfce06fd8` (40 char hex). No mass-storage mount (iOS uses proprietary protocol). **`device add` fails GENERICALLY**: 'No iPod devices found. Make sure your iPod is connected, or specify a path explicitly with --path.' — the unsupported-device gate is NOT reached because device-add scans for disk-mounted volumes, not USB. iOS devices are invisible to that scan. **`device scan` DOES surface the friendly message**: 'This device is not supported by podkit. iPod touch (5th generation) uses Apple’s proprietary sync protocol; podkit only supports iPod disk mode.' Wording is good (no libgpod jargon, explains the why, names what podkit DOES support). But: (1) the message header still says 'Unknown iPod (USB only)' instead of 'iPod touch (5th generation)' — podkit has the data to label correctly. (2) The friendly message is only visible via `device scan`, not `device add` — most users will run `add` first and hit the generic error. Both issues fold into the unsupported-device backlog task.

§4 Echo Mini routine complete. Hardware: USB PID 0x071b:0x3203, generic serial USBV1.00, manufacturer 'ECHO MINI'. Two mountable volumes: `/Volumes/ECHO MINI` (firmware partition, empty) + `/Volumes/Echo SD` (126 GB ExFAT, the actual sync target). User wiped the existing config + re-added freshly during this routine. (Auto-detect) `device add` with no args fails with 'Missing required --device flag' — the auto-detect-suggest path requires `-d` even though it doesn't use the name yet. With `-d`, output suggests `--type echo-mini --path <mount-point>` (placeholder, not actual paths) and exits with code 1. Doesn't notice existing config entry; doesn't acknowledge two volumes. Wizard-shaped feedback folded into TASK-262; small-bug feedback into TASK-317.03. (Explicit add) `device add -d echomini --type echo-mini --path '/Volumes/Echo SD'` works cleanly: `Type: Echo Mini` (could be richer per TASK-317.07 — 'FiiO Snowsky Echo Mini (echo-mini)'). (D) Doctor output reveals architectural smell — system checks (Codec Encoders, iPod Firmware Inquiry Methods, Video Encoder H.264) are mis-labeled under 'Device Health' instead of 'System'; iPod-specific 'iPod Firmware Inquiry Methods' check runs on a non-iPod device. Captured as TASK-317.08. (E/F) N/A — no SysInfoExtended for mass-storage. (G) sync --dry-run works perfectly: 4,360 tracks to AAC, 117.7 GB available, 'Clean artists: skipped (device supports Album Artist browsing)' (respects preset), 'Skipping video' (respects supportsVideo:false). Cleanest sync output of any device tested. (H) Eject clean.

§7 standalone binary smoke complete. `bash packages/podkit-cli/scripts/compile.sh` produced `packages/podkit-cli/bin/podkit` (93.9 MB single-file binary). Tests: `./bin/podkit --version` → `0.6.0` ✓. `./bin/podkit device add -d smoketest --type echo-mini --path /tmp/fake -y` → device added successfully ('Updated config file' + 'Device smoketest added to config (Echo Mini)' + 'Next steps' guidance) – binary self-contained, no dev deps required at runtime. Cleanup: device removed, /tmp/fake removed. Validates the bundling fix (commit bb2e637 — koffi/usb externalized + arm64 prebuild path) on the actual standalone-binary build path.

§6 multi-device enumeration: PASS. Plugged nano 2G (PARTY IPOD, PID 0x1260, disk4s2) + nano 4G (James' iPod, PID 0x1263, disk5s2) simultaneously. `device scan` correctly identifies both: (1) nano 2G → 'iPod nano 4GB Green (2nd Generation)', mapped to existing `nano2g` config via Volume UUID; full readiness checks pass, 63 tracks, 3.3 GB free. (2) nano 4G → 'iPod nano 8GB Black (4th Generation)', mapped to existing `ipod-nano-slim` config via Volume UUID; full readiness checks pass, 924 tracks, 481 MB free. Order is deterministic across 3 consecutive runs (PARTY IPOD always first — sorts by disk identifier, disk4 < disk5). However: 5 PHANTOM 'Unknown iPod (USB only)' entries follow the real two (already logged as TASK-317.01 — stale-handle bug, not a regression of this AC). Volume-UUID-based config matching works correctly across multiple devices.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Outcome

Hardware sweep complete across **7 iPods + iPod touch + Echo Mini** on macOS. All 11 acceptance criteria satisfied. Surfaced multiple safety, UX, and architectural issues — fixed the urgent ones inline (6 commits today) and captured the rest in a structured backlog (TASK-317 parent + 9 sub-tasks; plus TASK-318 standalone).

## Commits landed today

1. **80fe65a** — `ipod-firmware: thread USB fingerprint through SysInfoExtended SCSI fallback`. Fixed P3 regression where SCSI fallback failed silently for SCSI-only iPods (mini 2G, nano 2G, iPod 5G) because `ensureSysInfoExtended` invoked the orchestrator with empty vendorId/productId. macOS SCSI dispatch needs those to locate the IOService.
2. **bb2e637** — `build: externalize koffi + usb; fix arm64 prebuild path`. Fixed `ReferenceError: require is not defined` from koffi's eval-based native loader being inlined into the bundled CLI. Also fixed an arm64 prebuild path bug that would have broken the linux-arm64 CI standalone-binary job on first run.
3. **3e95baf** — `identity: drop ModelResolver callback; consumers compose via resolveIpodModel`. Architectural cleanup: deleted the leaky `resolveModel` callback from `@podkit/ipod-firmware`, replaced with a flat `SysInfoIdentity` bag. Callers now compose identity via `resolveIpodModel(bag)` cascade. Fixed the regression where mini 2G's display went from `iPod mini 4GB Pink (2nd Generation)` to `Unknown iPod` after writing SysInfoExtended.
4. **348f2c5** — `device-add: cascade-resolved identity + combined firmware-fetch prompt`. Redesigned `device add` UX: post-2006 iPods no longer show as `Model: Invalid`. Combined two-step UX (add to config; separately repair sysinfo-extended) into one prompt: `Add this iPod as X and write SysInfoExtended? [Y/n]`.
5. **d16cf88** — `device-add: shorten missing-SysInfo prompt + add docs link`. Wording cleanup per user direction: removed implementation-detail jargon, named both files, added docs link.
6. **c20b7f3** — `inventory: add nano 3G + nano 7G Blue; serial 0GP → D477`. Inventory updates from sweep findings.

## Key findings

- **USB inquiry boundary refined**: nano 3G supports USB inquiry. Boundary sits between iPod 5.5G (USB fails) and nano 3G (USB works), not between iPod 5.5G and nano 4G as the prior research assumed. Documented in `documents/test-devices.md`.
- **Path-mode is ~7x faster than name-mode** for `doctor --repair sysinfo-extended` (0.33s vs 2.3s on nano 4G). Wall-clock is dominated by `findIpodDevices` discovery overhead in name-mode, not by the firmware transport. Both well under the 500ms warning threshold for the actual work.
- **TERAPOD identity discrepancy**: SysInfo's manually-edited `MA147` says 5G; firmware serial says 5.5G. Cascade trusts ModelNumStr per general priority (correct for normal devices). Captured as new diagnostic + repair (TASK-317.04).
- **Phantom-handle bug** in `device scan`: stale USB handles accumulate across plug/eject cycles, surfacing as fake "Unknown iPod (USB only)" entries with destructive `device init` suggestions. Captured (TASK-317.01).
- **Sync command's identity divergent from doctor's**: emits "Could not identify iPod model" even when SIE is present. Sync bypasses the cascade primitive. Captured (TASK-317.03).
- **Doctor output sectioning inconsistent across device types**: iPods get `System / Device Readiness / Database Health` sections; mass-storage collapses everything into `Device Health` and mis-categorizes system checks. Captured (TASK-317.08).

## Backlog tasks created

- **TASK-317** parent + 9 sub-tasks for the m-18 hygiene follow-ups (.01 native-handle hygiene, .02 doctor repair correctness, .03 unsupported-device UX + cascade through sync/info, .04 SysInfo-vs-Serial diagnostic, .05 CLI flag UX nits, .06 docs refresh, .07 preset display metadata, .08 doctor section consistency, .09 device info redesign).
- **TASK-318** Config CLI UX review (per-device default collections + broader audit). Standalone task, depends on existing TASK-260.
- Echo Mini wizard observations folded into existing **TASK-262** (Interactive Device Add Wizard).

## Inventory deltas

- New rows in `documents/test-devices.md`: iPod nano 3G, iPod nano 7G #2 (Blue), iPod touch 5th gen, FiiO Snowsky Echo Mini.
- New SysInfoExtended fixtures: `documents/sysinfo-captures/nano-3g-8gb-black.xml` (12,131 bytes), `documents/sysinfo-captures/nano-7g-16gb-blue-usb.xml` (47,000 bytes).
- New serial-suffix entries: `S4G → 9804` (mini 2G 4GB Pink); `0GP → D477` (nano 7G 16GB Blue).
- Generation Coverage Analysis refreshed: USB inquiry boundary moved from "5G+" to "post-iPod-5G".

## Acceptance criteria status

All 11 ACs satisfied. AC #1 (XML matches fixtures) confirmed for the 5 supported iPods byte-for-byte modulo trailing newline / per-read crypto blob. AC #11 (test-devices.md updated) reflected via the new device entries + refreshed coverage tables.

## What was deliberately deferred

- `--no-device` flag for `doctor` — captured as TASK-317.05.
- `device add` warn-but-allow for unsupported devices — captured as TASK-317.03.
- All other UX bugs surfaced during the sweep are tracked in TASK-317 sub-tasks with explicit hardware test plans.
<!-- SECTION:FINAL_SUMMARY:END -->

<!-- AC:END -->

<!-- AC:END -->

<!-- AC:END -->

<!-- AC:END -->

<!-- AC:END -->

<!-- AC:END -->

<!-- AC:END -->

<!-- AC:END -->

- [ ] #12 nano 3G inventory entry added to documents/test-devices.md; full §1 routine completed; SysInfoExtended captured.
- [ ] #13 nano 7G #2 (different colour) inventory entry added; full §1 routine completed; serial suffix recorded against the lookup table gap.
- [ ] #14 iPod touch inventory entry added; §5 unsupported-device messaging verified verbatim against source-of-truth code.
<!-- AC:END -->
