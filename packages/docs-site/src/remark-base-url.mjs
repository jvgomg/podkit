/**
 * Remark plugin that prepends the Astro `base` path to internal links.
 *
 * Astro does not automatically rewrite markdown links when `base` is set.
 * This plugin rewrites absolute links (starting with `/`) so they work
 * correctly when the site is served from a subpath (e.g. `/podkit`).
 */
function visit(node, fn) {
  fn(node);
  if (node.children) node.children.forEach((c) => visit(c, fn));
}

export function remarkBaseUrl({ base = '/' } = {}) {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!prefix) return () => {};

  return () => (tree) => {
    visit(tree, (node) => {
      // Rewrite markdown links: [text](/path)
      if (node.type === 'link' && node.url?.startsWith('/') && !node.url.startsWith(prefix)) {
        node.url = prefix + node.url;
      }
      // Rewrite markdown images: ![alt](/path)
      if (node.type === 'image' && node.url?.startsWith('/') && !node.url.startsWith(prefix)) {
        node.url = prefix + node.url;
      }
    });
  };
}
