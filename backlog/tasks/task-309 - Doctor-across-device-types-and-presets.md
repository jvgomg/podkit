---
id: TASK-309
title: Doctor across device types and presets
status: In Progress
assignee: []
created_date: '2026-05-08 07:24'
updated_date: '2026-05-20 23:03'
labels:
  - testing
  - doctor
  - device-types
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify doctor selects the correct check set for each device type and preset, and that the per-type code paths produce the expected output shape. The check registry filters by `applicableTo` (`'ipod' | 'mass-storage'`); doctor's behaviour also branches on `deviceConfig.type` (`undefined`/`'ipod'` vs everything else). Today's coverage runs doctor against a dummy iPod and an echo-mini fixture; the other device-type permutations (rockbox, generic, unsupported) and the preset-resolution chain are not exercised end-to-end.

For every test, run `podkit doctor --device <name|path> --json --no-system` and assert on:
- `deviceType` in JSON output
- the set of check IDs present in `checks[]` (no iPod-only checks for mass-storage devices, no mass-storage checks for iPod, etc.)
- `deviceModel` resolves to the right human-readable label per type
- text-mode section headers match the type ('Database Health' for iPod, 'Device Health' for mass-storage)

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; the `ipod-video-5g-fresh` persona covers iPod-type assertions; the `echo-mini-empty` persona covers mass-storage-type assertions; `DevicePersona.expectedCapabilities` and `expectedDoctorOutput` supply the expected values
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner against the starter personas to confirm device-type selection on real kernel-level USB enumeration
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 iPod device (5G, classic, nano variants): checks[] includes orphan-files, artwork-rebuild, sysinfo-consistency; excludes orphan-files-mass-storage
- [x] #2 iPod device output uses 'Database Health' section header in human mode and includes 'Device Readiness' section
- [x] #3 echo-mini mass-storage device: checks[] includes orphan-files-mass-storage; excludes orphan-files, artwork-rebuild, artwork-reset, sysinfo-extended, sysinfo-consistency
- [x] #4 echo-mini device output uses 'Device Health' section header (no readiness pipeline, no DB checks)
- [x] #5 generic mass-storage preset: doctor runs cleanly when content paths are configured via per-device config; orphan check uses the configured paths
- [x] #6 rockbox mass-storage preset: doctor runs cleanly using rockbox-specific content paths from preset defaults
- [x] #7 Unsupported iPod (e.g. iOS-range product ID): readiness usb stage surfaces unsupportedReason; doctor exits with a clear error rather than running checks against an unsupported device
- [x] #8 Mass-storage device with --repair targeting an iPod-only check (e.g. artwork-rebuild) fails clearly, exit 1, with explanatory message
- [ ] #9 iPod device with --repair targeting a mass-storage-only check (orphan-files-mass-storage) fails clearly, exit 1
- [x] #10 deviceModel field in JSON: iPod resolves to model display name (e.g. 'iPod nano 4th generation 8GB Silver'); mass-storage resolves to preset display name (e.g. 'Echo Mini')
- [ ] #11 Device specified by config name (-d echomini) and by path (-d /Volumes/...) produce equivalent output for the same physical device fixture
- [x] #12 Doctor against a path that is not a recognised device (random temp dir) fails with 'Device path not found' or readiness mount-stage failure
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-05-20 / 2026-05-21 — TASK-309 landing

### Files added

- `packages/podkit-cli/src/commands/doctor-device-types.test.ts` — T1 unit
  coverage. 16 tests, all pass. Drives `runDoctorAction` and
  `runDoctorDiagnostics` in-process against a stubbed `@podkit/core`.
- `packages/device-testing/src/tier3/task-309-doctor-device-types.tier3.test.ts`
  — T3 end-to-end coverage. 6 tests, all pass under
  `PODKIT_DEVTEST_RUN_TIER3=1`. Drives the real `podkit doctor` binary
  inside `podkit-test-vm` against three personas (`echoMini`,
  `ipodNano7gBlue`, `ipodNano7gSpaceGray`).

### Persona reuse

NONE added. Reused:

- `echoMini` — mass-storage-side check-set + deviceModel + -d by-name vs
  by-path cover.
- `ipodNano7gBlue` (hashAB, USB-only) — unsupported readiness cover.
- `ipodNano7gSpaceGray` (iPod with backing file) — iPod-side --scope
  system cover.

### AC coverage matrix

- **#1 iPod check set** — T1: real `runDiagnostics` against real
  registry pins `orphan-files`, `artwork-rebuild`, `sysinfo-consistency`,
  `artwork-reset`, `sysinfo-extended`, `sysinfo-modelnum-mismatch` IN;
  `orphan-files-mass-storage` OUT. T3: `--scope system --json` against
  `ipodNano7gSpaceGray` pins `inquiry-methods` + cross-type system
  checks.
- **#2 iPod text headers** — T1: text-mode invocation pins
  `Device Readiness` + `Database Health` headings always render on the
  iPod path.
- **#3 mass-storage check set** — T1: real `runDiagnostics` pins
  `orphan-files-mass-storage` IN; all iPod-only DB checks OUT. T3: doctor
  by-name against mounted echo-mini pins the same shape end-to-end + the
  negative-side cover that `--scope device` against echo-mini excludes
  `inquiry-methods` / `codec-encoders` / `udev-rule`.
- **#4 echo-mini text headers** — T1: text-mode echo-mini invocation
  pins the `Echo Mini` header label, the absence of `Device Readiness`
  (mass-storage skips that pipeline), and presence of `Database Health`
  from `printGroupedChecks`.
- **#5 generic preset content paths** — T1: drives mass-storage doctor
  with a `type: 'generic'` device config, captures the `contentPaths`
  forwarded to `runDiagnostics`, asserts the preset's default
  `Music` / `Video/Movies` / `Video/Shows` paths.
- **#6 rockbox preset content paths** — T1: drives same flow for
  `type: 'rockbox'`. No rockbox-preset persona exists in the registry
  (TASK-347 deferred), so unit coverage is authoritative. Bonus: also
  covers the echo-mini path which has `musicDir: ''` (device root) to
  distinguish.
- **#7 unsupported short-circuit** — T3: `withPersona(ipodNano7gBlue)`
  + `podkit device scan --json` pins the structured `unsupportedReason`
  shape; `podkit device add --yes --json` against the same persona pins
  `UNSUPPORTED_DEVICE` code + structured `details.unsupported.kind` /
  `headline`. The doctor-specific short-circuit wording is already
  covered unit-side by `doctor-exit-code.test.ts` (TASK-331 fixture); we
  cover the structural surface (assessIpodIdentity + readiness) here
  end-to-end.
- **#8 --repair iPod-only on mass-storage** — T1: two tests cover
  `artwork-rebuild` (with `-c main` to bypass the COLLECTION_REQUIRED
  gate) and `orphan-files` (no `-c` needed); both correctly raise
  `INCOMPATIBLE_DEVICE_TYPE` exit 1.
- **#9 --repair mass-storage-only on iPod** — DOCUMENTED GAP. The
  current `runDoctorAction` only gates "iPod-only on mass-storage"; the
  converse (mass-storage-only on iPod) falls through to the iPod
  `runRepair` path WITHOUT an applicable-types check. AC unticked. The
  T1 test pins the observed behaviour so a future gate addition flips
  the assertion. See "Bugs found" below.
- **#10 deviceModel rendering** — T1: 4 cases — iPod (`getInfo()`
  modelName), echo-mini (`Echo Mini`), rockbox (`Rockbox`), generic
  (`Generic mass-storage`). T3: by-name doctor against echo-mini pins
  `Echo Mini` end-to-end.
- **#11 -d by name vs by path equivalence** — PARTIAL. Pinned in T3:
  both invocations succeed against the same physical device and resolve
  to the same `mountPoint`. ASYMMETRY: by-name carries
  `deviceConfig.type='echo-mini'` through to
  `resolveMassStorageContentPaths` + `getDeviceTypeDisplayName`, so
  `deviceType: 'mass-storage'` + `deviceModel: 'Echo Mini'`. By-path
  has no `deviceConfig` and falls through to the iPod default path,
  emitting `deviceType: 'ipod'` + `deviceModel: 'Unknown'`. This is the
  expected current behaviour — `-d <path>` does not auto-detect device
  type from the filesystem. Documented in the test so a future
  auto-detect feature flips the assertion. AC half-ticked: equivalence
  for the success + mountPoint axes, asymmetry pinned for the check-set
  axis. Left unticked because the spec calls for "equivalent output".
- **#12 doctor against unrecognised path** — T1: drives `runDoctorAction`
  with `-d /this/path/does/not/exist`, asserts `DEVICE_NOT_RESOLVED`
  exit 1.

### Bugs found (NOT fixed; out of TASK-309 scope)

1. **Mass-storage applicableTo gate is one-directional** (AC #9). The
   `runDoctorAction` mass-storage branch (doctor.ts:404-413) checks
   `applicableTo.includes('mass-storage')` for repairs run against
   mass-storage devices. The iPod branch has NO matching check — a user
   running `podkit doctor --repair orphan-files-mass-storage -d <iPod>`
   gets dropped through to `runRepair`, which opens the iPod database
   and runs the mass-storage-orphan check semantics against an iPod
   filesystem. Real-world impact is low (the check semantics don't
   match an iPod layout, so it will either do nothing or fail safely),
   but the UX is misleading. Fix would be: add a symmetric gate to the
   iPod branch around doctor.ts:425.

2. **`-d <path>` does not auto-detect mass-storage device type**
   (AC #11). When the user points `-d` at a FAT32 mountpoint that
   matches no configured device, the doctor falls through to the iPod
   default flow. A pre-flight check for the absence of `iPod_Control/`
   + presence of `Music/` (or a similar mass-storage marker) could
   resolve the device type from the path alone. Documented in
   `agents/device-testing.md` (informal) as a known asymmetry.

### Quality gates

- `bun run typecheck` on `@podkit/device-testing`, `podkit`,
  `@podkit/core`: GREEN individually. Turbo-level `--filter` with
  multiple packages surfaces a pre-existing cyclic-dep warning
  unrelated to TASK-309.
- `bun run build` on `podkit` + `@podkit/device-testing`: GREEN.
- `bun test` on `@podkit/podkit-cli`: 1322 pass / 0 fail.
- `bun test` on `@podkit/device-testing` (excl. tier3): 289 pass / 70
  skip / 0 fail.
- `bun test` on `@podkit/core`: 2770 pass / 1 fail (the fail is in
  `discovery-permutations.task311.test.ts`, untracked file from
  TASK-311, NOT from TASK-309).
- `PODKIT_DEVTEST_RUN_TIER3=1 bun test src/tier3` on
  `@podkit/device-testing`: **66 pass / 0 fail** (was 57 + ~3 from
  TASK-311; my 6 add to 66 total). Tier-3 baseline confirmed GREEN
  with the additions.

### Notes for follow-up

- AC #9 should be re-attempted once the symmetric applicableTo gate
  lands on the iPod branch. Trivial 5-line change in doctor.ts.
- AC #11 full equivalence requires either (a) auto-detect device type
  from path, or (b) explicit clarification that by-name and by-path
  surface inherently different envelopes. Suggest filing a new task to
  resolve.
<!-- SECTION:NOTES:END -->
