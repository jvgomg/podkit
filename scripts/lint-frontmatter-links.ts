#!/usr/bin/env bun
/**
 * Generic bidirectional link linter for markdown files with YAML
 * frontmatter. Driven by a YAML config that declares:
 *
 *   - Categories: directories of markdown files (e.g., principles/,
 *     features/, user-stories/), each with an ID-derivation rule.
 *   - Relations: bidirectional links between categories, where one
 *     file's frontmatter field lists IDs that must appear in the target
 *     files' backref field.
 *
 * Usage: bun run scripts/lint-frontmatter-links.ts <config.yaml>
 *
 * Exit codes:
 *   0  lint passed
 *   1  lint failed (bidirectional links missing or broken)
 *   2  script error (bad config, unreadable files, etc.)
 */

import { readFile } from 'node:fs/promises';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';

// ---------- Types ----------

type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [k: string]: YamlValue };

interface CategoryConfig {
  dir: string;
  'id-from': string; // 'filename' or a frontmatter key
  exclude?: string[];
}

interface RelationConfig {
  from: string;
  via: string;
  to: string;
  backref: string;
}

interface LintConfig {
  root?: string;
  categories: Record<string, CategoryConfig>;
  relations: RelationConfig[];
}

interface FileEntry {
  filepath: string;
  category: string;
  id: string;
  frontmatter: Record<string, YamlValue>;
}

// ---------- Minimal YAML parser ----------
//
// Handles the bounded subset used by our config and frontmatter:
//   - Maps with string keys.
//   - Scalars (strings, numbers, booleans, null).
//   - Block lists ("- item" lines).
//   - List items that are maps (first key on the "- key: value" line,
//     subsequent keys indented).
//   - Inline lists ("[a, b, c]").
//   - Comments (whole-line "#...").
//
// Out of scope: anchors, references, multi-line strings, tags, dates.

interface Line {
  indent: number;
  content: string;
}

function parseYaml(text: string): YamlValue {
  const lines: Line[] = [];
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw)) continue;
    const trimmedRight = raw.replace(/\s+$/, '');
    if (trimmedRight === '') continue;
    const match = trimmedRight.match(/^( *)(.*)$/);
    if (!match) continue;
    lines.push({ indent: match[1].length, content: match[2] });
  }

  let pos = 0;

  function parseBlock(indent: number): YamlValue {
    if (pos >= lines.length) return null;
    if (lines[pos].indent !== indent) return null;
    if (
      lines[pos].content.startsWith('- ') ||
      lines[pos].content === '-'
    ) {
      return parseList(indent);
    }
    return parseMap(indent);
  }

  function parseMap(indent: number): Record<string, YamlValue> {
    const map: Record<string, YamlValue> = {};
    while (pos < lines.length && lines[pos].indent === indent) {
      const line = lines[pos].content;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) break;
      const key = line.slice(0, colonIdx).trim();
      const valuePart = line.slice(colonIdx + 1).trim();
      pos++;
      if (valuePart === '') {
        if (pos < lines.length && lines[pos].indent > indent) {
          map[key] = parseBlock(lines[pos].indent);
        } else {
          map[key] = null;
        }
      } else {
        map[key] = parseInlineValue(valuePart);
      }
    }
    return map;
  }

  function parseList(indent: number): YamlValue[] {
    const list: YamlValue[] = [];
    while (
      pos < lines.length &&
      lines[pos].indent === indent &&
      (lines[pos].content.startsWith('- ') || lines[pos].content === '-')
    ) {
      const itemContent =
        lines[pos].content === '-' ? '' : lines[pos].content.slice(2);
      if (itemContent === '') {
        pos++;
        if (pos < lines.length && lines[pos].indent > indent) {
          list.push(parseBlock(lines[pos].indent));
        } else {
          list.push(null);
        }
      } else if (/^[\w-]+:/.test(itemContent)) {
        // Map item: rewrite this line as the first key of a synthetic
        // map at indent + 2, then let parseMap consume it and any
        // indented continuation lines.
        const itemIndent = indent + 2;
        lines[pos] = { indent: itemIndent, content: itemContent };
        list.push(parseMap(itemIndent));
      } else {
        list.push(parseScalar(itemContent));
        pos++;
      }
    }
    return list;
  }

  function parseInlineValue(s: string): YamlValue {
    if (s.startsWith('[') && s.endsWith(']')) {
      return parseInlineList(s);
    }
    return parseScalar(s);
  }

  function parseInlineList(s: string): YamlValue[] {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((item) => parseScalar(item.trim()));
  }

  function parseScalar(s: string): YamlValue {
    if (s === '' || s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
    if (/^-?\d+$/.test(s)) return Number(s);
    return s;
  }

  return parseBlock(0) ?? {};
}

// ---------- Frontmatter extraction ----------

function extractFrontmatter(text: string): Record<string, YamlValue> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const parsed = parseYaml(match[1]);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, YamlValue>)
    : {};
}

// ---------- File discovery ----------

function listMarkdownFiles(rootDir: string, excludes: string[]): string[] {
  const excludeSet = new Set(excludes.map((e) => e.replace(/\/\*\*$/, '')));
  const result: string[] = [];

  function walk(dir: string, relPrefix: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relPath = relPrefix ? `${relPrefix}/${entry}` : entry;
      if (excludeSet.has(entry) || excludeSet.has(relPath)) continue;
      // Also handle "subdir/**" patterns.
      let skipDir = false;
      for (const ex of excludes) {
        if (ex.endsWith('/**')) {
          const prefix = ex.slice(0, -3);
          if (relPath === prefix || relPath.startsWith(prefix + '/')) {
            skipDir = true;
            break;
          }
        }
      }
      if (skipDir) continue;

      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (stat.isFile() && entry.endsWith('.md')) {
        result.push(fullPath);
      }
    }
  }

  walk(rootDir, '');
  return result;
}

// ---------- Index build ----------

async function buildIndex(
  configDir: string,
  rootDir: string,
  config: LintConfig,
): Promise<{ index: Record<string, Record<string, FileEntry>>; warnings: string[] }> {
  const index: Record<string, Record<string, FileEntry>> = {};
  const warnings: string[] = [];

  for (const [catName, cat] of Object.entries(config.categories)) {
    index[catName] = {};
    const catDir = resolve(rootDir, cat.dir);
    const files = listMarkdownFiles(catDir, cat.exclude ?? []);
    for (const file of files) {
      const text = await readFile(file, 'utf-8');
      const fm = extractFrontmatter(text);
      let id: string;
      if (cat['id-from'] === 'filename') {
        id = basename(file).replace(/\.md$/, '');
      } else {
        const raw = fm[cat['id-from']];
        if (raw === undefined || raw === null) {
          warnings.push(
            `${relative(configDir, file)}: missing frontmatter key "${cat['id-from']}" (skipped)`,
          );
          continue;
        }
        id = String(raw);
      }
      if (index[catName][id]) {
        warnings.push(
          `duplicate id "${id}" in category "${catName}": ${relative(configDir, file)} and ${relative(
            configDir,
            index[catName][id].filepath,
          )}`,
        );
      }
      index[catName][id] = { filepath: file, category: catName, id, frontmatter: fm };
    }
  }

  return { index, warnings };
}

// ---------- Relation validation ----------

function getNestedValue(obj: YamlValue, path: string): YamlValue | undefined {
  let cur: YamlValue = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, YamlValue>)[key];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function validateRelations(
  configDir: string,
  index: Record<string, Record<string, FileEntry>>,
  relations: RelationConfig[],
): string[] {
  const errors: string[] = [];

  for (const rel of relations) {
    const fromCat = index[rel.from];
    const toCat = index[rel.to];
    if (!fromCat) {
      errors.push(`relation references unknown "from" category: "${rel.from}"`);
      continue;
    }
    if (!toCat) {
      errors.push(`relation references unknown "to" category: "${rel.to}"`);
      continue;
    }

    for (const fromEntry of Object.values(fromCat)) {
      const viaValueRaw = getNestedValue(fromEntry.frontmatter, rel.via);
      if (viaValueRaw === undefined || viaValueRaw === null) continue;
      if (!Array.isArray(viaValueRaw)) {
        errors.push(
          `${relative(configDir, fromEntry.filepath)}: frontmatter "${rel.via}" is not a list`,
        );
        continue;
      }
      const viaValues = viaValueRaw.map((v) => String(v));

      for (const targetId of viaValues) {
        const targetEntry = toCat[targetId];
        if (!targetEntry) {
          errors.push(
            `${relative(configDir, fromEntry.filepath)}: "${rel.via}" references missing ${rel.to} "${targetId}"`,
          );
          continue;
        }
        const backrefRaw = getNestedValue(targetEntry.frontmatter, rel.backref);
        if (!Array.isArray(backrefRaw)) {
          errors.push(
            `${relative(configDir, targetEntry.filepath)}: missing or non-list frontmatter "${rel.backref}" (expected to contain "${fromEntry.id}" per backref from ${relative(configDir, fromEntry.filepath)})`,
          );
          continue;
        }
        const backrefValues = backrefRaw.map((v) => String(v));
        if (!backrefValues.includes(fromEntry.id)) {
          errors.push(
            `${relative(configDir, targetEntry.filepath)}: "${rel.backref}" is missing "${fromEntry.id}" (referenced by ${relative(configDir, fromEntry.filepath)}.${rel.via})`,
          );
        }
      }
    }
  }

  return errors;
}

// ---------- Main ----------

async function main(configPath: string) {
  const absConfigPath = resolve(configPath);
  const configText = await readFile(absConfigPath, 'utf-8');
  const configRaw = parseYaml(configText);
  if (typeof configRaw !== 'object' || configRaw === null || Array.isArray(configRaw)) {
    throw new Error(`Config at ${absConfigPath} did not parse as an object`);
  }
  const config = configRaw as unknown as LintConfig;
  const configDir = dirname(absConfigPath);
  const rootDir = resolve(configDir, config.root ?? '.');

  const { index, warnings } = await buildIndex(configDir, rootDir, config);
  for (const w of warnings) {
    console.warn(`warning: ${w}`);
  }

  const errors = validateRelations(configDir, index, config.relations);

  const totalFiles = Object.values(index).reduce(
    (sum, cat) => sum + Object.keys(cat).length,
    0,
  );

  if (errors.length === 0) {
    console.log(
      `ok: ${totalFiles} file(s) across ${Object.keys(index).length} categor${
        Object.keys(index).length === 1 ? 'y' : 'ies'
      }, ${config.relations.length} relation(s) — links are consistent`,
    );
    process.exit(0);
  }

  for (const e of errors) {
    console.error(`error: ${e}`);
  }
  console.error(`\nfail: ${errors.length} error(s)`);
  process.exit(1);
}

const configArg = process.argv[2];
if (!configArg) {
  console.error('Usage: bun run scripts/lint-frontmatter-links.ts <config.yaml>');
  process.exit(2);
}

main(configArg).catch((err) => {
  console.error(`script error: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
});
