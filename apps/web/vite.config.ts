import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The API server the dev server proxies `/api` to. */
const apiTarget = `http://localhost:${process.env.QUERENT_PORT || 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': apiTarget },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The CSP allows data: for images only, so fonts must stay separate files.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
  },
});
