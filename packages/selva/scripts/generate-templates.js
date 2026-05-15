#!/usr/bin/env node
/**
 * Post-build: emit templates/ files shipped with @selvajs/selva.
 *
 * Outputs:
 *   templates/ecosystem.config.cjs     — PM2 process file
 *   templates/.env.example             — copied from packages/selva/.env.example
 *
 * Templates are scaffolding-time artifacts; @selvajs/cli reads them out of
 * node_modules/@selvajs/selva/templates/ after install.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const selvaDir = resolve(__dirname, '..');
const templatesDir = join(selvaDir, 'templates');

const COLORS = {
	RESET: '\x1b[0m',
	BOLD: '\x1b[1m',
	GREEN: '\x1b[32m',
	BLUE: '\x1b[34m',
	DIM: '\x1b[2m'
};

const log = (msg) => console.log(msg);
const header = (msg) => log(`\n${COLORS.BOLD}${COLORS.BLUE}${msg}${COLORS.RESET}\n`);
const ok = (msg) => log(`${COLORS.GREEN}✓${COLORS.RESET} ${msg}`);
const dim = (msg) => log(`${COLORS.DIM}${msg}${COLORS.RESET}`);

mkdirSync(templatesDir, { recursive: true });

// Sweep stale artifacts from earlier template shapes (selva.config.example.js
// is no longer emitted — deployments are env-only).
rmSync(join(templatesDir, 'selva.config.example.js'), { force: true });

// ============================================================================
// ecosystem.config.cjs — PM2 process file
// ============================================================================

header('[1/2] Writing templates/ecosystem.config.cjs');

const ecosystem = `// PM2 process file — runtime template shipped with @selvajs/selva.
//
// Drop this into a deployment directory alongside .env, then
// \`pm2 start ecosystem.config.cjs\`.
//
// Runtime config is loaded from .env via Node's --env-file flag (Node >= 20.6).
// PM2's own env_file option is silently ignored by \`pm2 start\` (only works
// under pm2-runtime) — using --env-file via node_args avoids that footgun.
//
// Providers are picked from SELVA_AUTH_PROVIDER / SELVA_DATA_PROVIDER /
// SELVA_STORAGE_PROVIDER in .env. For custom providers not shipped in the box,
// set SELVA_CONFIG_PATH to a .js file exporting a defineConfig() result.
//
// Rhino.Compute server URL + API key are configured in /admin/compute.
module.exports = {
\tapps: [
\t\t{
\t\t\tname: 'selva-compute',
\t\t\tscript: './node_modules/@selvajs/selva/build/index.js',
\t\t\tcwd: '.',
\t\t\tnode_args: '--env-file=.env',

\t\t\t// fork + 1 instance is required for the local provider — its JSON stores
\t\t\t// read-modify-write without file locking. Switch to instances: 'max',
\t\t\t// exec_mode: 'cluster' on Supabase or any provider with real concurrency
\t\t\t// control.
\t\t\tinstances: 1,
\t\t\texec_mode: 'fork',

\t\t\tautorestart: true,
\t\t\twatch: false,
\t\t\tmax_memory_restart: '1G',

\t\t\t// kill_timeout: graceful-drain budget on restart. PM2 sends SIGINT to
\t\t\t// the SvelteKit server, which stops accepting new connections and
\t\t\t// waits for in-flight requests to finish. After this many ms, PM2
\t\t\t// escalates to SIGKILL. 10s is enough for most solves; bump if your
\t\t\t// definitions can run longer and you want them to complete during
\t\t\t// an update. The admin-update health probe runs AFTER this window,
\t\t\t// so raising kill_timeout extends update time but doesn't break it.
\t\t\tkill_timeout: 10000,
\t\t\tlisten_timeout: 10000,
\t\t\tmin_uptime: '30s',
\t\t\tmax_restarts: 10,

\t\t\tlog_date_format: 'YYYY-MM-DD HH:mm:ss Z',
\t\t\tmerge_logs: true,

\t\t\tenv: {
\t\t\t\tNODE_ENV: 'production'
\t\t\t}
\t\t}
\t]
};
`;
writeFileSync(join(templatesDir, 'ecosystem.config.cjs'), ecosystem);
ok('templates/ecosystem.config.cjs written');

// ============================================================================
// .env.example — copied verbatim from packages/selva/.env.example
// ============================================================================

header('[2/2] Copying .env.example');

const envExampleSrc = join(selvaDir, '.env.example');
if (existsSync(envExampleSrc)) {
	cpSync(envExampleSrc, join(templatesDir, '.env.example'));
	ok('templates/.env.example copied');
} else {
	dim('packages/selva/.env.example not found — skipping');
}
