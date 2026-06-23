---
id: doc-048
title: 'PRD: Device Reset, Rename & Fresh Setup'
type: specification
created_date: '2026-06-22 22:26'
tags:
  - prd
  - ipod
  - device
  - reset
  - rename
  - cli
---
## Problem Statement

After archiving an iPod (`podkit device archive`), a user wants to wipe it back to a fresh, clean state and set it up as a new device — including giving it a name. Today this is awkward and incomplete:

- **No single "factory reset".** `podkit device reset` only recreates an empty iTunesDB; it does **not** delete the audio files or the artwork database. The documented workaround is to run three separate commands in the right order (`device clear --type all`, then `device reset-artwork`, then `device reset`). The user found running three commands to achieve one mental action ("reset this device") confusing.
- **`reset` leaves orphans.** Because it recreates the DB without sweeping `iPod_Control/Music/`, audio files for the now-deleted tracks remain on disk, silently consuming space.
- **`reset` loses the device name.** Recreating the DB resets the master-playlist name (the device's display name) to a default, so a user who only wanted to wipe content unexpectedly loses the name they set.
- **No way to rename a device.** A user who wants to change their iPod's name has no podkit command for it. The name actually lives in two independent places on the device, and keeping them consistent by hand is error-prone.
- **Inconsistent confirmation flags.** Destructive commands disagree on how to skip the safety prompt (`--confirm` vs `-y/--yes`), making the CLI harder to learn and script.

The user explicitly is **not** interested in podkit performing filesystem formatting or partitioning — that remains a manual, OS-tool responsibility.

## Solution

From the user's perspective:

- **`podkit device reset` becomes a true one-shot factory reset.** By default it wipes everything — recreates an empty database, deletes the audio files and the artwork database — and preserves the device's existing name (or accepts a new one via `--name`). It also keeps the disk's visible label consistent with that name. One command, clean device.
- **`podkit device rename <name>` is a new command** that renames the device everywhere it matters at once: the case-correct name stored in the database **and** the disk's volume label. Sensible `--no-disk` / `--no-database` escape hatches let advanced users target just one layer.
- **`podkit device init` gains `--name`** so provisioning a brand-new (uninitialised) device can name it in the same step — symmetric with `reset`.
- **`clear` and `reset-artwork` stay** as complementary, granular tools for partial wipes; they are not removed.
- **Confirmation flags become consistent** across the CLI: `-y/--yes` always skips the prompt; `--force` is reserved for overriding a safety/readiness block.

### Background: where an iPod's name lives (verified empirically)

On a real FAT32 iPod, the name exists in exactly two writable places, confirmed by inspecting the device and its archive dump:

- **iTunesDB master-playlist name** — the case-correct name (e.g. `Party iPod`). Written by libgpod.
- **FAT32 volume label** — uppercase-folded, ≤11 characters (e.g. `PARTY IPOD`). Written via OS tools.

The USB/SCSI inquiry layer and the SysInfo/SysInfoExtended files contain **no writable name** — they are read-only hardware/firmware identity. HFS+ iPods (older classic models) preserve case and allow longer labels, so the label lossiness is FAT-specific.

## User Stories

1. As an iPod owner who just archived my device, I want a single command that wipes it completely, so that I don't have to remember and chain three separate commands.
2. As an iPod owner, I want `device reset` to also delete the audio files (not just the database entries), so that the device's free space actually reflects an empty device.
3. As an iPod owner, I want `device reset` to also clear the artwork database, so that no stale artwork remains after a wipe.
4. As an iPod owner, I want `device reset` to keep my device's existing name by default, so that wiping content doesn't silently rename my iPod.
5. As an iPod owner, I want to optionally pass `--name` to `device reset`, so that I can wipe and rename in one step.
6. As an iPod owner, I want `device reset` to keep the disk's visible label consistent with the device name, so that the name I see in Finder/Explorer matches the name on the device.
7. As an iPod owner, I want a `device rename <name>` command, so that I can change my iPod's name without manual tools.
8. As an iPod owner, I want `device rename` to update both the database name and the disk label by default, so that the name is consistent everywhere.
9. As an advanced user, I want `--no-disk` and `--no-database` flags on `device rename`, so that I can target a single layer when I need to.
10. As a user, I want `device rename` to warn me when my chosen name can't fit the disk label exactly (FAT 11-char/uppercase limit), so that I understand what the disk label became.
11. As a user setting up a brand-new iPod, I want `device init --name <name>`, so that I can initialise and name it in one step.
12. As a user, I want `device reset` to refuse to run on a device whose name can't be read, so that I'm pointed at `init` instead of getting a confusing result.
13. As a user, I want a clear `[N/y]` confirmation before `device reset` destroys data, so that I don't wipe a device by accident.
14. As a user, I want `device rename` to confirm before it runs, so that I don't accidentally change my device's identity.
15. As a scripter, I want `-y/--yes` to skip the confirmation prompt consistently across every destructive command, so that I don't have to remember per-command flag names.
16. As a scripter, I want `-n/--dry-run` available consistently, so that I can preview what a destructive command would do.
17. As a user, I want my podkit config's cached device name/path to be refreshed after a rename or reset, so that the device keeps matching after its label changes.
18. As a Docker/headless user with no config loaded, I want reset and rename to still work, so that the absence of a config doesn't block the operation.
19. As an advanced user, I want `device rename --no-disk --no-database` (a no-op) to error clearly, so that I learn I've asked for nothing.
20. As a user, I want `clear` and `reset-artwork` to remain for partial wipes, so that I retain granular control when I don't want a full reset.
21. As a user on an HFS+ iPod, I want the disk label to preserve case and longer names, so that the label isn't needlessly mangled when the filesystem allows it.
22. As a user, I want reset/rename to apply the disk-label change last, so that the operation doesn't break midway when the mountpoint path changes.

## Implementation Decisions

### Command surface

- **`podkit device reset [device] [--name <name>] [-y|--yes] [-n|--dry-run]`** — full factory reset. Default behaviour, in order: (1) read the current master-playlist name and **error if none is found** (direct user to `init`); (2) recreate an empty database via `initializeIpod({ name })` where `name = --name ?? current`; (3) brute-force sweep `iPod_Control/Music/*` and artwork `.ithmb` files on disk; (4) make the disk volume label consistent with the name, applied **last**. No `--no-*` flags. Requires interactive `[N/y]`; `-y` skips. `--force` remains available only for overriding a readiness/safety objection, not for skipping the prompt.
- **`podkit device rename [device] <name> [--no-disk] [--no-database] [-y|--yes]`** — new command. Default: write the database (master-playlist) name **and** the disk label. `--no-database` skips the DB write; `--no-disk` skips the label write; both together is a no-op and **errors**. Disk label written last. Requires confirmation.
- **`podkit device init [device] [--name <name>] ...`** — add optional `--name` for fresh provisioning, symmetric with reset.
- **`clear` and `reset-artwork`** — retained unchanged in behaviour (granular partial wipes), except for flag standardisation.

### Reset semantics (the orphan fix)

- Reset uses a **brute-force sweep** of on-disk content after recreating the DB, rather than deleting files by walking the old DB. This is what makes it a true factory reset: it removes orphaned audio files that the old "delete by track" path missed.

### Device name model

- **Database name** = the iTunesDB master-playlist name (case-correct). On the **reset** path it is set cleanly at creation via `initializeIpod({ name })`. On the **rename** path (existing DB, not recreated) it is written through a new sanctioned core method that bypasses the existing "cannot rename master playlist" guard.
- **Disk label** = the volume label, projected from the device name per filesystem. FAT32: uppercase + truncate to 11 chars + strip illegal characters, **best-effort with a warning** describing what the label became. HFS+: case-preserved, longer labels permitted.
- The "cannot rename master playlist" guard on the generic playlist-rename API is **kept**; renaming the master playlist is only allowed through the new explicit device-name method, which names the intent.

### Ordering & mountpoint

- The disk relabel **moves the OS mountpoint** (e.g. `/Volumes/PARTY IPOD` → `/Volumes/NEWLABEL`). Therefore the database write happens **first** and the label write happens **last**, after which the device path is re-resolved. This applies to both reset and rename.

### Config bookkeeping

- After a reset or rename, if the device is present in the podkit config, refresh its cached volume name / path. The FAT volume UUID is unchanged by a relabel, so device matching survives. If there is **no config** (e.g. Docker/headless) or the device isn't in it, the operation still succeeds and simply skips the config update. The user's `-d` **alias** is left untouched.

### Flag standardisation (CLI-wide)

- `-y, --yes` is the single skip-confirmation flag everywhere. Convert `device clear` and `device remove` off `--confirm`.
- `--force` means "override a safety/readiness block" only (unchanged on `add`, `init`, `eject`).
- `-n, --dry-run` short form standardised onto the destructive commands that currently lack it (`clear`, `reset`, `reset-artwork`, `doctor`, `mount`).
- These are breaking CLI changes shipped as a minor bump, with no deprecation cycle.

### Modules

Deep/pure:
- **Volume-label projection** — `(name, filesystem) → { label, lossy, warning? }`. Encapsulates all FAT/HFS label rules behind a simple, pure interface.
- **Content sweep** — `(mountPath, { music, artwork }) → result`. Brute-force deletion of audio files and artwork on disk.

Deep/side-effectful:
- **Set volume label** — platform shell-out hidden behind one interface; selects the correct OS tool (diskutil / fatlabel / mtools / HFS+ variant) and handles mountpoint re-resolution. Lives in the existing device platform layer.
- **Set device name (libgpod)** — writes the master-playlist name via the native binding, bypassing the playlist-rename guard.

Orchestrators (the reuse seams):
- **Apply device name** — the single engine both reset and rename funnel through: writes the DB name (if requested), computes the label, writes it last (if requested), refreshes config when present.
- **Reset device** — read current name (error if none) → recreate DB with name → sweep content → apply disk label.

CLI command wiring is thin and contains no business logic.

## Testing Decisions

A good test verifies **external behaviour through the module's public interface**, not its internals. It does not assert on private helpers, exact log strings, or the specific OS command invoked beyond what the contract promises. Tests pin the contract so refactors are safe.

Modules to test (confirmed scope):

- **Volume-label projection (pure)** — unit tests: FAT uppercasing, 11-char truncation, illegal-character stripping, lossy/warning flag, HFS+ case-preservation. Highest value, cheapest.
- **Content sweep (integration, temp dir)** — verify audio files and `.ithmb` are removed, including orphans not referenced by any DB; verify selective `{music, artwork}` toggles.
- **Apply device name (orchestrator)** — unit with fakes for the DB/label/config seams to assert ordering (DB first, label last) and config-refresh-when-present / skip-when-absent; plus one integration pass on a real temp iPod.
- **Set device name (libgpod, integration)** — on a real libgpod temp iPod: master-playlist name is written and re-read correctly, including that it survives save/reopen.
- **Set volume label (integration / mocked exec)** — correct OS tool selected per filesystem; mountpoint re-resolved after relabel.

CLI wiring is covered by existing end-to-end patterns rather than bespoke unit tests.

Prior art: existing libgpod-node integration tests against temp iPods (`packages/libgpod-node/src/__tests__/`), the artwork-repair tests in podkit-core, and the device-command e2e tests.

## Out of Scope

- **Filesystem formatting and partitioning.** podkit detects `needs-format` / `needs-partition` states and directs the user to OS tools; it does not perform them. Explicitly excluded by the user.
- **Writing any name to the USB/SCSI inquiry layer or SysInfo/SysInfoExtended** — these have no writable name field; they are read-only identity.
- **Removing or merging `clear`, `reset-artwork`, or `init`.** They remain as complementary commands.
- **Changing the user-facing `-d` device alias semantics** (the local config alias), beyond refreshing the cached volume name/path.
- **Two-way name sync / monitoring** (e.g. detecting an externally-renamed device and reconciling). Reset/rename are explicit user actions.

## Further Notes

- Empirical grounding: the name's two-layer model was verified on a live FAT32 iPod (`Party iPod` as the iTunesDB master-playlist name; `PARTY IPOD` as the FAT label) and cross-checked against the device's archive dump. The SCSI/SysInfo layers were confirmed to carry no writable name.
- This work is the natural follow-on to the archive command (doc-047): archive → reset → set up as new.
- Relationship between `init` and `reset`: on a populated device they overlap (both can recreate the DB with a name). This overlap is acceptable; `init` remains the readiness-guarded first-time path, `reset` the explicit factory wipe.
