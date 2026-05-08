---
id: TASK-312
title: 'm-18 hardware sweep A — macOS, all-devices session'
status: To Do
assignee: []
created_date: '2026-05-08 08:13'
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

## Acceptance criteria

- [ ] All 5 iPod routines (§1) completed; XML matches fixtures modulo crypto blob.
- [ ] `device add` auto-detect picks iPod path correctly for each.
- [ ] `doctor --repair sysinfo-extended` succeeds on all 5.
- [ ] `sync --dry-run` produces a coherent plan on all 5.
- [ ] §2 performance numbers recorded; no >2x regression vs P1 baseline.
- [ ] §3 edge cases: stale + corrupted + eject-mid-inquiry all handled gracefully (no crashes; clear messages).
- [ ] §4 Echo Mini auto-detect verified (or flagged as "no hardware available").
- [ ] §5 unsupported-device message verified on real iOS hardware (or flagged).
- [ ] §6 multi-device enumeration deterministic.
- [ ] §7 standalone binary works.
- [ ] `documents/test-devices.md` updated with results.

## Time estimate

~90 min if everything works; +30 min if anything surfaces UX issues that need wording fixes.
<!-- SECTION:DESCRIPTION:END -->
