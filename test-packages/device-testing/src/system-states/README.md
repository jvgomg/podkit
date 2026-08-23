# System States

A `SystemState` fixture describes a particular host-environment configuration that
affects `podkit doctor --scope system` output. Each state is a named, typed object in
the `systemStates` registry.

## What a SystemState represents

The doctor command runs system-scope checks to verify that the host environment is
correctly configured for podkit to work. A `SystemState` captures:

- **Host environment fields** — what tools and permissions are actually present
  (`ffmpeg`, `libgpod`, `udevRule`, `sgPermissions`, `configfs`).
- **Expected doctor output** — what `podkit doctor --scope system --json`
  *should* emit for that environment (`expectedDoctorSystemOutput`).
- **Expected exit code** — what exit code doctor should return (`expectedExitCode`).

Unit tests inject matching subprocess responses to simulate a state.
VM tests stage the state inside the test VM via `apply-state.sh ${id}` (the
runner copies + invokes the script through `applyState`).

See [ADR-017](../../../../adr/adr-017-device-persona-fixtures.md) §"SystemState schema"
for the full design rationale.

## Cross-check (don't let fixtures drift)

End-to-end alignment between fixture and reality is asserted by
[`system-state-cross-check.e2e.test.ts`](../../../e2e-vm-tests/src/system-state-cross-check.e2e.test.ts).
For every entry in `systemStates`, that test applies the state via
`limaTestVmRunner.applyState`, runs `podkit doctor --scope system --json` inside
the VM, and asserts the parsed envelope matches `expectedDoctorSystemOutput`.

Tolerance: strict on `id` + `status` (the structural contract), and strict on
exit code; tolerant on `summary` (we assert summaries exist but don't compare
prose against the fixture text — fixture summaries are documentation only).
`overallStatus` is derived from `healthy + check.status[]` (the JSON envelope
doesn't emit it directly).

## Starter states (v1)

| ID | What apply-state.sh does | What doctor sees |
|----|---------|---------|
| `healthy` | All tools present, podkit udev rule installed | `inquiry-methods=warn` (no /dev/sg* nodes in the harness VM), all other checks pass. Exit 2. |
| `no-ffmpeg` | Removes ffmpeg | `codec-encoders` + `video-encoder` `skip` with "FFmpeg not available". Exit 2. |
| `no-libgpod` | Removes libgpod runtime packages | Indistinguishable from `healthy` (libgpod is statically linked into podkit; no doctor check observes the dynamic runtime). |
| `no-udev` | Stashes libgpod's `/lib/udev/rules.d/*libgpod*` files | Indistinguishable from `healthy` (doctor's `udev-rule` check tracks the podkit-owned `91-podkit-ipod.rules`, which apply-state leaves in place). |
| `no-sg-perms` | Removes the sg-perms udev rule + chmod 0600 any /dev/sg* nodes | Indistinguishable from `healthy` (no physical /dev/sg* nodes exist on the harness VM, so there is nothing for the perms change to bite). |
| `corrupt-configfs` | Unmounts `/sys/kernel/config` | Indistinguishable from `healthy` (doctor has no configfs check — configfs is only consumed by the gadget infra). |

The four "Indistinguishable from healthy" states are kept because their host-
environment mutations still matter to non-doctor surfaces (gadget setup,
unit-test subprocess mocks, future checks). The cross-check test treats them
as documentation that says "doctor does not observe this state today" — if
a future doctor check starts to observe one, update the fixture and the
cross-check will catch the drift.

## Adding a new state

1. Create a new file in this directory (e.g. `no-aac-encoder.ts`).
2. Export a `const` typed as `SystemState` with a unique `id`, `schemaVersion: 1`,
   and all required fields.
3. Add an `import` and registry entry to `index.ts`.
4. Add a named re-export to `index.ts` and to `../index.ts`.
5. Wire the in-VM mutation into `../../../scripts/apply-state.sh` (add a
   `apply_<state_id>` action + case branch).
6. Reseal the baseline hash if you touched `apply-state.sh`
   (see [`vm-doctor.ts`](../../../scripts/vm-doctor.ts)).
7. Write the `expectedDoctorSystemOutput` — see below.

## How `expectedDoctorSystemOutput` is captured and updated

Capture from the device-harness VM:

1. Apply the state: `bun run vm:shell device` →
   `sudo /tmp/apply-state.sh <id>` (or copy the script in first).
2. Run doctor inside the VM:
   ```
   podkit doctor --scope system --json
   ```
3. Take the `checks[]` array's `(id, status, summary)` triples and paste
   them into the state file. The cross-check test asserts id + status
   strictly; summaries are kept as documentation.
4. Update the golden file for `healthy`:
   ```
   limactl shell podkit-device-harness -- podkit doctor --scope system --json \
     | jq '{overallStatus: (if .healthy then "healthy" elif (.checks|any(.status=="fail")) then "fail" else "warn" end), checks: [.checks[] | {id, status, summary}]}' \
     > test-packages/device-testing/src/system-states/__fixtures__/healthy-doctor-output.golden.json
   ```
5. Run the cross-check VM test:
   ```
   bun test --path-ignore-patterns= --cwd test-packages/e2e-vm-tests \
     ./src/system-state-cross-check.e2e.test.ts
   ```
