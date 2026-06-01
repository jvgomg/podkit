/**
 * VM coverage — plist parser failure stays off process.stderr.
 *
 * Pins the silence: when podkit hits a malformed SysInfoExtended payload
 * during USB inquiry (e.g. a partial USB read on a flaky device), the
 * parser throws cleanly and surfaces the error through the normal JSON
 * envelope — it must NOT write `parser error :` lines (the libxml2
 * signature) or any other parser-internal text directly to stderr,
 * bypassing the OutputContext sinks.
 *
 * History: an earlier SIE read path went through libgpod's native binding,
 * which used libxml2 via koffi. When the SIE was corrupt libxml2 wrote
 * two `parser error :` lines (one per consumer that re-invoked the
 * parser) directly to FD 2 before the doctor output rendered. The SIE
 * path migrated to the hand-rolled pure-TS parser in `@podkit/ipod-firmware`,
 * which removes libxml2 from the picture entirely — but a future port
 * back to a native XML library, or any new native consumer of SIE bytes,
 * could regress. This test pins the silence at the integration boundary.
 *
 * # Persona
 *
 * `malformed-sysinfo` — real iPod 5G Video USB identity (PID 0x1209)
 * synthesised with a 500-byte truncated SIE XML. The classifier accepts
 * the PID as supported and routes to the SIE parser, which throws.
 *
 * # Surfaces exercised
 *
 * `podkit device scan --json` — the most permissive surface; runs against
 * a USB-only persona (no mounted block device required). Goes through
 * USB inquiry → SIE parsing. The exact JSON shape of the scan entry is
 * out of scope for this test (covered by `unsupported-cascade.e2e.test.ts`
 * and `discovery.e2e.test.ts`); the assertion here is structural:
 * **stderr contains no `parser error :` line and no other XML-parser
 * stack-trace text**.
 *
 * @see packages/ipod-firmware/src/plist/parser.ts (parsePlist — the
 *      path under test)
 * @see test-packages/device-testing/src/personas/malformed-sysinfo/persona.ts
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  withPersona,
  runJsonCommand,
  healthy,
  malformedSysinfo,
} from '@podkit/device-testing';

describe('VM: plist parser stderr silence on malformed SIE', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, VM_COLD_TIMEOUT_MS);

    it(
      'device scan on malformed-sysinfo persona emits no parser-error text on stderr',
      async () => {
        const invocation = await withPersona({ persona: malformedSysinfo }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            VM_WARM_TIMEOUT_MS
          )
        );

        // The scan itself must succeed — the parser failure is recoverable
        // (USB-derived identity remains). A non-zero exit would imply a
        // surface-level failure that we'd want to investigate first.
        expect(invocation.exitCode).toBe(0);

        // The silence assertion. The historical libxml2 leak emitted
        // `parser error : ...` lines on FD 2. Neither that exact signature
        // nor any other parsing-internal text may reach stderr.
        expect(invocation.stderr).not.toMatch(/parser error/i);
        // Catch other shapes a native XML library might emit:
        expect(invocation.stderr).not.toMatch(/Premature end of data/i);
        // The hand-rolled parser's own error text — should appear in the
        // JSON envelope's details, not on stderr.
        expect(invocation.stderr).not.toMatch(/plist:/);
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
