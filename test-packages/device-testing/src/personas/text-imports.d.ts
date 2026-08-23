/**
 * Ambient module declarations for non-JSON raw fixture imports.
 *
 * Persona modules import their `raw/*.{xml,plist,txt}` files as inlined
 * strings via Bun's `with { type: 'text' }` import attribute. TypeScript
 * does not ship built-in declarations for those file extensions, so this
 * file teaches `tsc` that they resolve to a default string export.
 *
 * Bun handles the resolution itself at both runtime (via its loader) and
 * bundle time (the bundler inlines the file's contents as a string
 * literal directly into the output JS — no `readFileSync`, no `import.meta.url`
 * path lookups). That is why the `no-fs-at-load` smoke test stays green:
 * the bundler / loader satisfies the import without ever calling `fs`.
 *
 * JSON imports do not need a declaration here — `resolveJsonModule: true`
 * in the workspace `tsconfig.json` covers them.
 *
 * `*.xml` is deliberately **not** declared here. `bun-types` 1.4+ ambiently
 * declares `*.xml` itself (typed as `Bun.XML.Document`, its default
 * XML-parsing loader), and TypeScript merges every ambient declaration that
 * matches a given specifier — a second `declare module '*.xml'` here would
 * just be folded into bun-types' and lose, since ambient declarations can't
 * be scoped by import attribute. `.xml` imports are typed `Bun.XML.Document`
 * as a result; call sites use `asRawXmlText` from `./raw-text.js` to assert
 * the runtime-true `string` that `type: 'text'` actually produces.
 *
 * @module
 */

declare module '*.plist' {
  const content: string;
  export default content;
}

declare module '*.txt' {
  const content: string;
  export default content;
}
