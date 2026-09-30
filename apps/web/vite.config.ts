import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The API server the dev server proxies `/api` to. */
const apiTarget = `http://localhost:${process.env.QUERENT_PORT || 3000}`;

/**
 * The file name of a chunk. A feature's screens chunk takes the feature's name, such as
 * `thread-screens`, so a build report says which screen is which.
 *
 * @param chunk - The chunk.
 * @param chunk.name - Its name.
 * @param chunk.facadeModuleId - The module it stands for, if any.
 * @returns The file name pattern.
 */
function chunkFileName(chunk: { name: string; facadeModuleId: string | null }): string {
  const feature = /features\/([^/]+)\/screens\.ts$/.exec(chunk.facadeModuleId ?? '')?.[1];
  return feature ? `assets/${feature}-screens-[hash].js` : 'assets/[name]-[hash].js';
}

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
    // ECharts is one lazy chunk of about 670 kB (225 kB gzipped), loaded only by dashboards.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        chunkFileNames: chunkFileName,
        // Libraries that change less often than the app get chunks of their own, which browsers
        // keep across releases. Each screen is its own chunk too, loaded when its route opens.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'router', test: /node_modules\/(react-router|cookie|set-cookie-parser)\// },
            { name: 'zod', test: /node_modules\/zod\// },
          ],
        },
      },
    },
  },
});
