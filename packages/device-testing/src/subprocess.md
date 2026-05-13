# Subprocess snapshot framework

`SubprocessRunner` is the dependency-injection seam every podkit module uses
when it needs to spawn an external binary (`ffmpeg`, `ffprobe`, `lsblk`,
`system_profiler`, `diskutil`, `mount`, `umount`, `udisksctl`, `which`, …).

The interface lives in `@podkit/device-types`; the capture + replay
implementations live here in `@podkit/device-testing` so production never
imports the test harness.

```ts
import type { SubprocessRunner } from '@podkit/device-types';
```

```ts
import {
  defaultSubprocessRunner,
  CapturingSubprocessRunner,
  ReplaySubprocessRunner,
  createSubprocessRunner,
} from '@podkit/device-testing';
```

## When to use it

Reach for the abstraction every time you would otherwise call `execFile`,
`spawn`, `execSync`, or `spawnSync` on one of the binaries above. The
interface is intentionally narrow — `run(command, args, opts?)` → `{ stdout,
stderr, exitCode }` — so it covers the "spawn, wait for exit, collect
output" pattern. **It is not a fit for streaming progress consumers** (e.g.
the FFmpeg transcoder that parses progress lines from stdout in real time);
those callsites keep their own `SpawnFn` DI seam.

The shape of a refactored callsite is:

```ts
import { defaultSubprocessRunner } from '@podkit/core'; // or local re-export
import type { SubprocessRunner } from '@podkit/device-types';

export async function findIpods(
  subprocess: SubprocessRunner = defaultSubprocessRunner
): Promise<Ipod[]> {
  const { stdout } = await subprocess.run('lsblk', ['-J']);
  // …
}
```

Tests pass an instance from `@podkit/device-testing`:

```ts
import { ReplaySubprocessRunner } from '@podkit/device-testing';

const subprocess = new ReplaySubprocessRunner(
  path.join(__dirname, '../personas/ipod-video-5g-fresh/subprocess-fixtures')
);

const ipods = await findIpods(subprocess);
```

## Capturing fresh fixtures

To capture (or refresh) a persona's subprocess fixtures, run the relevant
test command with the capture env vars:

```bash
PODKIT_SNAPSHOT_CAPTURE=1 \
PODKIT_SNAPSHOT_DIR=packages/device-testing/src/personas/ipod-video-5g-fresh/subprocess-fixtures \
bun run test:unit --filter @podkit/core -- device/platforms
```

The `CapturingSubprocessRunner` (constructed by `createSubprocessRunner`
when `PODKIT_SNAPSHOT_CAPTURE=1` is set) wraps `defaultSubprocessRunner`,
forwards the live result to the caller unchanged, and writes a JSON file
per call:

```
<PODKIT_SNAPSHOT_DIR>/<sha256-of-command-args-cwd-env-truncated-to-16>.json
```

```json
{
  "command": "lsblk",
  "args": ["-J"],
  "opts": {},
  "stdout": "{\"blockdevices\":[...]}",
  "stderr": "",
  "exitCode": 0,
  "capturedAt": "2026-05-13T16:24:09.231Z"
}
```

Fixtures are content-addressed by a stable hash over `{ command, args, cwd,
env }` so equivalent calls always land on the same filename, and reordering
keys in an `env` map doesn't change the hash.

## Error-message → fix-command

When `ReplaySubprocessRunner` is asked for a call it doesn't have a fixture
for, it throws an error that quotes the exact capture command:

```
Error: No fixture for command='lsblk' args=["-J"]
(hash=ab12cd34ef567890,
 dir=/…/personas/ipod-video-5g-fresh/subprocess-fixtures).
Capture with: PODKIT_SNAPSHOT_CAPTURE=1
PODKIT_SNAPSHOT_DIR=/…/personas/ipod-video-5g-fresh/subprocess-fixtures
<test cmd>
```

Copy-paste the command, rerun, commit the new fixture.

## Where to put fixtures

| Path | When to use |
|------|-------------|
| `packages/device-testing/src/personas/<persona-id>/subprocess-fixtures/*.json` | Output depends on which device persona is plugged in (e.g. `lsblk` listing, `system_profiler` USB tree). |
| `packages/device-testing/fixtures/shared/*.json` | Output is environment-independent on a healthy host (e.g. `ffmpeg -encoders` listing). |

The capture/replay runners take a directory argument — they don't know
anything about persona layout. The convention is enforced by tests that
choose which directory to point at.

## Factory

`createSubprocessRunner(env)` is the one-liner used by orchestrators that
need to honour the env vars:

| Env | Runner |
|-----|--------|
| `PODKIT_SNAPSHOT_CAPTURE=1` + `PODKIT_SNAPSHOT_DIR=<dir>` | `CapturingSubprocessRunner(default, <dir>)` |
| `PODKIT_SNAPSHOT_REPLAY=1` + `PODKIT_SNAPSHOT_DIR=<dir>` | `ReplaySubprocessRunner(<dir>)` |
| (nothing) | `defaultSubprocessRunner` |

Setting both capture and replay, or either without `PODKIT_SNAPSHOT_DIR`,
throws — better to fail loudly than to write fixtures into `process.cwd()`
or replay from a nonexistent path.
