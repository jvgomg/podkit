# ipod-5g-modelnum-mismatch

Synthesised state-variant persona for the `sysinfo-modelnum-mismatch`
diagnostic check + repair.

Note: the persona id omits the `video-` prefix to stay within the
40-byte configfs `ffs.podkit-<id>` limit imposed by the FunctionFS
gadget framework.

## Identity

Mirrors `ipod-video-5g-iflash-1tb` (TERAPOD): same `vendorId`/`productId`,
same SysInfoExtended XML (serial suffix `V9M` → generation `video_5_5g`).
Synthetic `deviceSerial = MODELNUM-MISMATCH-001` distinguishes it from
the real-hardware sibling without changing classifier behaviour.

## Synthesised state at test time

The persona's `initialContent` seeds only the canonical SIE XML on disk.
A Tier-3 test follows up with `gpod-tool init <mount> --model MA446` to
bootstrap a valid iPod database structure (writes SysInfo + iTunesDB +
the dir hierarchy podkit's readiness pipeline expects), then overwrites
`iPod_Control/Device/SysInfo` with a single-line `ModelNumStr: MA147`
overlay. The resulting on-disk SysInfo is therefore a one-line file —
narrower than a real iPod's multi-field SysInfo, but the
`sysinfo-modelnum-mismatch` check only reads `ModelNumStr` so the shape
is sufficient. Future tests that exercise other SysInfo fields would
need a richer overlay.

`MA147` resolves to generation `video_5g` (original 30/60 GB 5th-gen iPod)
— inconsistent with the firmware-derived `video_5_5g` (the late-5G "Enhanced"
80 GB). This is the textbook TERAPOD-shape mismatch: classic SysInfo was
manually edited (or copied from another iPod) and now disagrees with the
firmware identity.

## Expected behaviour

- `podkit doctor` → `sysinfo-modelnum-mismatch` check status `warn` with
  structured `details.onDiskModelNumStr = 'MA147'`,
  `details.firmwareGenerationId = 'video_5_5g'`.
- `podkit doctor --repair sysinfo-modelnum-mismatch` → backs up SysInfo to
  `SysInfo.podkit-backup`, rewrites `ModelNumStr: MA446` (the canonical
  ModelNum for `video_5_5g`). Re-running the check passes.

Unit coverage at
`packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.test.ts`
pins the byte-level repair semantics; this persona exists so a Tier-3 VM
test can pin the end-to-end CLI contract.
