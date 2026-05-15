# Provenance: ipod-shuffle-not-supported

**Source:** synthesised (no hardware)
**Created:** 2026-05-15 (TASK-324 Phase 5 — synthesised rejection personas)
**Operator:** James Greenaway (via Claude Code)

## Synthesised because

The user does not own an iPod shuffle. Rather than coordinate hardware
acquisition for a single rejection-path fixture, this persona is composed
entirely from documented production data sources (the canonical USB PID
table + the canonical rejection-reason string). It exercises the same
code paths a real shuffle would hit:

1. `determineLevel`'s unsupported short-circuit
   (`packages/podkit-core/src/device/readiness/determine-level.ts`).
2. `lookupUnsupportedReason('1302')`
   (`packages/devices-ipod/src/tables/unsupported.ts`).
3. The doctor / readiness-display rejection-rendering path that consumes
   `ReadinessResult.unsupportedReason`.

No partition / mount / sysinfo / database probes are reachable from a USB
rejection, so the corresponding probe fields (`lsblkJson`,
`systemProfilerJson`, `diskutilPlist`) stay `null` and
`partitionLayout.partitions` stays empty.

## Synthesis recipe

| Field | Value | Source |
|-------|-------|--------|
| `usbDescriptor.vendorId` | `0x05ac` | Apple Inc. (canonical) |
| `usbDescriptor.productId` | `0x1302` | `packages/devices-ipod/src/tables/unsupported.ts` line 58 — first shuffle PID listed, paired with `SHUFFLE_REASON`. The shuffle 4G PID `0x1303` would be equally valid; 3G picked because the table lists it first. |
| `usbDescriptor.deviceSerial` | `SHUFFLE-SYNTHESISED-001` | Synthesised — string deliberately marked as fixture data so anyone grep'ing a debug log for the serial lands on this directory rather than chasing a phantom hardware capture. |
| `usbDescriptor.deviceClass / Subclass / Protocol` | `0 / 0 / 0` | Composite-device convention — mass-storage class lives on the interface descriptor for the shuffle's USB-DAC composite gadget. Matches the convention used on every other iPod persona where Linux sysfs has not been consulted. |
| `expectedReadiness.unsupportedReason` | `'iPod shuffle 3rd/4th gen requires iTunes authentication; not supported by libgpod.'` | `SHUFFLE_REASON` constant in `tables/unsupported.ts:35`. |

The unsupported-reason string is duplicated here (rather than imported)
because the test must assert byte-for-byte equality and the fixture is
self-contained data — not a derivation. If the table's reason text
changes, the persona + the smoke test must be updated together.

## Why no host-probe data

`determineLevel`'s unsupported short-circuit fires before any stage rule
runs, so the readiness pipeline never queries the host OS for partition /
filesystem / mount information. Stuffing this persona with plausible
`lsblkJson` / `diskutilPlist` payloads would imply those payloads matter to
the test — they do not. `null` correctly signals "the pipeline never
reaches a state where this data could be inspected".

## Cross-references

- Unsupported-table entry: `packages/devices-ipod/src/tables/unsupported.ts:58` (`'1302': SHUFFLE_REASON`)
- Readiness short-circuit: `packages/podkit-core/src/device/readiness/determine-level.ts` (`determineLevel` unsupported branch)
- Sibling rejection personas: `ipod-touch-5g-unsupported/` (physical-capture variant), `sony-nwz-e384/` (non-Apple mass-storage variant)
- Capture playbook: `documents/persona-capture-playbook.md` §"Synthesised personas (no hardware)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Parent task: TASK-324 Phase 5 (AC #3)
