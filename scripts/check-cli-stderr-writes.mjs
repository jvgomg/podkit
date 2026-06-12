#!/usr/bin/env bun
/**
 * Convention §2a enforcement (documents/architecture/conventions.md):
 * No direct `process.stdout.write` / `process.stderr.write` inside
 * `packages/podkit-cli/src/commands/`. CLI commands must route output
 * through `OutputContext` (`out.print`, `out.error`, `out.warn`,
 * `out.success`, `out.progress`, etc.).
 *
 * Carve-outs (documented in conventions.md §2a):
 *  - `migrate.ts` — readline-coupled interactive prompts that bind to
 *    a writable stream, not an OutputSink.
 *
 * If you have a new legitimate exception, add it to the ALLOW list AND
 * to conventions.md §2a's carve-outs section.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const COMMANDS_DIR = join(ROOT, 'packages/podkit-cli/src/commands');

/**
 * Files allowed to bypass OutputContext (documented carve-outs).
 *
 * Paths are relative to the repo root so a future
 * `commands/device/migrate.ts` (or any other basename collision) isn't
 * silently exempted — only the exact carve-out file matches.
 */
const ALLOW = new Set([
  // Interactive readline prompts that take a writable stream directly.
  'packages/podkit-cli/src/commands/migrate.ts',
]);

const PATTERN = /process\.(stdout|stderr)\.write/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(COMMANDS_DIR)) {
  const relPath = relative(ROOT, file);
  if (ALLOW.has(relPath)) continue;
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      violations.push(`${relative(ROOT, file)}:${i + 1}: ${lines[i].trim()}`);
    }
    PATTERN.lastIndex = 0; // reset stateful flag
  }
}

if (violations.length > 0) {
  console.error('Convention §2a violation — direct process.stdout/stderr.write in CLI command:');
  console.error('');
  for (const v of violations) console.error(`  ${v}`);
  console.error('');
  console.error(
    'CLI commands must write through OutputContext. See documents/architecture/conventions.md §2a.'
  );
  console.error(
    'If this is a legitimate new carve-out, update both the ALLOW set in this script AND §2a.'
  );
  process.exit(1);
}

console.log(
  `OK — ${walk(COMMANDS_DIR).length} CLI command files scanned, no direct stderr/stdout writes outside ALLOW list.`
);
