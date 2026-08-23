import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Root docs/ lives two levels up (repo root). Allow Vite to read it so the
// website can render the canonical docs as its source of truth.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Firebase Hosting resolves /docs/api/compute to its index.html; Vite's dev
// server matches static/ files by exact path only, so without this rewrite the
// URL falls through to the SvelteKit docs/[...slug] route and 404s.
function apiDocsIndexFallback(): Plugin {
	const rewrite = (req: IncomingMessage, _res: ServerResponse, next: () => void) => {
		const [path] = (req.url ?? '').split('?');
		if (path.startsWith('/docs/api/') && !/\.[a-z0-9]+$/i.test(path)) {
			req.url = path.replace(/\/?$/, '/index.html');
		}
		next();
	};
	return {
		name: 'api-docs-index-fallback',
		configureServer: (server) => void server.middlewares.use(rewrite),
		configurePreviewServer: (server) => void server.middlewares.use(rewrite)
	};
}

export default defineConfig({
	// The rewrite plugin must come before sveltekit() so its middleware runs
	// before SvelteKit claims the request.
	plugins: [apiDocsIndexFallback(), tailwindcss(), sveltekit()],
	server: {
		port: 5174,
		fs: {
			allow: [repoRoot]
		}
	}
});
