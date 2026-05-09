---
id: TASK-313
title: m-18 hardware sweep B — linka (Linux box) session
status: Done
assignee: []
created_date: '2026-05-08 08:14'
updated_date: '2026-05-09 20:35'
labels:
  - device-capability-architecture
  - hardware-validation
  - manual-sweep
  - linux
milestone: m-18
dependencies: []
ordinal: 12010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Single sit-down at linka (Tailscale `ssh james@linka` or in-person at the box) for repo setup + Linux hardware sweep + interactive udev UX walkthrough. Replaces TASK-292.13 + TASK-293.03 (Linux portion).

## Hardware + access needed

- **linka** with sudo access (the udev install needs an interactive sudo prompt — non-interactive SSH won't work for §3).
- **nano 4G** (the canonical USB-supporting iPod for Linux; PIDs `0x05ac:0x1262/0x1263`) physically connected to linka.
- Optional: any other iPod from the inventory if portable.

## §1. Repo setup on linka (one-time, can be done remote)

```bash
ssh james@linka  # passwordless via Tailscale

# Clone or update
git clone https://github.com/jamesgreenaway/podkit.git ~/podkit  # or git pull if exists
cd ~/podkit

# bun via mise (linka has mise.toml-pinned 1.3.13)
mise install
mise exec -- bun --version  # must say 1.3.13

# Install + build
mise exec -- bun install
mise exec -- bun run build --filter podkit

# Smoke
node packages/podkit-cli/dist/main.js --version
```

Document the steps in `docs/developers/development.md` Linux section if not already accurate.

## §2. udev UX interactive walkthrough (in-person — needs sudo password)

**Pre-state:** ensure no podkit udev rule is installed.

```bash
sudo rm -f /etc/udev/rules.d/91-podkit-ipod-scsi.rules
sudo udevadm control --reload && sudo udevadm trigger
# Replug nano 4G
ls -l /dev/sg*  # should show root:disk 0660 (NOT root:plugdev)
```

**Step 1 — EACCES message verification:**

```bash
podkit doctor --repair sysinfo-extended -d <nano-4g>
# Expect: fail with multi-line EACCES message:
#   - "Permission denied accessing /dev/sgN."
#   - sudo recommendation
#   - podkit doctor --repair udev-rule mention
#   - "(then unplug and replug)"
#   - Details URL
```

CAPTURE the exact stderr/stdout text. Compare to `packages/ipod-firmware/src/inquiry/scsi/errors.ts` `defaultMessage(eacces)`. Flag any mismatch.

**Step 2 — udev install via the repair:**

```bash
podkit doctor --repair udev-rule
# Expect: sudo prompts natively (interactive password) for cp + udevadm calls
# Expect: rule installed at /etc/udev/rules.d/91-podkit-ipod-scsi.rules
# Expect: completion message instructing replug
```

Verify rule contents include both `GROUP="plugdev"` AND `TAG+="uaccess"`:

```bash
cat /etc/udev/rules.d/91-podkit-ipod-scsi.rules
```

**Step 3 — replug + verify unprivileged access:**

```bash
# Unplug nano 4G, plug back in
ls -l /dev/sg*  # should show root:plugdev 0660 now

podkit doctor --repair sysinfo-extended -d <nano-4g>
# Expect: succeeds without sudo
```

**Step 4 — UX feedback:** any wording that felt off, prompts that were unclear, error recovery that didn't help. Capture as comments on this task.

## §3. Per-iPod routine on Linux

For nano 4G (and any other iPod available on linka), run the same per-device routine as TASK-S-A §1 (steps A–H). Record results in `documents/test-devices.md`.

Specifically capture:
- USB inquiry timing on Linux (libusb FFI under sg device permissions)
- SCSI inquiry timing on Linux (SG_IO ioctl)
- `doctor --repair sysinfo-extended` round-trip wall-clock

Compare timings against macOS results from TASK-S-A §2.

## §4. Linux build verification (no libusb-1.0-0-dev)

The libgpod-node binding should build without `libusb-1.0-0-dev` post-P2. Verify on linka:

```bash
dpkg -l libusb-1.0-0-dev  # is it installed? if yes, note for context
# do NOT uninstall — but verify the build doesn't NEED it via:
mise exec -- bun run --cwd packages/libgpod-node build
# Should succeed regardless of libusb-1.0-0-dev presence.
```

If the runtime check matters, do it inside a Lima Debian VM that has libgpod runtime but not libusb-dev — instructions in `tools/lima/debian.yaml`.

## §5. Standalone binary smoke on Linux

```bash
mise exec -- bun run compile
./dist/podkit --version
./dist/podkit doctor --no-device
```

Confirm the compiled binary works on linka without source dependencies.

## §6. Sync e2e on linka

If a writable iPod is available (nano 4G), do a small sync from a sample directory:

```bash
podkit sync -d <nano-4g> --dry-run
# Verify the plan looks right
podkit sync -d <nano-4g> --collection main
# Verify a small set of tracks copy successfully
```

## Capture format

Update `documents/test-devices.md` "linka" rows + the per-device rows for nano 4G with Linux-side observations.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 §1 repo setup steps verified end-to-end; docs/developers/development.md reflects reality.
- [ ] #2 §2 EACCES message displayed correctly verbatim against the source-of-truth code.
- [ ] #3 §2 `--repair udev-rule` interactive sudo install succeeds; rule file present with both `GROUP="plugdev"` and `TAG+="uaccess"`.
- [ ] #4 §2 post-replug unprivileged inquiry succeeds (no sudo required).
- [x] #5 §2 UX feedback captured as comments on this task.
- [ ] #6 §3 nano 4G full routine on Linux completed.
- [ ] #7 §3 timing comparison with macOS recorded.
- [x] #8 §4 libgpod-node build verified.
- [ ] #9 §5 standalone binary works on Linux.
- [ ] #10 §6 sync e2e completes (or skipped if hardware constraints prevent it).
- [ ] #11 `documents/test-devices.md` updated with linka rows.

## Time estimate

~60 min if setup is clean; +30-60 if repo setup or udev install reveals UX issues.
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
§1 repo setup complete on linka. Three undocumented bootstrap deps / build smells surfaced and fixed inline:

**Finding A** (docs gap): `docs/developers/development.md` Linux apt list omitted `build-essential`. Without `make` + `g++`, `node-gyp rebuild` for `@podkit/libgpod-node` fails with `Error: not found: make`. Added `build-essential` to the Debian/Ubuntu deps list. Fedora/RHEL/Arch sections appear OK because their default `dnf install ffmpeg` etc. pulls in compilers, but worth a re-check next time we touch them.

**Finding B** (build orchestration smell — silent native failure): `packages/libgpod-node/package.json` build script was `node scripts/has-prebuild.cjs || bun run build:native; bun run build:ts`. The trailing `;` (vs `&&`) means `build:ts` runs even when native compile fails. Result: gyp errors → JS bundle still emitted → turbo reports 8/8 success → user thinks build is healthy → first runtime call into the addon explodes. Changed to `(node scripts/has-prebuild.cjs || bun run build:native) && bun run build:ts`. This is in scope for TASK-313 §1 verification but the same pattern likely deserves a sweep of all `;`-chained build scripts — flag for TASK-317 follow-up if any others surface.

**Finding C** (undocumented build-time dep): `packages/podkit-cli/package.json` build used `$(jq -r .version package.json)` to stamp `PODKIT_VERSION` into the bundle. macOS dev boxes have jq via brew; linka didn't. Without jq, `PODKIT_VERSION` becomes empty string → `podkit --version` prints blank. Replaced with `$(node -p "require('./package.json').version")` — same data via a dep we already require.

Verification: post-fix `bun run build --filter podkit` on linka exits clean (gyp ok, CXX/SOLINK clean, all 8 turbo tasks green). Smoke: `node packages/podkit-cli/dist/main.js --version` → `0.6.0`. Help text renders. AC #1 ticked.

Files edited (uncommitted on local main, awaiting review):
- `docs/developers/development.md`
- `packages/libgpod-node/package.json`
- `packages/podkit-cli/package.json`

Also noted: linka had no mise install. Task description and macOS dev pattern assume mise; the dev docs do not document mise for Linux. Both can be true. Did NOT install mise — followed the documented bun-via-curl path. If we want mise for Linux dev box parity, that's a separate doc + setup change.

**Finding D** (§2 prep, BLOCKING SCAN UX): `podkit device scan` on linka with nano 4G plugged-but-unmounted reports `✗ Partition Table — No disk representation found` and recommends `podkit device init` — a destructive misremediation on a healthy device. Real-state evidence: `lsblk` shows sdc/sdc1/sdc2 fine, hfsplus on sdc2; only the mountpoint is missing because Debian server boxes don't auto-mount removable media.

Surfaced as **TASK-317.11** (mount-state as first-class readiness stage). That task also captures: a developer note on what `podkit device init` actually does (it doesn't partition; requires the device to already be mounted), and a recommendation to redesign the readiness-stage → remediation mapping as declarative rather than hand-wired in render code.

§2 (udev EACCES walkthrough) decision: continue today, manually mount nano 4G first to bypass the broken scan flow. EACCES wording verification is independent of the scan refactor.

**Session findings continued (post-§1):**

**Finding F** (HFS+ device add, BROKEN): `podkit device add --path /media/james/disk -d ipodnano` on the HFS+ nano 4G stored `volumeUuid = "manual-L21lZGlhL2phbWVz"` — base64 of `/media/james` (truncated parent dir, not the full mount path). Synthesized fallback fires when udev/blkid can't surface a real UUID for the partition (HFS+ on Linux). Two iPods mounted under same parent dir would collide on identical synthetic UUIDs. Doctor lookup (`podkit doctor -d ipodnano`) fails with `Device with UUID manual-L21lZGlhL2phbWVz not found` because nothing real has that UUID. Synthetic value never printed in `device add` output, so user has zero signal the entry is broken. → captured as TASK-317.15 (defensive error handling) + TASK-317.12 (HFS+ refusal handles the dominant case).

**Finding G + Linux double-entry** (BROKEN scan reconciliation): `podkit device scan` on Linux with a single mounted iPod surfaces TWO entries: one healthy block-device entry, one broken USB-inquiry entry. Both describe the same physical iPod. Confirmed on FAT32 nano 3G (filesystem-independent bug). User noted: "on mac it didn't have this double entry situation. I think this scan bug is linux only." Correct: macOS reconciles via volumeUuid in normal case; Linux's two pipelines never reconcile. → TASK-317.11 retitled and refocused on this exact problem.

**Finding H** (orchestrator error reporting too thin): `podkit doctor --repair sysinfo-extended -d nano3g` failed with one generic line `Could not read device identity from USB`. No transport breakdown, no SCSI fallback mention, no errno detail. macOS sweep had per-transport diagnostics; Linux collapses. → TASK-317.14.

**Finding I** (USB inquiry EACCES at /dev/bus/usb): `/dev/bus/usb/001/016` is mode `0664 root:root`. james not in root → r-only → libusb O_RDWR open fails. Generic error message swallowed the EACCES. Verified by `dd if=/dev/sg3 → Permission denied` and inspection of the USB device file. james IS in plugdev but plugdev doesn't grant /dev/bus/usb access without a udev rule.

**Finding J** (udev rule scope too narrow): rule template at `packages/podkit-core/src/diagnostics/checks/udev-rule.ts` only matches `SUBSYSTEM==scsi_generic`. Does NOT cover `SUBSYSTEM==usb` or `/dev/bus/usb/...`. Even after install + replug, USB inquiry still fails on SSH/headless Linux. systemd-logind's uaccess only grants /dev/bus/usb to active console seats, not SSH sessions. → TASK-317.13.

**Finding K** (verbose flag plumbing): `-vvv` produces output byte-identical to non-verbose for the orchestrator failure path. Verbose flag isn't surfacing transport details on the repair command. → folded into TASK-317.14.

**Sudo verification** (orchestrator code is healthy): `sudo $(which node) ~/podkit/packages/podkit-cli/dist/main.js doctor --repair sysinfo-extended -d /media/james/IPOD` succeeded end-to-end on nano 3G — USB inquiry succeeded, SysInfoExtended written. `sudo ... doctor -d /media/james/IPOD` produced fully-green doctor output (System / Device Readiness / Database Health). All today's failures are pure permissions, not transport bugs. Useful platform invariant: udisksctl FAT32 mount uses `uid=1000,gid=1000` so root writes get re-mapped to operator — file ownership came out `james:james` despite being written by sudo.

**Mount UX wins observed (FAT32 path)**:
- `podkit device scan` on FAT32 unmounted iPod prompts `IPOD is unmounted. Mount now? [Y/n]` — clean polkit-mediated mount, immediate scan continuation. Target experience.
- `podkit device add -d nano3g` (no --path) auto-detects, identifies via cascade, stores real volumeUuid `968A-2063`. Output prints all identity values cleanly.
- `podkit device remove -d nano3g` works correctly.
- doctor sections (System / Device Readiness / Database Health) match macOS structurally on Linux.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Outcome

TASK-313 executed as a Linux setup + structural-discovery session rather than a clean hardware-validation sweep. §1 (repo setup on linka) completed end-to-end with three docs/build fixes applied inline; §2–§6 (udev UX, per-iPod routine, build/binary smoke, sync e2e) blocked by a stack of seven structural findings on Linux that compound to make the original ACs unreachable today. Captured findings drove backlog updates that should let the next sweep (TASK-319) run cleanly.

## Session productivity

linka is now provisioned for podkit work (bun, node, system deps, repo cloned, build verified). The macOS-developed code paths exercise mostly-cleanly on Linux when permissions are right, confirmed by sudo verification of the full doctor pass on nano 3G. The friction is purely permissions, identity-store gaps on HFS+, and discovery-pipeline reconciliation — not transport bugs.

## Inline fixes applied (uncommitted, awaiting review)

1. **`docs/developers/development.md`** — added `build-essential` to Linux apt deps. Without it, `node-gyp rebuild` for libgpod-node fails with `Error: not found: make`.
2. **`packages/libgpod-node/package.json`** — changed build script from `node scripts/has-prebuild.cjs || bun run build:native; bun run build:ts` to `(... || ...) && bun run build:ts`. The `;` masked native compile failures so turbo would report 8/8 success even when the addon didn't build.
3. **`packages/podkit-cli/package.json`** — replaced `$(jq -r .version package.json)` (undocumented jq build-time dep) with `$(node -p "require('./package.json').version")`. Without jq, `PODKIT_VERSION` was an empty string.

## Findings that drove backlog work

- **D + G + Linux double-entry** — `device scan` on Linux runs USB-inquiry and block-device pipelines without reconciliation; same iPod renders twice; no-block-device side suggests destructive `device init`. → **TASK-317.11** (retitled, refocused).
- **F** — `device add` on HFS+ stores synthetic, mount-path-derived, truncated, collision-prone `manual-...` volumeUuid; never printed in output. → **TASK-317.12** (HFS+ refusal) + **TASK-317.15** (defensive missing-UUID handling).
- **H + K** — orchestrator failure surfaces one generic line, no transport breakdown, no remediation hint, `-vvv` adds nothing. → **TASK-317.14**.
- **I + J** — USB inquiry EACCES at `/dev/bus/usb/...` swallowed; podkit udev rule covers only `scsi_generic`, not `usb`. → **TASK-317.13**.
- `device add --path X` without `-d` error wording bug reproducible on Linux. → noted on existing **TASK-317.05**.

## Backlog operations performed

- Edited **TASK-317.11** — retitled and rescoped to discovery reconciliation + stop misadvertising `device init` from broken paths.
- Edited **TASK-317.05** — appended Linux reproduction note.
- Created **TASK-317.12** — refuse HFS+ iPods on Linux at `device add`; warn at `device scan`.
- Created **TASK-317.13** — udev rule covers USB subsystem too.
- Created **TASK-317.14** — orchestrator default error message names all transports + their failure reasons.
- Created **TASK-317.15** — defensive error handling in `device add` when volumeUuid is missing.
- Created **TASK-319** — m-18 hardware sweep B' — Linux re-validation after TASK-317 fixes land. Successor to this task; explicit Echo Mini + broader iPod coverage; per-fix verification ACs.

## Design decisions captured (on TASK-317.11)

- No symlinks for iPod identity / stable paths. Reference by config name; udisksctl path is internal.
- Canonical Linux flow: scan → add → mount.
- udisksctl preserved as primary mount tool; manual sudo mount as documented fallback.
- HFS+ on Linux: refuse-with-docs-link rather than support-with-hacks.

## Hardware coverage delivered vs original plan

- **Original**: nano 4G (canonical Linux iPod) per-routine + udev install + sync e2e.
- **Delivered**: nano 4G partial (mounted, added with broken synthetic UUID, doctor failed), nano 3G primary (mounted, added cleanly with real UUID, doctor passed under sudo, fixture diff matched), filesystem comparison HFS+ vs FAT32 (illuminated), Echo Mini and other iPods deferred to TASK-319.

## What's deliberately deferred

- §2 udev UX walkthrough Steps 2 + 3 (rule install + replug + access verification) — blocked by TASK-317.13 + .14; would not fix the user-visible UX gap until those land. Re-run in TASK-319.
- §3 timing capture — broadly comparable to macOS under sudo on linka; formal capture in TASK-319.
- §5 standalone binary smoke — small remaining work; TASK-319 §5.
- §6 sync e2e — no music collections configured on linka + HFS+ RW path constrained; not productive this session.
- `documents/test-devices.md` Linux row updates — fold into TASK-319 deliverable so the row reflects post-fix state, not the broken-now state.

## Unblocking the next session

When TASK-317.11/.12/.13/.14/.15 have landed (or as many as practical), TASK-319 picks up where this left off. Setup is already done; the bring-up cost is `rsync + bun install + bun run build`. Inventory expands to nano 2G, mini 2G, Echo Mini, and any others portable to linka.
<!-- SECTION:FINAL_SUMMARY:END -->
