import { createViteConfig } from '@selva/config/vite';

export default createViteConfig({
  build: {
    rollupOptions: {
      external: ['compute-rhino3d', 'fflate', "@svelte/core", 'three'],
    },
  },
});
