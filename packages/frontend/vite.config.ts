import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  esbuild: {
    drop: ['console', 'debugger']
  },
  server: {
    fs: {
      allow: ['..', '../../node_modules'],
    },
  },
});
