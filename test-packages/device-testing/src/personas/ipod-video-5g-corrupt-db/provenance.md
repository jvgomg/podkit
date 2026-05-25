# Provenance: ipod-video-5g-corrupt-db

**Source:** synthesised (no hardware)
**Created:** 2026-05-23 (TASK-324 Phase 5 AC #1 — state-variant personas)
**Operator:** James Greenaway (via Claude Code)

## Synthesised because

The user direction (2026-05-17) was to synthesise rather than capture this
persona. Exercising the corrupt-database path from a physical device would
require deliberately corrupting a real iPod's iTunesDB — a destructive
operation that is difficult to reproduce exactly and risks damaging the
device if the corruption extends beyond the DB partition.

A synthesised persona with a controlled corruption is:
- Reproducible: the 512-byte file is deterministic from the recipe below.
- Safe: no hardware at risk.
- Targeted: the truncated `headerLen = 0` precisely exercises `parseMhbd`'s
  minimum-size guard — the first validation after the 4-byte magic check.

## USB identity

Same `vendorId / productId` as `ipod-video-5g-iflash-1tb` (`0x05ac:0x1209`).
Same SIE XML (imported directly from the sibling persona's `raw/`). The
classifier accepts this as a fully-supported iPod 5G Video and routes through
the full inquiry pipeline up to the database parse step, where the fault
surfaces.

## Synthesis recipe

### Corruption strategy: truncated mhbd (512 bytes, headerLen = 0)

Of the strategies considered:

1. **Truncated mhbd (picked)** — 4-byte `mhbd` magic + 508 zero bytes.
   `parseMhbd` reads `headerLen = 0` (zero-filled LE uint32) → throws
   "mhbd header too small" (< 32 bytes). Realistic: matches what a partial
   flash write or abrupt DB write abort produces. No real iTunesDB needed.
2. **Scrambled checksum** — copy a real iTunesDB and flip bits in the checksum
   field. Would test the checksum-verification path rather than the
   truncated-read path. Requires a real iTunesDB (not committed for privacy).
3. **Random bytes at mhbd offset** — would fail the `tag !== 'mhbd'` check
   before reaching `parseMhbd`. Different failure surface — simpler but less
   interesting.

The truncated-mhbd approach is implemented inline in `persona.ts` (no committed
binary; the `Uint8Array` is constructed from first principles):

```ts
export const corruptItunesDb = new Uint8Array(512);
corruptItunesDb[0] = 0x6d; // 'm'
corruptItunesDb[1] = 0x68; // 'h'
corruptItunesDb[2] = 0x62; // 'b'
corruptItunesDb[3] = 0x64; // 'd'
// Bytes 4-511: 0x00 → headerLen = 0 → "mhbd header too small"
```

The `raw/iTunesDB` binary is also committed for VM synthesis (the
`massStorageBackingFile.synthesis.initialContent` recipe references it via
`sourceFixture`).

### iTunesDB binary committed to raw/

`raw/iTunesDB` is the same 512-byte sequence committed as a binary fixture
for VM's `initialContent` mechanism. It is byte-identical to the
`corruptItunesDb` Uint8Array constructed in `persona.ts`. The `raw/` file is
the source-of-truth for VM (where the runner reads it and copies it into
the FAT32 image); the inline `Uint8Array` is the source-of-truth for unit
(where no filesystem access occurs).

Recreation command:
```bash
python3 -c "
data = b'mhbd' + b'\\x00' * 508
with open('test-packages/device-testing/src/personas/ipod-video-5g-corrupt-db/raw/iTunesDB', 'wb') as f:
    f.write(data)
"
```

### SIE XML

Imported directly from the sibling persona's `raw/sysinfo-extended.xml`:
```ts
import sysInfoExtendedXml from '../ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml'
  with { type: 'text' };
```

This keeps the two personas byte-for-byte consistent on the SIE layer —
if the iPod 5G Video's real SIE XML ever changes, both personas update
together automatically.

## Expected outcomes

| Field | Value | Rationale |
|-------|-------|-----------|
| `expectedCapabilities` | iPod 5G Video nominal capabilities | USB PID `0x1209` unambiguously identifies the generation; capabilities are derivable from USB identity alone. SIE parse succeeds; DB parse failure does not affect capability derivation. |
| `expectedReadiness.level` | `'needs-repair'` | `determineLevel` maps a failed `database` stage to `needs-repair`. Repair path: `podkit device repair itunes-db`. |
| `expectedReadiness.stages[0]` | `{ stage: 'database', status: 'fail', details: { error: 'parseMhbd: mhbd header too small', dbBytes: 512, truncated: true } }` | One stage, one fail. The exact error wording is asserted loosely (prefix check) so `parseMhbd` improvements don't break the fixture. |

## Contrast with malformed-sysinfo

| Fixture | Fault layer | Error | Level |
|---------|------------|-------|-------|
| `malformed-sysinfo` | SIE XML (SCSI VPD 0xC0 layer) | `parsePlist: unexpected end of input` | `needs-repair` |
| `ipod-video-5g-corrupt-db` | iTunesDB (database layer) | `parseMhbd: mhbd header too small` | `needs-repair` |

Both resolve to `needs-repair` but at different pipeline stages. The `malformed-sysinfo`
persona fires at `sysinfo` stage; this persona fires at `database` stage.

## Cross-references

- Sibling real-hardware persona: `test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/`
- SIE XML source (shared): `test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml`
- Parser under test: `packages/ipod-db/src/itunesdb/records/mhbd.ts` (`parseMhbd`)
- Database entry point: `packages/ipod-db/src/itunesdb/parser.ts` (`parseDatabase`)
- Contrast fixture: `test-packages/device-testing/src/personas/malformed-sysinfo/` (SIE-layer fault)
- Capture playbook: `documents/persona-capture-playbook.md` §"Synthesised personas (no hardware)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Parent task: TASK-324 Phase 5 (AC #1 part A)
