// PM2 process file for the compute app.
//
// Runtime config lives in packages/compute-app/.env and is loaded via
// `env_file` below — keep secrets there, not here. Any var the active
// provider needs (e.g. SUPABASE_URL for the Supabase provider) is picked up
// automatically as long as it's in that file.
//
// Rhino.Compute server URL + API key are configured in /admin/compute, not env.
// First admin user is created via the in-app setup page on first boot.
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './build/index.js',
			cwd: './packages/compute-app',
			instances: 'max',
			exec_mode: 'cluster',
			autorestart: true,
			watch: false,
			max_memory_restart: '500M',
			env_file: './.env',
			env: {
				NODE_ENV: 'production'
			}
		}
	]
};
