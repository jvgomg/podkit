/**
 * Argument parsing for the dummy-hcd daemon.
 *
 * Intentionally tiny — no `commander`/`yargs` dependency to keep the
 * compiled binary as small as possible. We accept:
 *
 *   --persona <id>       (required) id of the persona to serve
 *   --sidecar <path>     (default `/var/device-testing/personas.json`)
 *   --gadget-name <id>   (default `podkit-test`) configfs directory name
 *   --ffs-mount <path>   (default `/dev/ffs-podkit`) FunctionFS mountpoint
 *   --dry-run            parse the sidecar then exit; no configfs writes
 *   --help / -h          print usage and exit 0
 *
 * Unknown flags exit with a non-zero status and a usage hint.
 *
 * @module
 */

/** Default location of the persona registry sidecar inside the test VM. */
export const DEFAULT_SIDECAR_PATH = '/var/device-testing/personas.json';
// The defaults below are convenient single-daemon values for ad-hoc CLI use.
// The production systemd template `dummy-hcd-daemon@.service` always passes
// `--gadget-name podkit-<persona>` and `--ffs-mount /dev/ffs-podkit-<persona>`
// so two units can run in parallel without colliding on either kernel
// resource — see `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service`.
/** Default name of the configfs gadget directory. */
export const DEFAULT_GADGET_NAME = 'podkit-test';
/** Default FunctionFS mountpoint. */
export const DEFAULT_FFS_MOUNT = '/dev/ffs-podkit';

/** Parsed daemon flags. */
export interface CliOptions {
  persona: string;
  sidecar: string;
  gadgetName: string;
  ffsMount: string;
  dryRun: boolean;
}

/**
 * Result of parsing the daemon's argv. The shape lets `main.ts` decide
 * whether to short-circuit (help / version / error) without coupling it
 * to a particular exit-code path.
 */
export type CliParseResult =
  | { kind: 'help'; usage: string }
  | { kind: 'error'; message: string; usage: string }
  | { kind: 'ok'; options: CliOptions };

const USAGE = `Usage: dummy-hcd-daemon --persona <id> [options]

Synthesise an iPod-shaped USB device on dummy_hcd for the named persona.

Options:
  --persona <id>            (required) DevicePersona.id to serve
  --sidecar <path>          Path to personas.json
                            (default: ${DEFAULT_SIDECAR_PATH})
  --gadget-name <name>      configfs gadget directory name
                            (default: ${DEFAULT_GADGET_NAME})
  --ffs-mount <path>        FunctionFS mountpoint
                            (default: ${DEFAULT_FFS_MOUNT})
  --dry-run                 Validate the sidecar then exit (no kernel writes)
  -h, --help                Show this help and exit
`;

/**
 * Parse a daemon argv vector (must NOT include `argv[0]` / `argv[1]`; pass
 * `process.argv.slice(2)`).
 */
export function parseArgs(argv: readonly string[]): CliParseResult {
  let persona: string | undefined;
  let sidecar = DEFAULT_SIDECAR_PATH;
  let gadgetName = DEFAULT_GADGET_NAME;
  let ffsMount = DEFAULT_FFS_MOUNT;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '-h':
      case '--help':
        return { kind: 'help', usage: USAGE };
      case '--persona': {
        const next = argv[++i];
        if (next === undefined) {
          return error('--persona requires a value');
        }
        persona = next;
        break;
      }
      case '--sidecar': {
        const next = argv[++i];
        if (next === undefined) return error('--sidecar requires a value');
        sidecar = next;
        break;
      }
      case '--gadget-name': {
        const next = argv[++i];
        if (next === undefined) return error('--gadget-name requires a value');
        gadgetName = next;
        break;
      }
      case '--ffs-mount': {
        const next = argv[++i];
        if (next === undefined) return error('--ffs-mount requires a value');
        ffsMount = next;
        break;
      }
      case '--dry-run':
        dryRun = true;
        break;
      default:
        if (arg.startsWith('--persona=')) {
          persona = arg.slice('--persona='.length);
        } else if (arg.startsWith('--sidecar=')) {
          sidecar = arg.slice('--sidecar='.length);
        } else if (arg.startsWith('--gadget-name=')) {
          gadgetName = arg.slice('--gadget-name='.length);
        } else if (arg.startsWith('--ffs-mount=')) {
          ffsMount = arg.slice('--ffs-mount='.length);
        } else {
          return error(`unknown argument: ${arg}`);
        }
    }
  }

  if (persona === undefined || persona.length === 0) {
    return error('--persona is required');
  }
  return { kind: 'ok', options: { persona, sidecar, gadgetName, ffsMount, dryRun } };
}

function error(message: string): CliParseResult {
  return { kind: 'error', message, usage: USAGE };
}
