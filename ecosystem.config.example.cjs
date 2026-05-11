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

			// Concurrency: fork + 1 instance is required for the local provider —
			// its JSON stores read-modify-write without file locking, so two
			// processes on the same data dir will lose updates under load.
			// Switch to instances: 'max', exec_mode: 'cluster' when migrating to
			// Supabase (or any provider with real concurrency control).
			instances: 1,
			exec_mode: 'fork',

			// Lifecycle
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			kill_timeout: 10000, // let in-flight solves drain (MAX_SOLVE_DURATION_MS=60s)
			listen_timeout: 10000, // tolerate slow first-boot
			min_uptime: '30s', // crash-loop protection
			max_restarts: 10,

			// Logging
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,

			// Config
			env_file: './.env',
			env: {
				NODE_ENV: 'production'
			}
		}
	]
};
