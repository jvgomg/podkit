# Provenance: ipod-nano-4g-hfsplus

**Source:** synthesised (no hardware)
**Operator:** James Greenaway (via Claude Code)

## Synthesised because

The HFS+-on-Linux refusal scenario needs a persona whose USB PID classifies
as **supported** so the readiness pipeline gets past stage 1 (USB) and
reaches the filesystem stage where the refusal lives. nano 4G PID `0x1263`
is the canonical `hash58`/supported nano test PID (also used as the
regression control in `unsupported-cascade.e2e.test.ts`). The default-hashAB
nano 7G PID `0x1267` short-circuits readiness at the USB stage — the
filesystem refusal would never fire.

The persona pairs that PID with a synthesised MBR-wrapped HFS+ backing
image so:

1. `device add` against the synthesised iPod on Linux must refuse with
   `UNSUPPORTED_FILESYSTEM_ON_LINUX` and emit the docs-link refusal text.
2. `device scan` must surface the device with `readiness.level: 'unsupported'`
   and an `unsupportedReason.kind: 'filesystem-unsupported-on-linux'` payload.
3. Both refusals must fire **before** any mount attempt — so a host running
   on a kernel without `hfsplus.ko` reaches the same outcome as one with it.

## Synthesis recipe

| Field | Value | Source |
|-------|-------|--------|
| `usbDescriptor.*` | identical to `ipod-nano-4g-black` | imported verbatim — refusal does not depend on USB shape, only on PID classification |
| `sysInfoExtendedXml` | imported from sibling's `raw/` | refusal short-circuits before SIE is read, but a real payload keeps `device scan` rendering a resolved model name |
| `deviceSerial` / string-descriptor index 3 | `000A27001DCECFHF` (sibling has `…CFB5`) | distinct so dual-iPod tests can address the HFS+ vs default-formatted variant by serial |
| `partitionLayout.luns[0].partitions[1].type` | `'HFS+'` | matches real-world Mac-formatted nano 4G |
| `massStorageBackingFile.synthesis.filesystem` | `'HFS+'` | drives the runner to call the MBR-wrapped HFS+ writer in `hfsplus-image-writer.ts` |
| `massStorageBackingFile.synthesis.sizeMiB` | `32` | 1 MiB MBR alignment + 31 MiB sparse partition; the refusal path only probes the volume header |

## Why no Linux probe data

`lsblkJson` is `null` because the runner doesn't synthesise a canned Linux
probe — the in-VM `lsblk` call reads the live `/dev/sd*` once the FunctionFS
gadget binds the MBR-wrapped HFS+ backing image. That live read is the
whole point: the test exercises the code path from kernel partition reader
→ blkid → podkit's filesystem-policy.

## Sharing fixtures with the sibling

USB descriptor + SIE XML + macOS host probes are imported relatively from
`../ipod-nano-4g-black/raw/`. Persona-typing-policy §5.3 only forbids `..`
in `initialContent.sourceFixture` paths (runtime-resolved strings); TS
`import` declarations are build-time and are explicitly allowed by the
persona convention for synthesised siblings.

## Cross-references

- Refusal policy: `packages/podkit-core/src/device/filesystem-policy.ts`
- Refusal CLI path: `packages/podkit-cli/src/commands/device/add.ts`
- HFS+ image writer: `test-packages/device-testing/src/runners/hfsplus-image-writer.ts`
- VM-test scenario: `test-packages/e2e-vm-tests/src/hfsplus-refusal.e2e.test.ts`
- VM-testing doc: `documents/architecture/testing/vm-testing.md` §5.6
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
