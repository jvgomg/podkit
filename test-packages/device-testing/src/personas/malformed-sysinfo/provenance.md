# Provenance: malformed-sysinfo

**Source:** synthesised (no hardware)
**Created:** 2026-05-15 (TASK-324 Phase 5 — synthetic error-path persona)
**Operator:** James Greenaway (via Claude Code)

## Synthesised because

The SIE parser's partial-read error path (`parsePlist` running on
truncated input) is impossible to exercise reliably from a real iPod —
real hardware produces well-formed XML, and the partial-read case
only surfaces during flaky USB transfers / abrupt unplugs. A
synthesised persona with a deliberately-truncated payload pins
regression coverage for this path without requiring fault injection at
the transport layer.

## Synthesis recipe

### Corruption strategy: mid-element truncation at byte 500

Of the four corruption strategies considered:

1. **Truncated mid-element** — picked. Realistic fault shape (matches what a partial USB read produces on a flaky device); exercises the parser's "ran out of input before closing tag" path, which is the path that's hardest to test from production code.
2. **Invalid XML (unclosed tag, missing namespace declaration)** — synthetic, doesn't match a real failure mode.
3. **Valid XML missing FireWireGUID / FamilyID** — would test the `extractFromPlist` consumer, not the parser itself. A different concern; worth a separate fixture if/when needed.
4. **All of the above mashed up** — overspecified; one fault per fixture is easier to reason about and fail clearly on.

The truncation point (byte 500) is reproducible:

```bash
head -c 500 test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml \
  > test-packages/device-testing/src/personas/malformed-sysinfo/raw/sysinfo-extended.xml
```

The cut lands in the middle of `<key>MaximumSampleRate<` (incomplete
tag, missing the closing `>` and the rest of the element). This is the
canonical "USB read returned fewer bytes than expected" failure shape.

### USB descriptor

Real iPod 5G Video PID `0x05ac:0x1209`. Identical to the
`ipod-video-5g-iflash-1tb` persona's USB descriptor (different
`deviceSerial`) so the upstream classifier accepts the device as a
supported iPod and routes to the SIE parser — exactly the path under
test.

| Field | Value | Source |
|-------|-------|--------|
| `vendorId` | `0x05ac` | Apple Inc. |
| `productId` | `0x1209` | iPod 5G Video — `packages/devices-ipod/src/tables/usb-ids.ts:33` (`'0x1209': { generation: 'video_5g', displayName: 'iPod 5th generation (Video)' }`). |
| `deviceSerial` | `MALFORMED-SYSINFO-FIXTURE-001` | Synthesised — clearly marked as fixture data so debug logs don't suggest a real hardware capture. |

### Expected outcomes

| Field | Value | Rationale |
|-------|-------|-----------|
| `expectedCapabilities` | iPod 5G Video nominal capabilities | Copied verbatim from `ipod-video-5g-iflash-1tb/persona.ts` so tests can distinguish "parser failed but device identity recoverable from USB PID alone" from misclassification. |
| `expectedReadiness.level` | `'needs-repair'` | `determineLevel`'s "SysInfo check failed" rule (`packages/podkit-core/src/device/readiness/determine-level.ts:88`) resolves a failed `sysinfo` stage to `needs-repair`. Repair path (`podkit device repair sysinfo-extended`) is the user-facing fix. |
| `expectedReadiness.stages[0]` | `{ stage: 'sysinfo', status: 'fail', details: { error: 'parsePlist: …', xmlBytes: 500, truncated: true } }` | One stage, one fail. The `details.error` text is a representative `parsePlist` error message; the exact wording is asserted loosely in the test (the smoke test checks the message *prefix* `'parsePlist:'`, not the exact wording, so parser improvements don't break the fixture). |

### Why host probes are `null`

The test only exercises the SIE parser path. The classifier reads the
USB descriptor directly (not from `lsblk` / `system_profiler`), so
leaving host-probe fields `null` avoids implying they matter to the
fixture. A future end-to-end test that wants to exercise the full
pipeline can copy these in from `ipod-video-5g-iflash-1tb/raw/` (or
swap to a different real-iPod source XML before truncating).

## Cross-references

- Source XML (untruncated): `test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml` (9,693 bytes — the first 500 of which are this persona's payload)
- SIE parser under test: `packages/ipod-firmware/src/plist/parser.ts` (`parsePlist`)
- Readiness cascade rule: `packages/podkit-core/src/device/readiness/determine-level.ts:88` ("SysInfo check failed" → `needs-repair`)
- Sibling synthesised personas: `ipod-shuffle-not-supported/`, `non-ipod-usb-disk/`
- Capture playbook: `documents/persona-capture-playbook.md` §"Synthesised personas (no hardware)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Parent task: TASK-324 Phase 5 (AC #4)
