// This file is used by PM2 to manage the compute app process when deployed with NODE
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './build/index.js',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			env: {
				PORT: 3000,
				ORIGIN: 'http://35.240.50.56:3000',
				COMPUTE_SERVER_URL: 'http://vektornode-compute.ch/',
				GH_DEFINITIONS_PATH: './definitions',
				COMPUTE_API_KEY: 'xxxx',
				NODE_ENV: 'production'
			}
		}
	]
};
