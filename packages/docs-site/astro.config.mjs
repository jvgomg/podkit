import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import mermaid from 'astro-mermaid';
import { remarkBaseUrl } from './src/remark-base-url.mjs';
import remarkEmoji from 'remark-emoji';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { llmsTxtConfig } from './config/llms-txt.ts';
import { sidebar } from './config/sidebar.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = '/podkit';

// https://astro.build/config
export default defineConfig({
  site: 'https://jvgomg.github.io',
  base,
  redirects: {
    '/reference/transforms/': '/reference/clean-artists/',
    '/about/': '/project/about/',
    '/roadmap/': '/project/roadmap/',
    '/feedback/': '/project/feedback/',
    '/similar-projects/': '/project/similar-projects/',
    '/devices/other-devices/': '/devices/supported-devices/',
  },
  markdown: {
    remarkPlugins: [remarkBaseUrl({ base }), remarkEmoji],
  },
  vite: {
    resolve: {
      // Allow MDX files in symlinked docs/ to resolve Starlight components
      alias: {
        '@astrojs/starlight/components': resolve(
          __dirname,
          'node_modules/@astrojs/starlight/components'
        ),
        '@components': resolve(__dirname, 'src/components'),
      },
    },
  },
  integrations: [
    mermaid(),
    starlight({
      plugins: [
        starlightLinksValidator({
          // The remarkBaseUrl plugin rewrites absolute links (/foo → /podkit/foo) for
          // correct runtime behavior. The validator can't resolve these base-prefixed
          // paths against page slugs, so we exclude them. The source paths are validated
          // implicitly since the remark plugin only prefixes, never changes the path.
          exclude: ['/podkit/**'],
        }),
        starlightLlmsTxt(llmsTxtConfig),
      ],
      title: 'podkit',
      description: 'Sync your music collection to portable music players',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jvgomg/podkit' }],
      editLink: {
        baseUrl: 'https://github.com/jvgomg/podkit/edit/main/',
      },
      sidebar,
    }),
  ],
});
