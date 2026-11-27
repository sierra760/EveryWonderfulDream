import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: process.env.PAGES_ORIGIN,
  base: process.env.PAGES_BASE || '/',
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  vite: {
    build: { chunkSizeWarningLimit: 1500 },
  },
});
