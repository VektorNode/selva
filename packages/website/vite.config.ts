import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Root docs/ lives two levels up (repo root). Allow Vite to read it so the
// website can render the canonical docs as its source of truth.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5174,
		fs: {
			allow: [repoRoot]
		}
	}
});
