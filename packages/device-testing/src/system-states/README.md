# System States

A `SystemState` fixture describes a particular host-environment configuration that
affects `podkit doctor --scope system` output. Each state is a named, typed object in
the `systemStates` registry.

## What a SystemState represents

The doctor command runs system-scope checks to verify that the host environment is
correctly configured for podkit to work (FFmpeg present, libgpod available, udev rule
installed, SCSI permissions correct, configfs mounted). A `SystemState` captures:

- **Host environment fields** — what tools and permissions are actually present
  (`ffmpeg`, `libgpod`, `udevRule`, `sgPermissions`, `configfs`).
- **Expected doctor output** — what `podkit doctor --scope system --format json`
  *should* emit for that environment (`expectedDoctorSystemOutput`).
- **Expected exit code** — what exit code doctor should return (`expectedExitCode`).

Unit tests inject matching subprocess responses to simulate a state.
VM tests stage the state inside the test VM via `apply-state.sh ${id}` (the
runner copies + invokes the script through `applyState`).

See [ADR-017](../../../../adr/adr-017-device-persona-fixtures.md) §"SystemState schema"
for the full design rationale.

## Starter states (v1)

| ID | Purpose |
|----|---------|
| `healthy` | All tools present; baseline. Doctor exits 0. |
| `no-ffmpeg` | FFmpeg binary missing; transcoding unavailable. Doctor exits 1. |
| `no-libgpod` | libgpod runtime missing; iPod database access fails. Doctor exits 1. |
| `no-udev` | podkit udev rule not installed; SCSI access requires sudo. Doctor exits 1. |
| `no-sg-perms` | `/dev/sg*` nodes present but not readable by test user. Doctor exits 1. |
| `corrupt-configfs` | configfs not mounted; USB gadget setup blocked. Doctor exits 1. |

## Adding a new state

1. Create a new file in this directory (e.g. `no-aac-encoder.ts`).
2. Export a `const` typed as `SystemState` with a unique `id`, `schemaVersion: 1`,
   and all required fields.
3. Add an `import` and registry entry to `index.ts`.
4. Add a named re-export to `index.ts` and to `../index.ts`.
5. Write (or capture) the `expectedDoctorSystemOutput` — see below.
6. Update the smoke test (`system-states.test.ts`) if you add new named-failure
   assertions.

## How `expectedDoctorSystemOutput` is captured and updated

**v0 (current):** Values are *synthesised* — hand-written to reflect what doctor
*should* emit once the system-scope checks are fully implemented (TASK-322). They may
not match a real VM run exactly. The golden file
`__fixtures__/healthy-doctor-output.golden.json` pins the `healthy` state; update it
intentionally when the schema changes.

**Once VM lands (TASK-322):**

1. Apply the matching VM snapshot: `mise run vm:snapshot:restore base-<id>`
2. Run doctor inside the VM:
   ```
   podkit doctor --scope system --format json
   ```
3. Paste the `checks` array and `overallStatus` into the state file, replacing the
   synthesised values.
4. Regenerate the golden file for `healthy`:
   ```
   podkit doctor --scope system --format json > \
     packages/device-testing/src/system-states/__fixtures__/healthy-doctor-output.golden.json
   ```
5. Run `bun run test:unit --filter @podkit/device-testing` to confirm all assertions
   pass with the real output.

Note: snapshot values remain v0 synthesised until real VM runs land in TASK-322.
