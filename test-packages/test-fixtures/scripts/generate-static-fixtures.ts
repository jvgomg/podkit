#!/usr/bin/env bun
/**
 * Generate the static fixture sets shipped by @podkit/test-fixtures.
 *
 * Usage:
 *
 *   bun run generate-static-fixtures              # generate every set
 *   bun run generate-static-fixtures --only video # generate one set
 *   bun run generate-static-fixtures --only multi-format,goldberg-selections
 *
 * Outputs land under `test-packages/test-fixtures/fixtures/` — that directory
 * is gitignored. Turbo treats this task as cacheable on the generator source
 * tree, so subsequent runs are a no-op until the recipes change.
 */

import {
  generateAllStaticFixtures,
  STATIC_FIXTURE_GENERATORS,
  type StaticFixtureSet,
} from '../src/static/index.js';

const VALID_SETS = Object.keys(STATIC_FIXTURE_GENERATORS) as StaticFixtureSet[];

interface ParsedArgs {
  only?: StaticFixtureSet[];
  help: boolean;
}

function printUsage(): void {
  console.log(`Usage: bun run generate-static-fixtures [options]

Generate the static audio + video fixture sets used by integration and e2e
tests across the monorepo. Output lands under
  test-packages/test-fixtures/fixtures/

Options:
  --only <sets>   Generate only the named set(s). Comma-separated.
                  Valid sets: ${VALID_SETS.join(', ')}
  -h, --help      Show this help message

Examples:
  bun run generate-static-fixtures
  bun run generate-static-fixtures --only video
  bun run generate-static-fixtures --only multi-format,goldberg-selections`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const parsed: ParsedArgs = { help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }

    if (arg === '--only') {
      i++;
      const value = args[i];
      if (!value || value.startsWith('--')) {
        console.error('Error: --only requires a comma-separated list of set names.');
        process.exit(1);
      }
      const sets = value.split(',').map((s) => s.trim());
      for (const s of sets) {
        if (!VALID_SETS.includes(s as StaticFixtureSet)) {
          console.error(
            `Error: '${s}' is not a known fixture set. Valid sets: ${VALID_SETS.join(', ')}`
          );
          process.exit(1);
        }
      }
      parsed.only = sets as StaticFixtureSet[];
      continue;
    }

    console.error(`Error: unknown option '${arg}'.`);
    printUsage();
    process.exit(1);
  }

  return parsed;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  const start = Date.now();

  if (parsed.only && parsed.only.length > 0) {
    console.log(`Generating fixture sets: ${parsed.only.join(', ')}`);
    await Promise.all(parsed.only.map((set) => STATIC_FIXTURE_GENERATORS[set]()));
  } else {
    console.log('Generating all static fixture sets...');
    await generateAllStaticFixtures();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
