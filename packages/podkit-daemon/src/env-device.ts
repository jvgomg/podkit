/**
 * ENV-declared mass-storage device — daemon side.
 *
 * The CLI owns the full declaration (`PODKIT_DEVICE_PATH` + `PODKIT_DEVICE_TYPE`
 * + `PODKIT_DEVICE_NAME` → a config device entry with its preset; see the CLI's
 * env-device mapper). The daemon only needs the declared path so it can poll it
 * for appearance and hand it to `podkit sync` — the CLI child inherits the same
 * environment and matches the path back to the declared device, applying the
 * preset. Keeping this to path extraction avoids a second full parser drifting
 * from the CLI's.
 *
 * Env var names must stay in sync with the CLI's ENV_KEYS
 * (packages/podkit-cli/src/config/defaults.ts).
 */

export type EnvDeviceResult =
  | { kind: 'declared'; path: string }
  | { kind: 'invalid-ipod-type' }
  | { kind: 'none' };

/**
 * Extract the ENV-declared mass-storage device path to poll.
 *
 * An ipod-typed declaration is a misconfiguration the CLI rejects loudly on
 * every invocation; the daemon reports it distinctly so the caller can warn
 * instead of silently not polling.
 */
export function massStorageEnvDevice(env: Record<string, string | undefined>): EnvDeviceResult {
  const path = env['PODKIT_DEVICE_PATH']?.trim();
  if (!path) return { kind: 'none' };
  if (env['PODKIT_DEVICE_TYPE']?.trim() === 'ipod') return { kind: 'invalid-ipod-type' };
  return { kind: 'declared', path };
}
