---
id: TASK-313
title: m-18 hardware sweep B — linka (Linux box) session
status: To Do
assignee: []
created_date: '2026-05-08 08:14'
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

## Acceptance criteria

- [ ] §1 repo setup steps verified end-to-end; docs/developers/development.md reflects reality.
- [ ] §2 EACCES message displayed correctly verbatim against the source-of-truth code.
- [ ] §2 `--repair udev-rule` interactive sudo install succeeds; rule file present with both `GROUP="plugdev"` and `TAG+="uaccess"`.
- [ ] §2 post-replug unprivileged inquiry succeeds (no sudo required).
- [ ] §2 UX feedback captured as comments on this task.
- [ ] §3 nano 4G full routine on Linux completed.
- [ ] §3 timing comparison with macOS recorded.
- [ ] §4 libgpod-node build verified.
- [ ] §5 standalone binary works on Linux.
- [ ] §6 sync e2e completes (or skipped if hardware constraints prevent it).
- [ ] `documents/test-devices.md` updated with linka rows.

## Time estimate

~60 min if setup is clean; +30-60 if repo setup or udev install reveals UX issues.
<!-- SECTION:DESCRIPTION:END -->
