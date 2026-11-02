import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
	root: path('.'),
	// The HDR the viewer lights with ships with the plugin UI.
	publicDir: path('../../plugin-ui/static'),
	assetsInclude: ['**/*.slvm'],
	server: { fs: { allow: [path('../../..')] } }
});
