// This file is used by PM2 to manage the compute app process when deployed with NODE
export default {
	apps: [
		{
			name: 'selva-compute',
			script: './build/index.js',
			env_file: '.env',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '1G'
		}
	]
};
