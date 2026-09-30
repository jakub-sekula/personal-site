// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

// Photos are served from R2 in production (public/photos is local-only), so a
// Cloudflare build (Workers Builds or Pages) without the R2 URL must not ship.
if ((process.env.WORKERS_CI || process.env.CF_PAGES) && !process.env.PUBLIC_PHOTOS_URL) {
  throw new Error('PUBLIC_PHOTOS_URL must be set in the Cloudflare build variables');
}

// Tailwind (v3, same config as the old Next.js site) runs through PostCSS: see postcss.config.cjs.
export default defineConfig({
  site: 'https://jakubsekula.com',
  // The old site's URLs had no trailing slash (/projects/disco-cube). Emitting
  // projects/disco-cube.html makes Cloudflare serve exactly those URLs.
  trailingSlash: 'ignore',
  build: { format: 'file' },
  integrations: [
    mdx(),
    // The CV is noindex (see src/pages/cv.astro and public/_headers), so keep it out of the sitemap too.
    sitemap({ filter: (page) => !/\/cv\/?$/.test(page) }),
    react(),
  ],
  markdown: {
    shikiConfig: {
      // Closest match to the old site's Prism "atomDark" code theme.
      theme: 'one-dark-pro',
    },
  },
});