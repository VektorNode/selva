import { createViteConfig } from '@selvajs/config/vite';

// The plugin accepts WebSocket connections only from pages on this exact origin in dev
// (AppConfig.UIBuilder.DevServerPort), so a fallback port would be refused. Fail loudly instead.
export default createViteConfig({
	server: {
		port: 5173,
		strictPort: true,
		fs: {
			allow: ['..', '../../node_modules']
		}
	}
});
