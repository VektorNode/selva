import { createViteConfig } from '@selva/config/vite';

export default createViteConfig({
	esbuild: {
		drop: ['console', 'debugger']
	},
	server: {
		fs: {
			allow: ['..', '../../node_modules']
		}
	}
});
