import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  compilerOptions: {
    runes: true,
  },

  kit: {
    // Output embedded in the .gha; fallback to index.html for SPA-style client-side routing.
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: false
    }),

    paths: {
      base: process.env.NODE_ENV === 'production' ? '' : ''
    },

    prerender: {
      entries: [],
      handleHttpError: 'warn'
    }
  },
};

export default config;
