import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import mermaid from 'astro-mermaid';
import { remarkBaseUrl } from './src/remark-base-url.mjs';
import remarkEmoji from 'remark-emoji';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
        starlightLlmsTxt({
          description: `podkit is a TypeScript CLI for syncing music and video collections to classic iPod devices. It handles automatic transcoding (FLAC→AAC, MKV→M4V), full metadata preservation, album artwork, intelligent duplicate detection, and incremental syncs. It works with all classic iPod models including iFlash-modded devices. Note: podkit is in early development (beta). Users should only use it with an iPod they are willing to wipe, as database corruption is possible.`,
          details: `Key concepts:
- **Media sources**: Local directories or Subsonic-compatible servers (Navidrome, Airsonic, Gonic)
- **Devices**: Multiple iPods with independent quality settings and transforms
- **Transcoding**: Only transcodes what's needed — compatible files are copied as-is
- **Clean Artists**: The clean artists feature cleans up "Artist feat. X" entries on iPod
- **Configuration**: TOML config file at ~/.config/podkit/config.toml`,
          optionalLinks: [
            {
              label: 'Installation',
              url: 'https://jvgomg.github.io/podkit/getting-started/installation',
              description: 'Install FFmpeg and podkit',
            },
            {
              label: 'Quick Start',
              url: 'https://jvgomg.github.io/podkit/getting-started/quick-start',
              description: 'First sync walkthrough',
            },
            {
              label: 'Configuration',
              url: 'https://jvgomg.github.io/podkit/user-guide/configuration',
              description: 'TOML config file reference',
            },
            {
              label: 'Media Sources',
              url: 'https://jvgomg.github.io/podkit/user-guide/collections',
              description: 'Directory and Subsonic collection sources',
            },
            {
              label: 'Managing Devices',
              url: 'https://jvgomg.github.io/podkit/user-guide/devices',
              description: 'Multi-device setup, quality, and transforms',
            },
            {
              label: 'Transcoding',
              url: 'https://jvgomg.github.io/podkit/user-guide/transcoding',
              description: 'Audio and video transcoding methodology',
            },
            {
              label: 'CLI Commands',
              url: 'https://jvgomg.github.io/podkit/reference/cli-commands',
              description: 'Complete command reference',
            },
            {
              label: 'Supported Devices',
              url: 'https://jvgomg.github.io/podkit/devices/supported-devices',
              description: 'iPod model compatibility matrix',
            },
          ],
          promote: ['index*', 'getting-started/**', 'user-guide/**'],
          demote: ['developers/**'],
          exclude: ['developers/**'],
        }),
      ],
      title: 'podkit',
      description: 'Sync your music collection to iPod devices',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jvgomg/podkit' }],
      editLink: {
        baseUrl: 'https://github.com/jvgomg/podkit/edit/main/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'The Project',
          autogenerate: { directory: 'project' },
        },
        {
          label: 'User Guide',
          items: [
            { slug: 'user-guide/configuration' },
            {
              label: 'Collections',
              autogenerate: { directory: 'user-guide/collections' },
            },
            {
              label: 'Syncing',
              autogenerate: { directory: 'user-guide/syncing' },
            },
            {
              label: 'Devices',
              autogenerate: { directory: 'user-guide/devices' },
            },
            {
              label: 'Transcoding',
              autogenerate: { directory: 'user-guide/transcoding' },
            },
          ],
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
