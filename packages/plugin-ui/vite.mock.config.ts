import { createViteConfig } from '@selvajs/config/vite';

// Used only by `pnpm dev:plugin:mock` (dev/mock-grasshopper.ts spawns Vite with this config).
// Unlike vite.config.ts, no fixed port: the mock server has no origin check of its own, so it
// can run on whatever port is free instead of colliding with an already-running dev:plugin
// or another mock instance on 5173.
export default createViteConfig({
	server: {
		fs: {
			allow: ['..', '../../node_modules']
		}
	}
});
