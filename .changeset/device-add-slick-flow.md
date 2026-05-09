---
"podkit": patch
"@podkit/core": patch
---

Redesign `podkit device add` to be slick and informative. Previously, plugging in a post-2006 iPod (nano 2G, nano 7G, iPod 5G) and running `device add` displayed the device as `Model: Invalid` (libgpod's wording for an empty SysInfo file) and instructed the user to manually write a SysInfo file with `ModelNumStr: MA147` — neither friendly nor accurate.

The new flow:

1. **Identity is cascade-resolved** from USB product ID, classic SysInfo, SysInfoExtended, and serial — whichever sources are available. Display reads `Found iPod nano (2nd Generation):` rather than `Model: Invalid`.
2. **A single combined prompt** asks `Add this iPod as "X" and write SysInfoExtended? [Y/n]` when SysInfoExtended is missing and USB is reachable. Confirming triggers firmware inquiry, writes SysInfoExtended, and persists to config in one step.
3. **Capabilities are derived from the cascade-resolved generation**, not from libgpod's pessimistic fallback. Negative capabilities cite the reason (`- Video (not supported on iPod nano 4GB Green (2nd Generation))`).
4. **The follow-up tip** suggests `podkit sync -d <name> --dry-run`, not "go run two more commands".

New flag `--no-firmware-inquiry` skips the firmware fetch+write when used with `--yes` — for the case where the user wants to defer the write or doesn't have the device connected over USB.

Internal API changes in `@podkit/core`:

- **Added** `assessIpodIdentity(mountPoint, opts?)` returning `IpodIdentityAssessment` — pure cascade-driven assessment (no writes). Combines all available identification sources and returns `{ model, capabilities, firmwareInquiry: 'present' | 'missing' | 'unwritable', needsChecksum }`. The CLI now composes from this primitive instead of reaching into libgpod for identity.

The misleading `device-validation.ts` warning text (`Ensure /Volumes/X/iPod_Control/Device/SysInfo exists with your model number (e.g., "ModelNumStr: MA147")`) has been replaced with a pointer to the canonical fix: `podkit doctor --repair sysinfo-extended`.
