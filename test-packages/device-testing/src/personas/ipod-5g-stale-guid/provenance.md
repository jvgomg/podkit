# ipod-5g-stale-guid

Synthesised state-variant persona for the `sysinfo-consistency` check +
`--repair sysinfo-extended`.

Note: the persona id omits the `video-` prefix to stay within the
40-byte configfs `ffs.podkit-<id>` limit imposed by the FunctionFS
gadget framework.

## Identity

Mirrors `ipod-video-5g-iflash-1tb` (TERAPOD): same `vendorId`/`productId`,
same `deviceSerial = 000A27001605D1A0`, same SysInfoExtended XML served
via FunctionFS. The descriptor serial is intentionally the real TERAPOD
GUID — `sysinfo-consistency` compares the USB-derived identity against
the on-disk SIE, so the USB-side must carry the truth for the
disagreement signal to fire.

## Synthesised corruption

`massStorageBackingFile.synthesis.initialContent` seeds
`iPod_Control/Device/SysInfoExtended` with a copy of the TERAPOD SIE XML
mutated to flip the `<key>FireWireGUID</key>` value from `000A27001605D1A0`
to `BAADBAADBAADBAAD`. This is the canonical "stale SIE" shape: classic
SysInfoExtended was written long ago (by an earlier firmware sync) and
the firmware identity has drifted since.

## Expected behaviour

- `podkit doctor` (with a valid iTunesDB bootstrapped at test time) →
  `sysinfo-consistency` check status `fail` with structured
  `details.firewireGuid` reporting `BAADBAADBAADBAAD` vs USB identity
  `000A27001605D1A0`.
- `podkit doctor --repair sysinfo-extended` → reads the USB-served SIE,
  writes it back to disk. Re-running the check passes.

Unit coverage in
`packages/podkit-core/src/diagnostics/checks/sysinfo-consistency-repair.test.ts`
already pins the byte-level repair semantics; this persona supports a
Tier-3 VM test pinning the end-to-end CLI contract.
