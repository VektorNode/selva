import { createViteConfig } from '@selvajs/config/vite';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin } from 'vite';

import { kit } from './kit.config.js';

// The server reads process.env (#lib/server/env.ts), which the deployed app is started with.
// Under `vite dev` SvelteKit keeps .env to itself, so load it here; a value already in the
// environment (dev-provider.mjs sets DATA_PATH) wins over the file, as it does in production.
const envDir = fileURLToPath(new URL('.', import.meta.url));

function loadDotenvIntoProcess(): Plugin {
	return {
		name: 'selva:dotenv',
		config(_, { mode }) {
			for (const [key, value] of Object.entries(loadEnv(mode, envDir, ''))) {
				process.env[key] ??= value;
			}
		}
	};
}

// 5183, not Vite's default 5173: plugin-ui dev and the Selva app are routinely run at the same
// time, and a port Vite picked by falling back is one Rhino.Compute cannot be told about in
// advance. `strictPort` makes a clash fail loudly instead of silently moving the callback target.
export default createViteConfig({
	kit,
	plugins: [loadDotenvIntoProcess()],
	server: {
		port: 5199,
		strictPort: true
	}
});
