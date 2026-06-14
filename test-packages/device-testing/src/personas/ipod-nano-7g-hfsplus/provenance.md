# Provenance: ipod-nano-7g-hfsplus

**Source:** synthesised (no hardware)
**Operator:** James Greenaway (via Claude Code)

## Synthesised because

Real iPod nano 7G hardware exists in the registry as `ipod-nano-7g-space-gray`
(FAT32) and `ipod-nano-7g-blue` (FAT32 on-capture; described in
documents as HFS+/APM on the original macOS-formatted device). This fixture
strips out everything irrelevant to the **HFS+-on-Linux refusal** scenario:

1. `device add` against an HFS+ iPod on Linux must refuse with
   `UNSUPPORTED_FILESYSTEM_ON_LINUX` and emit the docs-link refusal text.
2. `device scan` must surface the device with `readiness.level: 'unsupported'`
   and an `unsupportedReason.kind: 'filesystem-unsupported-on-linux'` payload.
3. Both refusals must fire **before** any mount attempt — so a host running
   on a kernel without `hfsplus.ko` reaches the same outcome as one with it.

## Synthesis recipe

| Field | Value | Source |
|-------|-------|--------|
| `usbDescriptor.*` | identical to `ipod-nano-7g-space-gray` | imported verbatim — refusal does not depend on USB shape |
| `sysInfoExtendedXml` | imported from sibling's `raw/` | refusal short-circuits before SIE is read, but a real payload keeps `device scan` rendering a resolved model name |
| `deviceSerial` / string-descriptor index 3 | `000A270024A23EHF` (sibling has `…3E9E`) | distinct so dual-iPod tests can address the HFS+ vs FAT32 variant by serial |
| `partitionLayout.luns[0].partitions[0].type` | `'HFS+'` | matches real-world Mac-formatted nano 7G |
| `massStorageBackingFile.synthesis.filesystem` | `'HFS+'` | drives the runner to invoke `mkfs.hfsplus -v IPOD_HFS` |
| `massStorageBackingFile.synthesis.sizeMiB` | `32` | smallest size `mkfs.hfsplus` accepts cleanly; refusal path only probes the volume header |

## Why no Linux probe data

`lsblkJson` is `null` because the runner doesn't synthesise a canned Linux
probe — the in-VM `lsblk` call reads the live `/dev/sd*` once the FunctionFS
gadget binds the HFS+ backing image. That live read is the whole point: the
test exercises the code path from kernel blkid → podkit's filesystem-policy.

## Sharing fixtures with the FAT32 sibling

USB descriptor + SIE XML + macOS host probes are imported relatively from
`../ipod-nano-7g-space-gray/raw/`. Persona-typing-policy §5.3 only forbids
`..` in `initialContent.sourceFixture` paths (runtime-resolved strings); TS
`import` declarations are build-time and are explicitly allowed by the
persona convention for synthesised siblings.

## Cross-references

- Refusal policy: `packages/podkit-core/src/device/filesystem-policy.ts`
- Refusal CLI path: `packages/podkit-cli/src/commands/device/add.ts`
- VM-test scenario: `test-packages/e2e-vm-tests/src/hfsplus-refusal.e2e.test.ts`
- VM-testing doc: `documents/architecture/testing/vm-testing.md`
- ADR-017: `adr/adr-017-device-persona-fixtures.md`
