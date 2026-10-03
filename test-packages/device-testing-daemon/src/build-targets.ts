/**
 * Which `bun build --compile` targets a daemon build produces.
 *
 * With no target named, the build is for the run's target architecture — the
 * substrate's, via `PODKIT_TARGET_ARCH` — and only falls back to the host's
 * when nothing names one. Building for the host instead leaves whatever
 * binary the target arch last got in `dist/`, and the installer ships it.
 */

import { resolveTargetArch, type TargetArch } from '@podkit/substrate';

export type DaemonBuildTarget = `linux-${TargetArch}`;

const ALL_TARGETS: readonly DaemonBuildTarget[] = ['linux-x64', 'linux-arm64'];

function isDaemonBuildTarget(arg: string): arg is DaemonBuildTarget {
  return (ALL_TARGETS as readonly string[]).includes(arg);
}

export interface ResolveBuildTargetsInput {
  /** The CLI argument: a target, `all`, `auto`, or absent (= `auto`). */
  readonly arg: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly hostArch: string;
}

export function resolveBuildTargets(input: ResolveBuildTargetsInput): DaemonBuildTarget[] {
  const arg = input.arg ?? 'auto';
  if (arg === 'all') return [...ALL_TARGETS];
  if (arg === 'auto') {
    const { arch } = resolveTargetArch({ env: input.env, hostArch: input.hostArch });
    return [`linux-${arch}`];
  }
  if (isDaemonBuildTarget(arg)) return [arg];
  throw new Error(`unknown target '${arg}'. Use ${ALL_TARGETS.join(' | ')} | all | auto.`);
}
