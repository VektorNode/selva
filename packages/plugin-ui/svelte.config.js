import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // For more information about preprocessors -> For App we will need the auto adapter
  // Probably best to seperate App from this svelte app
  preprocess: vitePreprocess(),

  compilerOptions: {
    // Handle .svelte files from node_modules
    runes: true,
  },

  kit: {
    adapter: adapter({
      // Output directory for static files (will be embedded in .gha)
      pages: 'build',
      assets: 'build',
      // Use index.html fallback for SPA mode (handles client-side routing)
      fallback: 'index.html',
      precompress: false,
      strict: false
    }),

    // Base path configuration for embedded server
    // In development: uses default localhost:5173
    // In production: will be served from C# HttpListener
    paths: {
      base: process.env.NODE_ENV === 'production' ? '' : ''
    },

    prerender: {
      // Only prerender routes that don't need query params
      // Notice that the /app route is excluded (separate application) since it requires server-side data (api/compute & page.server.ts)
      entries: [],
      handleHttpError: 'warn'
    }
  },
};

export default config;
