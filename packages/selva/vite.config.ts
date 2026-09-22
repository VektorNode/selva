import { createViteConfig } from '@selvajs/config/vite';

// 5183, not Vite's default 5173: plugin-ui dev and the Selva app are routinely run at the same
// time, and a port Vite picked by falling back is one Rhino.Compute cannot be told about in
// advance. `strictPort` makes a clash fail loudly instead of silently moving the callback target.
export default createViteConfig({
	server: {
		port: 5199,
		strictPort: true
	}
});
