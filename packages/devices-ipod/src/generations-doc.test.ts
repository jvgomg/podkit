/**
 * Drift test: pins the generated support-matrix table in
 * `documents/formats/generations.md` to `renderSupportMatrixMarkdown()`.
 *
 * The doc embeds the matrix between `BEGIN GENERATED` / `END GENERATED`
 * markers. If the generation table changes and the doc block is not
 * regenerated (or the block is hand-edited), this test fails — the reference
 * and the code cannot silently diverge (test-pins-contract).
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSupportMatrixMarkdown } from './support.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src → devices-ipod → packages → repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DOC_PATH = resolve(REPO_ROOT, 'documents', 'formats', 'generations.md');

const BEGIN_MARKER = '<!-- BEGIN GENERATED: support-matrix -->';
const END_MARKER = '<!-- END GENERATED: support-matrix -->';

function extractGeneratedRegion(doc: string): string {
  const begin = doc.indexOf(BEGIN_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `generations.md is missing the BEGIN/END generated-content markers ` +
        `(${BEGIN_MARKER} … ${END_MARKER}).`
    );
  }
  return doc.slice(begin + BEGIN_MARKER.length, end).trim();
}

describe('documents/formats/generations.md support matrix', () => {
  it('matches renderSupportMatrixMarkdown() exactly', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    expect(extractGeneratedRegion(doc)).toBe(renderSupportMatrixMarkdown());
  });
});
