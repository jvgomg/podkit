// Subprocess probe used by `no-fs-at-load.test.ts`.
//
// Intercepts `fs.readFileSync` / `fs.readFile` / `fs.promises.readFile` via
// `Object.defineProperty` (Bun marks the export bindings read-only, so plain
// assignment throws). Records every call, then imports the persona registry
// and prints a JSON report on stdout.
//
// Lives next to the test (rather than in `scripts/`) so anyone touching the
// persona load contract sees both files at once.

import * as fs from 'node:fs';

const calls = [];

function patch(obj, name, label) {
  const original = obj[name];
  if (typeof original !== 'function') return;
  const wrapper = function (...args) {
    calls.push(`${label}:${String(args[0])}`);
    return original.apply(this, args);
  };
  try {
    Object.defineProperty(obj, name, {
      configurable: true,
      writable: true,
      value: wrapper,
    });
  } catch {
    // Best-effort — if the runtime really refuses, the test will surface
    // it as a failed probe rather than a silent miss.
  }
}

patch(fs, 'readFileSync', 'sync');
patch(fs, 'readFile', 'async');
if (fs.promises) {
  patch(fs.promises, 'readFile', 'promises');
}

const mod = await import('./index.ts');

console.log(
  JSON.stringify({
    calls,
    personaCount: mod.personas.size,
  })
);
