import { createViteConfig } from '@selva/config/vite';

export default createViteConfig({
	server: {
		fs: {
			allow: ['..', '../../node_modules']
		}
	}
});
