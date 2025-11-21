import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    rollupOptions: {
      external: ['compute-rhino3d', 'fflate', /^rhino-compute-core/]
    }
  }
});
