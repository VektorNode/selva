// This file is used by PM2 to manage the compute app process when deployed with NODE
// environment variables. Adjust the values in the `env` section as needed for your setup.
// IMPORTANT: Make sure not to commit sensitive information like API keys to version control.
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './packages/compute-app/build/index.js',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			env: {
				PORT: 3000,
				ORIGIN: 'http://your-public-ip',
				COMPUTE_SERVER_URL: 'https://your-compute-server',
				// Increase body size limit for large geometry uploads (default 512kb)
				BODY_SIZE_LIMIT: 'Infinity',
				// Path to Grasshopper definitions (use absolute path)
				GH_DEFINITIONS_PATH: '/absolute/path/to/definitions',
				COMPUTE_API_KEY: 'your-api-key',
				NODE_ENV: 'production',
				ADMIN_PASSWORD: 'your-secure-password',
				// For HTTP deployments (development only), allow insecure cookies
				// ALLOW_INSECURE_COOKIES: 'true'
			}
		}
	]
};
