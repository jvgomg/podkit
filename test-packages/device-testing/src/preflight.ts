/**
 * Preflight probe for the device substrate. Wired into bunfig.toml as a
 * `[test].preload` so it runs once per `bun test` invocation in any package
 * that targets VM tests. Exits 0 when the substrate is reachable AND answering
 * commands; exits 1 with a multi-line remediation hint otherwise.
 *
 * The readiness probe is not enough on its own. For a Lima substrate it reads
 * Lima's metadata (the instance exists + Lima thinks it is running), and that
 * can be misleading: the box can be "running" while its SSH daemon is not
 * accepting connections (just after boot, after a hibernate). So a `/bin/true`
 * is pushed through the link as well, and the two outcomes are told apart —
 * a thrown `SubstrateLinkError` means the substrate did not answer, while a
 * non-zero exit means it answered and could not run `/bin/true`, which is a
 * different and much stranger fault.
 *
 * Intentionally fail-fast so VM test runs cannot silently no-op when the
 * harness isn't up — the developer either sees green or sees this message
 * with the exact commands to fix it.
 *
 * # USB device-controller budget
 *
 * Reachability is not the only precondition. Personas bind to a fixed number
 * of emulated device controllers, and a daemon killed before it could tear
 * down leaves its binding behind with nothing to release it. Once the last
 * controller is claimed nothing enumerates, and the suite reports that as a
 * timeout in whichever test happened to be running — a message that says
 * nothing about controllers, arriving minutes later.
 *
 * So the budget is counted here too, before a single gadget binds: exhaustion
 * is a hard failure naming every leaked binding, and a leak that has not yet
 * exhausted it is a warning (those release themselves when their own persona
 * next starts). See `runners/lima-test-vm-udc-slots.ts` for why occupancy is
 * read from configfs and never from `/sys/class/udc/<n>/state`.
 *
 * # Self-gating
 *
 * Bun's `[test].preload` fires on every `bun test` invocation in the package,
 * including non-VM unit runs (e.g. `bun test src/__tests__/canary.linux.test.ts`).
 * We must NOT bring down those runs when the VM is offline. The script sniffs
 * `process.argv` and `process.env.npm_lifecycle_event` for VM-test indicators
 * (a `vm/` segment, a `.e2e.` filename, or a `test:vm` lifecycle event); if
 * none match, the module does nothing at all and simply finishes — it must
 * NOT call `process.exit()` in that branch. A preload that terminates the
 * process (even with code 0) aborts the whole `bun test` run before any test
 * file loads, which previously made every unit test in this package silently
 * non-executing under `test:unit` while still reporting a clean pass. See
 * `scripts/assert-min-tests.ts` for the guard that now catches a regression
 * of that shape.
 *
 * @see docs/adr/adr-016-linux-vm-test-harness.md
 * @module
 */

import { isSubstrateLinkError, type SubstrateLink, type VmDefinition } from '@podkit/substrate';

import {
  formatUdcSlotFailure,
  formatUdcSlotShortfall,
  formatUdcSlotSummary,
  formatUdcSlotWarning,
  probeUdcSlots,
} from './runners/lima-test-vm-udc-slots.js';
import { probeSubstrate, resolveDeviceSubstrate } from './runners/substrate.js';

/** Bound for the liveness probe. `/bin/true` over a healthy link is instant. */
const LIVENESS_PROBE_TIMEOUT_MS = 30_000;

function vmTestsTargeted(): boolean {
  // `test:e2e:docker-dist` is the local-only Docker Tier-5 run (the shipped
  // Docker distribution image, in `src/vm-docker/`); it drives the VM just like
  // `test:vm`, so it must gate the same way (its files live in the `vm-docker`
  // directory, not `vm/`, and would otherwise slip past the argv sniff). The
  // `vm-docker` surface is distinct from `@podkit/e2e-tests`'s `docker-source`
  // files, which use a separate preflight.
  if (process.env.npm_lifecycle_event === 'test:vm') return true;
  if (process.env.npm_lifecycle_event === 'test:e2e:docker-dist') return true;
  // Match `vm/`, a trailing `/vm` (or bare `vm`) path segment, any `.e2e.`
  // filename, and a `vm-docker` path segment (`bun test src/vm-docker`
  // invoked directly without npm). The trailing-segment variant catches
  // `bun test src/vm` — `argv` then contains `src/vm` with no trailing slash,
  // which a naive `includes('vm/')` would miss.
  const VM_PATH_RE = /(^|\/)vm(\/|$)/;
  return process.argv.some(
    (arg) => VM_PATH_RE.test(arg) || arg.includes('.e2e.') || arg.includes('vm-docker')
  );
}

// Bun's `[test].preload` runs this module to completion (or to a thrown
// error / process.exit()) *before* it loads a single test file. There is no
// way to "skip forward" from here — whatever we do or don't do next is the
// only thing standing between this invocation and bun's test loader. A
// preload that calls `process.exit()` unconditionally (even with code 0)
// terminates the entire `bun test` process, unit tests included, and every
// package that preloads this module inherits that outcome. So the guard
// below is written the other way around from a typical early-return: do
// nothing at all — no Lima contact, no exit call — unless VM tests are
// actually targeted. Falling off the end of the module is what lets bun
// proceed to load test files normally.
if (vmTestsTargeted()) {
  const REMEDIATION = [
    '',
    'To bring the substrate up:',
    '  bun run vm:up device          (create or resume the Lima substrate)',
    '  bun run harness:setup         (first-time setup: creates it, builds + installs binaries)',
    '  bun run harness:status        (see exactly what state things are in)',
    '',
    'Then re-run `bun run test:vm`.',
    '',
    'VM tests refuse to silently skip — bring the substrate up or invoke a different test script (`bun run test:unit`, `bun run test:integration`).',
    '',
  ].join('\n');

  // The explicit type annotation on the CONST is what makes TypeScript treat a
  // call to this as terminating control flow. Annotating only the arrow's
  // return type does not: the compiler's never-returning-call analysis keys off
  // the declared type of the variable. Without it, every `bail()` below would
  // have to be followed by dead code to convince the checker.
  const bail: (headline: string) => never = (headline) => {
    process.stderr.write(`[vm-preflight] ${headline}\n${REMEDIATION}`);
    process.exit(1);
  };

  // Resolving the selection here is what renders the resolver's fallback
  // announcement for a VM run: this preload is the first thing every VM suite
  // executes and it owns a TTY, so it is where "you did not choose a substrate,
  // so I used Lima" belongs. The harness singleton memoises the same
  // resolution, so nothing says it twice.
  let definition: VmDefinition;
  let link: SubstrateLink;
  try {
    ({ definition, link } = resolveDeviceSubstrate({
      notice: (line) => process.stderr.write(`[vm-preflight] ${line}\n`),
    }));
  } catch (err) {
    // An unconfigured machine is an onboarding state, and the resolver's error
    // message IS the onboarding instruction — pass it through rather than
    // replacing it with a generic one.
    bail(err instanceof Error ? err.message : String(err));
  }

  const readiness = await probeSubstrate(definition);
  if (readiness === 'unreachable') {
    bail(`substrate '${definition.id}' (${link.description}) is not reachable.`);
  }
  if (readiness === 'startable') {
    bail(`substrate '${definition.id}' (${link.description}) exists but is not running.`);
  }

  // Readiness says the box is up; it does not say the box will run a command.
  // A Lima instance reports `running` while its SSH daemon is still refusing
  // connections just after boot, which would otherwise fail in `beforeAll`.
  try {
    const probe = await link.exec(['/bin/true'], { timeoutMs: LIVENESS_PROBE_TIMEOUT_MS });
    if (probe.exitCode !== 0) {
      // The substrate answered and `/bin/true` still failed. That is not a
      // reachability problem — it is a broken userland, and saying "SSH is
      // refusing" here (as this did before the link could tell the two apart)
      // sent readers to look at the wrong thing.
      bail(
        `substrate '${definition.id}' (${link.description}) answered but could not run ` +
          `/bin/true: exit=${probe.exitCode}: ${probe.stderr.trim() || '(no output)'}`
      );
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    bail(
      isSubstrateLinkError(err)
        ? `substrate '${definition.id}' did not answer: ${why}`
        : `probing substrate '${definition.id}' failed: ${why}`
    );
  }

  // Personas bind to a fixed number of emulated USB device controllers. Once
  // they are all claimed nothing can enumerate, and the suite reports that as a
  // timeout in whichever test happened to be running — a failure that says
  // nothing about controllers and takes a long time to say it. Counting them
  // here, before a single gadget is bound, turns that into one line.
  const slots = await probeUdcSlots({ link }).catch((err: unknown) => {
    process.stderr.write(
      `[vm-preflight] could not read USB controller state (continuing): ` +
        `${err instanceof Error ? err.message : String(err)}\n`
    );
    return null;
  });

  if (slots) {
    const shortfall = formatUdcSlotShortfall(slots);
    if (shortfall) process.stderr.write(`[vm-preflight] ${shortfall}\n`);

    const failure = formatUdcSlotFailure(slots);
    if (failure) {
      process.stderr.write(
        `[vm-preflight] ${failure}\n\n` +
          'To rebuild a Lima substrate from scratch:\n' +
          '  bun run vm:recover device     (destroy → recreate → start)\n' +
          '  bun run harness:setup         (reinstall binaries + seal the baseline)\n\n' +
          'Then re-run `bun run test:vm`.\n'
      );
      process.exit(1);
    }

    const warning = formatUdcSlotWarning(slots);
    if (warning) process.stderr.write(`[vm-preflight] ${warning}\n`);
    process.stdout.write(`[vm-preflight] ${formatUdcSlotSummary(slots)}\n`);
  }

  process.stdout.write(`[vm-preflight] substrate '${definition.id}' ready.\n`);
}
// else: no VM tests in this invocation — module falls off the end here.
// Unit/integration runs proceed without resolving or contacting a substrate.
