# Provenance: echo-mini-populated

**Source:** synthesised (no hardware)
**Created:** 2026-05-23 (TASK-324 Phase 5 AC #1 — state-variant personas)
**Operator:** James Greenaway (via Claude Code)

## Synthesised because

This persona represents the Echo Mini in a "populated" state — i.e., with
music files present on the FAT32 volume. Capturing this state from physical
hardware would require:

1. Loading music onto the Echo Mini SD card.
2. Running the full capture playbook with user content (privacy concern).
3. Re-capturing whenever the test expects a clean, reproducible set of files.

A synthesised persona avoids all three concerns: the five synthetic track
files are deterministic, contain no user data, and are defined entirely by
the synthesis recipe below.

## Relationship to empty sibling (`echo-mini`)

`echo-mini` and `echo-mini-populated` share the same USB identity
(`0x071b:0x3203`), the same host-probe payloads (imported from `echo-mini`'s
`raw/`), and the same preset-resolved capabilities. They differ only in the
`massStorageBackingFile.synthesis` recipe:

| Field | `echo-mini` | `echo-mini-populated` |
|-------|-------------|----------------------|
| `sizeMiB` | 64 | 64 |
| `label` | `ECHO_MINI` | `ECHO_POPU` |
| `initialContent` | absent (empty FAT32) | 5 × 64-byte `.mp3` blobs in `Music/` |

The label differs so that the two images are distinguishable in the VM's
`/var/device-testing/backing-files/` directory. Same size so the VM
runner's synthesis step is equally fast for both.

## Synthesis recipe

### Backing image

```
truncate -s 64M <vmPath>.tmp
mkfs.vfat --invariant -F 32 -n ECHO_POPU -I <vmPath>.tmp
# then: copy each track file into Music/ via mcopy or loop-mount
```

The `initialContent` field in `massStorageBackingFile.synthesis` specifies
the five files to seed:

| `path` (in FAT32) | `sourceFixture` | Content |
|-------------------|-----------------|---------|
| `Music/track-01.mp3` | `./raw/track-01.mp3` | 64 × `0xAA` sentinel bytes |
| `Music/track-02.mp3` | `./raw/track-02.mp3` | 64 × `0xAA` sentinel bytes |
| `Music/track-03.mp3` | `./raw/track-03.mp3` | 64 × `0xAA` sentinel bytes |
| `Music/track-04.mp3` | `./raw/track-04.mp3` | 64 × `0xAA` sentinel bytes |
| `Music/track-05.mp3` | `./raw/track-05.mp3` | 64 × `0xAA` sentinel bytes |

### Synthetic track files

Each `track-0N.mp3` in `raw/` is exactly 64 bytes of `0xAA` (170 decimal)
sentinel bytes. The files are **not valid MP3 audio** — `0xAA` is not a valid
MPEG sync byte (`0xFF`). They exist solely to:

1. Create directory entries in the FAT32 volume (exercising the content-scan
   and file-count code paths).
2. Be deterministic from the recipe: `python3 -c "open('track-0N.mp3','wb').write(b'\\xaa'*64)"`.
3. Be clearly synthetic in a hexdump — the `0xAA` pattern is visually
   distinct from both zero-fill and real MP3 frames, making accidental
   real-audio fixture commits obvious in code review.

Recreation command:
```bash
python3 -c "
import os
raw_dir = 'test-packages/device-testing/src/personas/echo-mini-populated/raw'
for i in range(1, 6):
    with open(os.path.join(raw_dir, f'track-0{i}.mp3'), 'wb') as f:
        f.write(b'\xaa' * 64)
"
```

## Mass-storage backing file implementation note

The `initialContent` field in `DevicePersona.massStorageBackingFile.synthesis`
is declared on this persona but **not yet wired** in the VM backing-file
synthesiser (`test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts`).
TASK-324 lands the persona; **TASK-352** lands the runner-side wiring (after
`mkfs.vfat --invariant`, use `mtools` (`mmd` + `mcopy`) to copy each
`sourceFixture` file into the FAT32 image at its declared `path` — no loop-mount
or root privileges needed). Until TASK-352 lands, VM runs against this
persona will produce an **empty** FAT32. unit smoke tests are unaffected
(they exercise the parser directly via the exported byte arrays).

## Cross-references

- Empty-state sibling: `test-packages/device-testing/src/personas/echo-mini/`
- Shared host-probe payloads: `test-packages/device-testing/src/personas/echo-mini/raw/`
- Backing-file synthesiser: `test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts`
- Synthesis script (manual): `test-packages/device-testing/scripts/build-backing-file.ts`
- Capture playbook: `documents/persona-capture-playbook.md` §"Synthesised personas (no hardware)"
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
- Parent task: TASK-324 Phase 5 (AC #1 part B)
