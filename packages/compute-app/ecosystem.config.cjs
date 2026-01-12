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
				ORIGIN: 'http://your-public-ip',
				COMPUTE_SERVER_URL: 'http://your-compute-server:5000',
				GH_DEFINITIONS_PATH: './definitions',
				COMPUTE_API_KEY: 'your-api-key',
				NODE_ENV: 'production'
			}
		}
	]
};
