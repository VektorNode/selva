import { createViteConfig } from '@selvajs/config/vite';

export default createViteConfig({
	server: {
		fs: {
			allow: ['..', '../../node_modules']
		}
	}
});
