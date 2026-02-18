// This file is used by PM2 to manage the compute app process when deployed with NODE
// environment variables. Adjust the values in the `env` section as needed for your setup.
// IMPORTANT: Make sure not to commit sensitive information like API keys to version control.
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
				// Increase body size limit for large geometry uploads (default 512kb)
				BODY_SIZE_LIMIT: 'Infinity',
				// GH_DEFINITIONS_PATH: './definitions',
				// DEFINITION_SOURCE="environment"
				COMPUTE_API_KEY: 'your-api-key',
				NODE_ENV: 'production'
			}
		}
	]
};
