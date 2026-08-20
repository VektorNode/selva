// PM2 process file — runtime template shipped with @selvajs/selva.
//
// Drop this into a deployment directory alongside .env, then
// `pm2 start ecosystem.config.cjs`.
//
// Runtime config is loaded from .env via Node's --env-file flag (Node >= 20.6).
// PM2's own env_file option is silently ignored by `pm2 start` (only works
// under pm2-runtime) — using --env-file via node_args avoids that footgun.
//
// Providers are picked from SELVA_AUTH_PROVIDER / SELVA_DATA_PROVIDER /
// SELVA_STORAGE_PROVIDER in .env. For custom providers not shipped in the box,
// set SELVA_CONFIG_PATH to a .js file exporting a defineConfig() result.
//
// Rhino.Compute server URL + API key are configured in /admin/compute.
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './node_modules/@selvajs/selva/build/index.js',
			cwd: '.',
			node_args: '--env-file=.env',

			// fork + 1 instance is required for the local provider — its JSON stores
			// read-modify-write without file locking. Switch to instances: 'max',
			// exec_mode: 'cluster' on Supabase or any provider with real concurrency
			// control.
			instances: 1,
			exec_mode: 'fork',

			autorestart: true,
			watch: false,
			max_memory_restart: '1G',

			// kill_timeout: graceful-drain budget on restart. PM2 sends SIGINT to
			// the SvelteKit server, which stops accepting new connections and
			// waits for in-flight requests to finish. After this many ms, PM2
			// escalates to SIGKILL. 10s is enough for most solves; bump if your
			// definitions can run longer and you want them to complete during
			// an update. The admin-update health probe runs AFTER this window,
			// so raising kill_timeout extends update time but doesn't break it.
			kill_timeout: 10000,
			listen_timeout: 10000,
			min_uptime: '30s',
			max_restarts: 10,

			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,

			env: {
				NODE_ENV: 'production'
			}
		}
	]
};
