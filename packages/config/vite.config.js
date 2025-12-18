import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, mergeConfig } from 'vite';

export function createViteConfig(overrides = {}) {
  return mergeConfig(
    defineConfig({
      plugins: [tailwindcss(), sveltekit()]
    }),
    overrides
  );
}
