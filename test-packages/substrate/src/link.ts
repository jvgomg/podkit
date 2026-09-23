/**
 * `SubstrateLink` — how commands and files reach a substrate.
 *
 * Five operations cover everything this repo does to a box it drives: run
 * something (`exec`), put a file there (`copyIn`), take one back (`copyOut`),
 * put a source tree there (`stageTree`), and hold a handle on something
 * long-lived (`spawn`). Every helper in the harness and every build job is
 * written against this interface and against nothing else, which is what makes
 * a Lima VM on macOS and an SSH-reachable Debian box on a hypervisor the same
 * code path rather than two separately-correct implementations (ADR-028 §1).
 *
 * The word is deliberately not *transport*: in podkit that already means how
 * the product reaches an iPod's firmware (USB vs SCSI), and both meanings would
 * otherwise appear in the same test files. See `CONTEXT.md` §"Test
 * environments".
 *
 * ## Why link failure is a throw and guest failure is a return
 *
 * `limactl shell` and `ssh` both return the GUEST command's exit code, so the
 * naked exit code cannot tell "the box did not answer" from "the command the
 * box ran said no". Four call sites in the harness used to carry comments
 * asserting that distinction, and none of them could actually make it.
 *
 * The distinction is load-bearing: an unreachable substrate must be a skip with
 * a reason, and a failed guest command must be a failure (ADR-028 §2, §5). So
 * {@link SubstrateLink.exec} THROWS {@link SubstrateLinkError} when the link
 * itself failed and RETURNS a {@link SubstrateExecResult} — non-zero exit codes
 * included — whenever the guest actually ran something.
 *
 * How each implementation recognises its own failures is its business; the
 * vocabulary every SSH-carried link shares lives here as
 * {@link looksLikeSshLinkFailure}.
 *
 * ## Why `copyOut` and `stageTree` exist now, and did not before
 *
 * This interface was `exec` / `copyIn` / `spawn`, and said so: transfers were
 * host→guest only because a *device* substrate receives artifacts and never
 * sends any, and an unused direction is a second implementation to keep
 * correct for free.
 *
 * A **build host** is the other half of that sentence. It is reached over the
 * same link and by the same two provisioners, and its entire purpose is to
 * produce bytes the host has to collect — so the direction stopped being
 * unused. {@link SubstrateLink.copyOut} is that, and nothing more; the device
 * substrate's no-source-tree, no-host-mount invariant is unchanged, because
 * nothing points these two operations at it.
 *
 * {@link SubstrateLink.stageTree} is here for a sharper reason: it is the ONE
 * operation whose mechanism genuinely differs by provisioner. Lima mounts the
 * host's home into the guest, so staging is an in-guest rsync from that mount;
 * every other substrate has no mount, so staging is a host-side `rsync -e ssh`
 * that pushes over the link. A driver written against this interface is blind
 * to which of those it got, which is what makes "builder is a role" true
 * rather than aspirational (ADR-029 §4).
 *
 * ## There is no stdin channel, on purpose
 *
 * `limactl shell` does not reliably forward stdin to the guest command, which
 * is why the harness historically ran a `printf … | sudo tee` dance at every
 * transfer. Adding an `input` option would work over SSH and silently
 * half-work over `limactl`, which is the worst of the two: the harness would
 * fork by provisioner exactly where it is meant not to. {@link
 * SubstrateLink.copyIn} covers every real need — including "write these bytes
 * to a root-owned path", via a host temp file — so the interface routes around
 * the constraint instead of inheriting it or pretending it is gone.
 *
 * @module
 */

import type { Readable } from 'node:stream';

// Type-only, so there is no runtime edge back: `./stage-tree.js` imports
// `shellQuote` from here, and erasing this import is what keeps that from
// being a cycle.
import type { StageTreeOpts } from './stage-tree.js';

/**
 * What to run in the guest.
 *
 * - A **string** is a `/bin/sh` command line, and is the only form that honours
 *   {@link SubstrateExecOpts.cwd} and {@link SubstrateExecOpts.env} directly.
 * - An **argv vector** is executed without a shell, which is what the harness
 *   wants for `sudo install …`-shaped calls: no quoting surface at all.
 *
 * Both forms accept `cwd`/`env`; the argv form is shell-quoted into a command
 * line when either is supplied, so the two never diverge in behaviour.
 */
export type SubstrateCommand = string | readonly string[];

/** Options honoured by {@link SubstrateLink.exec}. */
export interface SubstrateExecOpts {
  /** Working directory inside the guest. */
  cwd?: string;
  /** Environment variables exported in the guest before the command runs. */
  env?: Record<string, string>;
  /**
   * Host-side wall-clock bound in milliseconds. Omitted means "wait forever",
   * which is only appropriate for genuinely open-ended work. Anything on a
   * per-test hot path SHOULD pass one: a link opens an SSH session, and an SSH
   * session that never completes its handshake blocks the caller with no upper
   * limit.
   */
  timeoutMs?: number;
}

/** Outcome of a guest command that actually ran. */
export interface SubstrateExecResult {
  stdout: string;
  stderr: string;
  /**
   * The GUEST command's exit code. Never the link's — a link that could not
   * deliver the command throws {@link SubstrateLinkError} instead of
   * manufacturing an exit code the guest never produced.
   */
  exitCode: number;
}

/**
 * Bound for a single-file copy over a link, in either direction.
 *
 * The payload is one file, not a tree, and the largest one this repo moves is
 * a compiled podkit binary — around 120 MB. Measured over the Lima SSH
 * loopback, 118 MB moves in ~0.7s in either direction (~170 MB/s), so the
 * transfer itself is never the reason a copy would be slow.
 *
 * The bound is therefore sized off a throughput FLOOR rather than the measured
 * figure: 1 MB/s, roughly two orders of magnitude below measured, which is
 * what a host deep in swap with a contended SSH channel looks like. That gives
 * 120s for a 120 MB payload, plus 30s of headroom for the handshake in front
 * of it. Anything past that is a wedged session, not a slow copy.
 *
 * It lives beside the interface rather than beside either implementation
 * because both now move artifacts, and a second derivation of the same figure
 * is the thing this constant exists to prevent.
 */
export const FILE_COPY_TIMEOUT_MS = 150_000;

/** Options for {@link SubstrateLink.copyIn}. */
export interface SubstrateCopyOpts {
  /** Host-side wall-clock bound in milliseconds. */
  timeoutMs?: number;
}

/** Options for {@link SubstrateLink.spawn}. */
export interface SubstrateSpawnOpts {
  /** Working directory inside the guest. */
  cwd?: string;
  /** Environment variables exported in the guest before the command runs. */
  env?: Record<string, string>;
  /**
   * Whether to capture the guest's output streams. `pipe` (the default) gives
   * the caller readable `stdout`/`stderr`; `ignore` discards both.
   */
  stdio?: 'pipe' | 'ignore';
}

/** How a spawned guest process finished, as observed from the host. */
export interface SubstrateExitStatus {
  /** Exit code of the host-side link process, which mirrors the guest's. */
  exitCode: number | null;
  /** Signal that killed the HOST-side link process, if any. */
  signal: NodeJS.Signals | null;
}

/**
 * Handle on a long-lived guest process.
 *
 * ## Teardown contract — read this before relying on `kill()`
 *
 * `kill()` terminates the HOST-side link process (the `limactl shell` or `ssh`
 * that is proxying the session). What happens to the guest process is then up
 * to sshd: closing the channel sends SIGHUP to the guest session leader, which
 * is usually enough, and is exactly what the harness relied on when it spawned
 * `limactl` by hand. It is NOT a guarantee — a guest process that ignores
 * SIGHUP, or that `setsid`-detached itself out of the session, survives.
 *
 * So this is a handle, not a supervisor, and the asymmetry is deliberate: a
 * `kill()` that pretended to be authoritative would have to round-trip a
 * guest-side `kill` through {@link SubstrateLink.exec}, which is asynchronous,
 * racy against a process that has already exited, and impossible to express in
 * a synchronous method. Callers that need DETERMINISTIC guest teardown kill
 * in-guest through `exec` and then await {@link exited} — which is why the
 * pre-sync-sweep suite kills `podkit-debug` by name rather than trusting the
 * handle alone. That is the contract working, not a workaround for it.
 */
export interface SubstrateProcess {
  /**
   * Host-side pid of the link process. NEVER the guest's pid — nothing on the
   * host can address a guest pid, and treating one as the other is how a
   * `kill` lands on an unrelated process.
   */
  readonly pid: number | undefined;
  /** Guest stdout, or `null` when `stdio: 'ignore'`. */
  readonly stdout: Readable | null;
  /** Guest stderr, or `null` when `stdio: 'ignore'`. */
  readonly stderr: Readable | null;
  /** Resolves when the host-side link process closes. Never rejects. */
  readonly exited: Promise<SubstrateExitStatus>;
  /** Terminate the host-side link process. See the teardown contract above. */
  kill(signal?: NodeJS.Signals): void;
}

/**
 * How commands and files reach a substrate. Two implementations: `limactl`
 * (the Lima provisioner's own channel) and `ssh` (every other substrate).
 */
export interface SubstrateLink {
  /** Registry id of the substrate this link reaches. */
  readonly substrateId: string;
  /**
   * One-line description for error messages, naming both the substrate and how
   * it is reached — e.g. ``Lima instance `podkit-device` `` or
   * ``ssh_config alias `podkit-substrate` ``. Errors that name only the box
   * leave the reader guessing which of two links was in play.
   */
  readonly description: string;
  /**
   * Run a command in the guest.
   *
   * @returns the guest's `{stdout, stderr, exitCode}`, non-zero exits included.
   * @throws {SubstrateLinkError} when the LINK failed — the substrate is not
   * running, refused the connection, or the link binary is missing. Never for
   * a guest command that merely exited non-zero.
   */
  exec(command: SubstrateCommand, opts?: SubstrateExecOpts): Promise<SubstrateExecResult>;
  /**
   * Copy one host file to an absolute guest path.
   *
   * @throws {SubstrateLinkError} on link failure, and a plain `Error` when the
   * copy itself failed (no such file, permission denied at the destination).
   */
  copyIn(hostPath: string, guestPath: string, opts?: SubstrateCopyOpts): Promise<void>;
  /**
   * Copy one file OUT of the guest to an absolute host path.
   *
   * The build-host direction. A device substrate is never asked for one; see
   * the note at the top of this module for why the direction exists at all.
   *
   * @throws {SubstrateLinkError} on link failure, and a plain `Error` when the
   * copy itself failed (no such file in the guest, unwritable destination).
   */
  copyOut(guestPath: string, hostPath: string, opts?: SubstrateCopyOpts): Promise<void>;
  /**
   * Put a host source tree at an absolute guest path, minus the artefacts a
   * build must never inherit from the host.
   *
   * The one operation whose *mechanism* differs per provisioner — see the note
   * at the top of this module. Callers state what they are staging and where;
   * how the bytes travel is the link's business.
   *
   * Semantics are rsync's: `--delete`, so the destination ends up matching the
   * source, and the shared exclude floor in `./stage-tree.ts` always applies
   * with the caller's `excludes` on top of it.
   *
   * @throws {SubstrateLinkError} on link failure, and a plain `Error` when
   * rsync itself failed with anything but the tolerated vanished-file code.
   */
  stageTree(hostSrc: string, guestDest: string, opts?: StageTreeOpts): Promise<void>;
  /**
   * Start a guest process and hand back a handle on it. Synchronous, because
   * the caller wants the handle before the process finishes — that is the
   * whole point.
   *
   * Link failures surface on {@link SubstrateProcess.exited} rather than as a
   * throw, since there is nothing to throw from: the host-side spawn succeeds
   * long before the link discovers the substrate is unreachable.
   */
  spawn(command: SubstrateCommand, opts?: SubstrateSpawnOpts): SubstrateProcess;
}

/**
 * The link itself failed — distinct from a guest command that ran and exited
 * non-zero.
 *
 * This is the type the harness branches on to decide between "skip, the
 * substrate is unavailable" and "fail, the thing under test is broken"
 * (ADR-028 §2). Everything a reader needs to tell those apart is on the
 * instance rather than in the message, so no caller has to string-match.
 */
/**
 * Which link operation failed. Every operation that can fail *because the box
 * did not answer* is here; `spawn` is absent because its link failures surface
 * on {@link SubstrateProcess.exited} rather than as a throw.
 */
export type SubstrateLinkOperation = 'exec' | 'copyIn' | 'copyOut' | 'stageTree';

export class SubstrateLinkError extends Error {
  /** Registry id of the substrate that could not be reached. */
  readonly substrateId: string;
  /** Which link operation failed. */
  readonly operation: SubstrateLinkOperation;

  constructor(opts: {
    substrateId: string;
    operation: SubstrateLinkOperation;
    message: string;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'SubstrateLinkError';
    this.substrateId = opts.substrateId;
    this.operation = opts.operation;
  }
}

/**
 * Wrap a non-zero GUEST exit into a descriptive `Error`.
 *
 * The counterpart to {@link SubstrateLinkError} and the reason callers rarely
 * need to construct either by hand: a link failure throws itself, and this is
 * the one shape for everything else. `prefix` names what was being attempted
 * and where; the exit code and the guest's own output are appended in a fixed
 * order so failures across the harness read alike in a log.
 *
 * stderr leads because that is where a Unix tool says why. stdout is the
 * fallback for the ones that do not, and the `(no output, exit=N)` placeholder
 * exists because "exit=1" and nothing else is the log line that sends a reader
 * to open a shell on the substrate.
 */
export function guestCommandError(prefix: string, result: SubstrateExecResult): Error {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const tail = stderr || stdout || `(no output, exit=${result.exitCode})`;
  return new Error(`${prefix}: exit=${result.exitCode}: ${tail}`);
}

/**
 * Turn a non-zero result from a copy or a stage into the right error.
 *
 * Every link operation that is not `exec` settles the same way: a zero exit
 * returns, a result the implementation classifies as the link dying becomes a
 * {@link SubstrateLinkError}, and anything else is the guest refusing and
 * becomes a plain `Error`. That ladder existed six times — `copyIn`, `copyOut`
 * and `stageTree` in each of the two links — and the two copies of each drifted
 * apart at exactly the level of detail that matters: which failures are
 * *skippable* (ADR-028 §2, §5).
 *
 * `classify` is the parameter because that is the one genuinely per-link part:
 * limactl has its own fatal vocabulary about Lima INSTANCES on top of the SSH
 * vocabulary underneath, and only it can recognise that.
 */
export function settleLinkResult(opts: {
  result: SubstrateExecResult;
  /** Whether this result is the link dying rather than the guest refusing. */
  classify: (result: SubstrateExecResult) => boolean;
  /** Build this link's failure error. */
  linkFailure: (detail: string) => SubstrateLinkError;
  /** `failed to <what>`, naming both ends. */
  what: string;
}): void {
  if (opts.result.exitCode === 0) return;
  if (opts.classify(opts.result)) {
    throw opts.linkFailure(opts.result.stderr.trim());
  }
  throw new Error(
    `failed to ${opts.what}: exit=${opts.result.exitCode}: ` +
      (opts.result.stderr.trim() || opts.result.stdout.trim() || '(no output)')
  );
}

/** Whether `err` is a link failure. Narrows, so callers do not string-match. */
export function isSubstrateLinkError(err: unknown): err is SubstrateLinkError {
  return err instanceof SubstrateLinkError;
}

/**
 * Recognise the rejection a `SubprocessRunner` produces when a caller's
 * `timeoutMs` fired, so the caller can replace it with a message that names
 * the bound.
 *
 * It lives here rather than beside either link because both need it and
 * neither owns it: `execFile` kills the child on timeout, so its rejection is
 * a generic "killed"/`SIGTERM` with no mention of the bound that was exceeded,
 * and a bound that fires anonymously is most of the way back to having no
 * bound at all. Two copies of that predicate is two places for it to drift on
 * exactly the runner detail it exists to paper over.
 *
 * The streaming runner settles on its own timer rather than on the child's
 * `close` (a grandchild holding the pipes open would otherwise defer the
 * rejection past the deadline), so its rejection is a plain `Error` with
 * neither `killed` nor `signal` set. Recognise it by the vocabulary it
 * produces, so both runners reach the same descriptive message.
 */
export function isTimeoutRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { killed?: boolean; signal?: string | null; message?: string };
  if (candidate.killed === true) return true;
  if (candidate.signal === 'SIGTERM' || candidate.signal === 'SIGKILL') return true;
  return typeof candidate.message === 'string' && /timed out after \d+ms/.test(candidate.message);
}

/**
 * Recognise the diagnostics an SSH channel emits when it could not carry a
 * command at all. Shared by both implementations because both are SSH
 * underneath — `limactl shell` execs `ssh` with a generated config.
 *
 * This is a HEURISTIC over stderr and is documented as one. The exit code
 * cannot answer the question (it belongs to the guest), and no version of
 * either tool reports "I could not connect" out of band. A miss degrades to
 * the old behaviour — the failure is reported as the guest's — rather than to
 * anything unsafe.
 *
 * Prefer {@link looksLikeLinkFailureResult} at a call site that has a whole
 * result: the extra evidence it uses is what keeps a guest-side `ssh`, `scp`
 * or `rsync` failing against a THIRD host from being read as this link dying.
 */
export function looksLikeSshLinkFailure(stderr: string): boolean {
  return SSH_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr));
}

/**
 * Whether a whole result looks like the link died rather than the guest
 * refusing — the form every call site should use.
 *
 * Two pieces of evidence, and the second is what the bare stderr predicate
 * cannot supply: **a link that never carried the command produced no guest
 * output**, because there was no guest to produce any. A command that printed
 * something and then failed talking to a third host over its own SSH — the
 * one realistic way {@link looksLikeSshLinkFailure}'s vocabulary appears from
 * inside a healthy substrate — is therefore not mistaken for an unreachable
 * substrate, which would turn a real failure into a skipped test.
 *
 * The residual gap is a guest command that prints ssh's connection vocabulary
 * on stderr and nothing at all on stdout. Closing it would need a channel
 * neither tool offers; the trade is documented rather than hidden.
 */
export function looksLikeLinkFailureResult(result: SubstrateExecResult): boolean {
  return result.stdout.trim() === '' && looksLikeSshLinkFailure(result.stderr);
}

const SSH_FAILURE_PATTERNS: readonly RegExp[] = [
  // Every pattern here is anchored on vocabulary the SSH CLIENT emits about
  // ITSELF, never on a bare phrase a guest command could also print. That
  // restraint is the difference between a useful classifier and a wrong one:
  // `systemctl` reporting `Failed to reload daemon: Connection refused` is the
  // guest saying no, and a matcher looking for "Connection refused" alone would
  // call it an unreachable substrate and turn a real failure into a skip.
  //
  // Could not open a session at all. `ssh: connect to host …` is ssh's own
  // prefix and covers refused, timed out and no-route alike.
  /\bssh: connect to host\b/,
  /\bssh: Could not resolve hostname\b/,
  // Handshake failures: the daemon is there but the session never opened.
  /\bssh_exchange_identification:/,
  /\bkex_exchange_identification:/,
  /\bHost key verification failed\b/,
  /\bPermission denied \(publickey/,
  // Session died mid-command. Both carry ssh's `<host> port <n>` framing, which
  // is what keeps them off a guest's own socket errors.
  /\bConnection closed by \S+ port \d+/,
  /\bConnection reset by \S+ port \d+/,
  /\bclient_loop: send disconnect\b/,
  // scp's own transfer-level abort.
  /\blost connection\b/,
];

/**
 * Minimal POSIX shell quoting — wraps the value in single quotes and escapes
 * embedded single quotes.
 *
 * Lives here rather than in a provisioner package because nothing about
 * quoting a `/bin/sh` word is Lima-specific; `@podkit/lima` re-exports it so
 * its existing import sites resolve unchanged.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Fold `cwd` and `env` into a single `/bin/sh` command line.
 *
 * The one definition of this. It used to exist twice — verbatim — in
 * `@podkit/lima`'s transport and in the device harness's runner, which is how
 * two callers of "the same" primitive can drift on something as load-bearing
 * as env quoting without anything noticing.
 *
 * Variable names are validated rather than quoted: `export` takes a NAME on
 * its left-hand side, so a name needing quotes is a caller bug, and silently
 * producing `export 'bad-name'=…` would be a shell syntax error at the far
 * end of a link with no useful diagnostic.
 */
export function wrapGuestCommand(
  command: string,
  opts: Pick<SubstrateExecOpts, 'cwd' | 'env'> = {}
): string {
  const segments: string[] = [];
  if (opts.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`substrate exec env: invalid variable name '${key}'`);
      }
      segments.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  if (opts.cwd) {
    segments.push(`cd ${shellQuote(opts.cwd)}`);
  }
  segments.push(command);
  return segments.join('; ');
}

/**
 * Normalise a {@link SubstrateCommand} into the argv a link should carry.
 *
 * Shared by both implementations so the string/argv rule is stated once:
 *
 * - argv with no `cwd`/`env` → carried verbatim, no shell anywhere.
 * - anything else → a `sh -c` wrapper, with an argv vector shell-quoted word
 *   by word first so adding a `cwd` never changes how a command parses.
 */
export function resolveGuestArgv(
  command: SubstrateCommand,
  opts: Pick<SubstrateExecOpts, 'cwd' | 'env'> = {}
): readonly string[] {
  const needsShell =
    typeof command === 'string' || opts.cwd !== undefined || opts.env !== undefined;
  if (!needsShell) return command;
  const line = typeof command === 'string' ? command : command.map(shellQuote).join(' ');
  return ['sh', '-c', wrapGuestCommand(line, opts)];
}

/**
 * Render a {@link SubstrateCommand} for an error message, truncated.
 *
 * The bound is not cosmetic. Some guest commands are multi-hundred-character
 * generated shell scripts (the backing-file synthesis recipes), and an
 * unbounded render put the whole script into the message — twice, once from
 * the underlying runner's own text and once from the link's. A diagnostic that
 * long is one nobody reads, which loses the sentence that actually said what
 * went wrong.
 */
export function describeGuestCommand(command: SubstrateCommand): string {
  const rendered = typeof command === 'string' ? command : command.join(' ');
  return rendered.length <= COMMAND_ECHO_LIMIT
    ? rendered
    : `${rendered.slice(0, COMMAND_ECHO_LIMIT)}… (${rendered.length} chars)`;
}

/** Enough to recognise the command; short enough to keep the message readable. */
const COMMAND_ECHO_LIMIT = 120;
