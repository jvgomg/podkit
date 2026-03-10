import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';
import { remarkBaseUrl } from './src/remark-base-url.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = '/podkit';

// https://astro.build/config
export default defineConfig({
  site: 'https://jvgomg.github.io',
  base,
  markdown: {
    remarkPlugins: [remarkBaseUrl({ base })],
  },
  vite: {
    resolve: {
      // Allow MDX files in symlinked docs/ to resolve Starlight components
      alias: {
        '@astrojs/starlight/components': resolve(__dirname, 'node_modules/@astrojs/starlight/components'),
      },
    },
  },
  integrations: [
    starlight({
      plugins: [starlightLlmsTxt()],
      title: 'podkit',
      description: 'Sync your music collection to iPod devices',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jvgomg/podkit' },
      ],
      editLink: {
        baseUrl: 'https://github.com/jvgomg/podkit/edit/main/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'First Sync', slug: 'getting-started/first-sync' },
          ],
        },
        {
          label: 'User Guide',
          autogenerate: { directory: 'user-guide' },
        },
        {
          label: 'Device Compatibility',
          autogenerate: { directory: 'devices' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
        {
          label: 'Troubleshooting',
          autogenerate: { directory: 'troubleshooting' },
        },
        {
          label: 'Developer Guide',
          collapsed: true,
          autogenerate: { directory: 'developers' },
        },
      ],
    }),
  ],
});
