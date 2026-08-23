/**
 * Cast helper for `*.xml` fixtures imported via Bun's `with { type: 'text' }`
 * import attribute.
 *
 * `bun-types` 1.4+ ambiently declares `*.xml` as `Bun.XML.Document` (its
 * default XML-parsing loader). TypeScript merges every ambient module
 * declaration matching a given specifier across the whole program — there is
 * no way to scope a `declare module` by import attribute — so this repo's own
 * `*.xml` string typing can't coexist with bun-types' declaration for the
 * same specifier; the merged export resolves to `Bun.XML.Document`, even
 * though `type: 'text'` forces Bun's text loader at runtime and the value
 * really is a `string`. See `text-imports.d.ts` for the `.plist`/`.txt`
 * counterparts, which don't have this conflict.
 *
 * `asRawXmlText` is the single, documented place that bridges that gap,
 * rather than an unexplained double-cast repeated at every `.xml` import
 * site.
 *
 * @module
 */

/** Assert that a `*.xml` import loaded via `with { type: 'text' }` is the runtime string it actually is, despite bun-types typing it as `Bun.XML.Document`. */
export function asRawXmlText(value: unknown): string {
  return value as string;
}
