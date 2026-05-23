---
id: TASK-332
title: >-
  DevicePersona schema v2: USB descriptor hierarchy, partition LUN, nullable
  serial
status: Done
assignee: []
created_date: '2026-05-13 22:31'
updated_date: '2026-05-23 18:50'
labels:
  - testing
  - vm-coverage
  - schema
  - fixtures
milestone: m-19
dependencies:
  - TASK-321.02
documentation:
  - packages/device-testing/src/personas/types.ts
  - adr/adr-017-device-persona-fixtures.md
  - documents/persona-capture-playbook.md
priority: medium
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three schema gaps surfaced during the TASK-321.02 persona-capture pass. All are coordinated changes to `DevicePersona` (and the v1 → v2 migration of the 14 committed personas), best landed as one ticket. Block TASK-322.05 (FunctionFS daemon) on this — the daemon needs the full USB descriptor hierarchy to synthesize a credible gadget.

## Gap 1 — `usbDescriptor` is flat; FunctionFS needs the full hierarchy

The current schema only covers the **device descriptor** (vendor/product/serial + top-level class/subclass/protocol). A real USB device descriptor also declares:

- `bNumConfigurations` (Linux sysfs surfaced this for iPod nano 3G as `2`; Mac ioreg reported `1` because it shows only the active config — both correct, descriptor-vs-active distinction)
- One or more **configuration descriptors** (each with `bConfigurationValue`, `bNumInterfaces`, attributes, max power)
- For each configuration, one or more **interface descriptors** (each with `bInterfaceNumber`, `bInterfaceClass`/`SubClass`/`Protocol` — this is where Mass Storage Class `0x08` actually lives, NOT on the device-level fields)
- For each interface, one or more **endpoint descriptors** (bulk IN/OUT for MSC; control transfers for iAP)
- **String descriptor table** (vendor name, product name, serial, by index)

ADR-017's reviewer flagged this gap during the original review — see `adr-017-device-persona-fixtures.md` §"Schema versioning" and the reviewer note about FunctionFS daemons needing more than vendor/product/serial. The flat schema can describe a device exists; it cannot drive `tools/device-testing/lima/builder.yaml` to synthesise a believable gadget.

**Suggested shape** (illustrative; let the implementer choose final structure):

```ts
usbDescriptor: {
  vendorId: number;
  productId: number;
  deviceSerial: string | null;          // see Gap 3
  deviceClass: number;
  deviceSubclass: number;
  deviceProtocol: number;
  bMaxPacketSize0: number;
  bcdUSB: number;
  bcdDevice: number;
  bNumConfigurations: number;
  configurations: Array<{
    bConfigurationValue: number;
    bNumInterfaces: number;
    bmAttributes: number;
    bMaxPower: number;
    interfaces: Array<{
      bInterfaceNumber: number;
      bAlternateSetting: number;
      bInterfaceClass: number;
      bInterfaceSubClass: number;
      bInterfaceProtocol: number;
      endpoints: Array<{
        bEndpointAddress: number;
        bmAttributes: number;
        wMaxPacketSize: number;
        bInterval: number;
      }>;
    }>;
  }>;
  stringDescriptors: Record<number, string>; // index → string
};
```

**Capture-side note:** The Linux session for the 4 reconciled personas already captured most of this via `udevadm info` + `cat /sys/bus/usb/devices/<n>/<id>:...interface_descriptor`. Sony Walkman + iPod 5G Video Mac ioreg dumps also include config descriptors. The data exists in `raw/` for many personas already — the schema migration is mostly transcription.

## Gap 2 — `partitionLayout.partitions[]` has no LUN field

`echo-mini` is a dual-LUN device:
- LUN 0 (`/dev/disk4`): internal FAT32 `ECHO MINI` (7.53 GB)
- LUN 1 (`/dev/disk5`): SD-card slot ExFAT `Echo SD` (126 GB)

The current schema flattens both LUNs into a single `partitions[]` array with a comment apologising for the gap. A future multi-LUN device (some Sony Walkmans, certain SD-card-plus-internal DAPs) will hit the same issue.

**Suggested shape:**

```ts
partitionLayout: {
  luns: Array<{
    lun: number;                  // 0-indexed LUN, default 0 for single-LUN devices
    partitions: Array<{
      index: number;
      type: string;
      sizeMiB: number;
      mountpoint?: string;
    }>;
  }>;
}
```

Migration: every existing persona becomes `luns: [{ lun: 0, partitions: [...existingArray] }]` — mechanical, except `echo-mini` gets two entries.

## Gap 3 — `deviceSerial: string` should be `string | null`

Sony NW-HD5 advertises `iSerialNumber = 0` on USB (no serial-descriptor index assigned). Current schema requires `deviceSerial: string`; the NW-HD5 persona uses an empty string `''` as a workaround. Empty-string-as-null is the kind of subtle thing that bites runtime assertions later (`if (persona.deviceSerial) ...` evaluates false for `''` — correct here, but only by accident).

**Fix:** make it nullable. Migrate `''` in `sony-nw-hd5` to `null`; leave non-empty serials untouched in the other 13 personas.

## Out of scope

- Tier 3 FunctionFS daemon implementation (TASK-322.05). This ticket only enables it by providing the schema.
- Re-running hardware captures. All raw probe data is already on disk under each persona's `raw/` — the migration reads from those, not from re-plugged hardware.

## Impact

- Bump `schemaVersion` on every existing persona (1 → 2). ADR-017 §"Schema versioning" says breaking schema changes are coordinated commits across the whole registry — this ticket is exactly that.
- Update `packages/device-testing/src/personas/types.ts` + every persona file.
- Update `documents/persona-capture-playbook.md` to instruct future captures to populate the richer schema.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `DevicePersona.usbDescriptor` extended to model the full device descriptor tree: device-level fields + configurations[] + interfaces[] + endpoints[] + stringDescriptors. `bNumConfigurations` exposed.
- [x] #2 `DevicePersona.partitionLayout` reshaped to `{ luns: Array<{ lun, partitions: Array<...> }> }`; `echo-mini` updated to expose both LUNs distinctly
- [x] #3 `DevicePersona.usbDescriptor.deviceSerial` type changed to `string | null`; `sony-nw-hd5` migrated from `''` to `null`
- [x] #4 `schemaVersion` bumped from 1 to 2 on every persona in the registry; the bump is the breaking-migration signal per ADR-017
- [x] #5 All 14 existing personas migrate cleanly: extract richer USB descriptor data from each persona's `raw/sysfs-usb.txt` + `raw/ioreg.txt` + `raw/udev.txt` where available; flag any persona that lacks the needed raw data and document a follow-up capture
- [x] #6 `packages/device-testing/src/personas/types.ts` updated with full TSDoc on the new fields
- [x] #7 `documents/persona-capture-playbook.md` updated to instruct future captures to populate the richer schema (which `cat /sys/...` commands surface which fields, etc.)
- [x] #8 `bun run build --filter @podkit/device-testing` + `bun run typecheck --filter @podkit/device-testing` + existing tests pass; no behavioural regression
- [x] #9 ADR-017 either updated in place (recommended — single source of truth) or supplemented with an addendum documenting the v2 schema
- [x] #10 TASK-322.05 (FunctionFS daemon) becomes implementable against the new schema — cross-link this ticket from there
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Drift note (2026-05-16):** Description says "Block TASK-322.05 (FunctionFS daemon) on this" but TASK-322.05 + TASK-322.05.01 are now both Done. The daemon shipped using the current flat `usbDescriptor` shape, which was sufficient for two of the three starter personas (ipod-video-5g, ipod-nano-7g) to enumerate end-to-end via FunctionFS. The schema-v2 work in this task is still valuable for: (a) the echo-mini dual-LUN gap (Gap 2 in this description), (b) future devices that need richer descriptor data, (c) the sony-nw-hd5 null-serial cleanup (Gap 3). It is no longer a hard blocker on 322.05's daemon.

**2026-05-23 — Landed (schema v2 across the whole registry).**

**Files changed (host-side):**
- `packages/device-testing/src/personas/types.ts` — new schema (TSDoc on every field). `usbDescriptor` now carries `UsbDescriptor` interface (device descriptor + `configurations[]` + `interfaces[]` + `endpoints[]` + `stringDescriptors`). `partitionLayout` reshaped to `{ luns: Array<{ lun, partitions[] }> }`. `deviceSerial: string | null`. Discriminated union for `MassStorageBackingFile` was attempted but reverted — kept `imagePath?` + `synthesis?` both optional to preserve existing runtime callers' `if (backing.synthesis)` checks. Promoted the synthesis recipe to a top-level `MassStorageBackingFileRecipe` interface.
- All 17 personas migrated `schemaVersion: 1 → 2`, wrapped `partitions[...]` in `luns: [{ lun: 0, partitions: [...] }]`, augmented `usbDescriptor` with hierarchy fields. Echo Mini + populated sibling have both LUNs distinctly modelled.
- `sony-nw-hd5`, `sony-nw-a1000`, `sony-nw-a1200`, `sony-nw-a3000` migrated `deviceSerial: '' → null` (all four declare `iSerialNumber=0`). Other 13 personas keep their non-empty serials.
- `packages/device-testing/src/personas/sidecar-build.ts` — handles nullable `deviceSerial` by omitting the sidecar `serial` field rather than serialising `null`.
- `packages/device-testing/src/personas/sidecar.test.ts` — added regression test for null-serial omission; updated inline builder.
- 4 other inline test builders updated for v2 shape (`runtime.test.ts`, `runners/lima-test-vm.test.ts`, `runners/lima-test-vm-backing-files.test.ts`, `tier3/tier3-runtime-setup.test.ts`).
- Type-safety touch-ups for `string | null` deviceSerial in 4 test files (`corrupt-db.test.ts`, `malformed-sysinfo.test.ts`, `rejection-personas.test.ts` ×2, `tier3/m18-discovery-reconciliation.tier3.test.ts`).

**ADR + playbook:**
- `adr/adr-017-device-persona-fixtures.md` — rewrote § "DevicePersona schema" to show v2 shape; added new § "Schema v2 — May 2026 (TASK-332)" documenting the three gaps + the daemon-compatibility decision.
- `documents/persona-capture-playbook.md` — schema-v2 banner added to reference materials; expanded the `usbDescriptor` composition guide with a Mac/Linux source table; rewrote the `partitionLayout` section to cover single-LUN + multi-LUN cases.

**Daemon-compatibility notes:**
- The sidecar wire shape (`sidecar.ts`) was **not** changed. The dummy-hcd daemon's needs are minimal (vendor/product/serial/class/subclass/protocol + optional XML + optional mass-storage path) and adding the richer hierarchy would have grown the daemon binary for no functional gain. The richer hierarchy stays host-side; if a future test needs to assert interface descriptors at the gadget level, extend the sidecar then.
- The sidecar builder's projection of `deviceSerial: null` is to omit the `serial` field entirely (rather than serialising `null`). This keeps the daemon's existing optional-string fallback (`'000000000001'` default in `gadget.ts:101`) intact — no daemon code changes needed.

**Personas flagged for follow-up Linux capture (USB hierarchy synthesised, not measured):**
These personas don't have a `raw/sysfs-usb.txt` and inherited their USB descriptor hierarchy from the family pattern. A re-capture from `lsusb -v` + `cat /sys/.../bDevice*` should confirm the values. Not blocking — the synthesised values match the composite-mass-storage convention that every captured iPod sibling exhibits.
  - `ipod-mini-2g-pink`
  - `ipod-nano-2g-green`
  - `ipod-nano-7g-space-gray` (Linux capture deferred; descriptor inherited from the Blue sibling — same PID 0x1267)
  - `ipod-touch-5g-unsupported` (iOS device; no disk mode; descriptor minimally synthesised — the classifier rejects on USB PID before reading the hierarchy)
  - `ipod-video-5g-iflash-1tb`
  - Synthetic personas (`ipod-shuffle-not-supported`, `malformed-sysinfo`, `ipod-video-5g-corrupt-db`, `non-ipod-usb-disk`) — no hardware to re-capture from.

**Quality gates (all green):**
- `bun run typecheck` (workspace-wide) — 30/30 packages green.
- `bun run build --filter @podkit/device-testing` — green.
- `bun run test --filter @podkit/device-testing` (T1 + T2) — **329 pass / 0 fail / 88 skip** (skipped = tier-3 not running).
- `PODKIT_DEVTEST_RUN_TIER3=1 bun test src/tier3` — **79 pass / 0 fail** (Tier-3 baseline preserved exactly).
- Daemon smoke test (`mass-storage-binding.tier3.test.ts`) — 1 pass / 0 fail.

**Drift-note from 2026-05-16 superseded.** TASK-322.05's FunctionFS daemon shipped against the v1 flat schema and continues to consume the unchanged sidecar — v2 is a host-side schema enrichment that unblocks future descriptor-level assertions without requiring a daemon update. Gap 2 (Echo Mini dual-LUN) and Gap 3 (NW-HD5 null serial) are now resolved at the schema level; the runner's mass-storage staging is still single-LUN (TASK-336+ to extend).
<!-- SECTION:NOTES:END -->
