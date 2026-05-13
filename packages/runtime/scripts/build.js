#!/usr/bin/env node
/**
 * Build @selvajs/runtime — the deployable artifact.
 *
 * Pipeline:
 *   1. Build @selvajs/compute-app with ADAPTER=node.
 *   2. Copy packages/compute-app/build/ → packages/runtime/build/.
 *   3. Compile selva.config.ts → templates/selva.config.example.js (esbuild).
 *   4. Write templates/ecosystem.config.cjs + templates/.env.example.
 *
 * The runtime package.json declares its deps with workspace:* and catalog:
 * specs. pnpm publish (v10+) rewrites both to concrete versions at pack time,
 * so the published tarball is installable from any registry without the
 * monorepo present. We deliberately do NOT pre-flatten package.json here —
 * pnpm already does it correctly and avoids drift between the source and
 * published specs.
 *
 * Run via: pnpm --filter @selvajs/runtime run build
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeDir = resolve(__dirname, '..');
const repoRoot = resolve(runtimeDir, '..', '..');
const computeAppDir = join(repoRoot, 'packages', 'compute-app');

const COLORS = {
	RESET: '\x1b[0m',
	BOLD: '\x1b[1m',
	GREEN: '\x1b[32m',
	RED: '\x1b[31m',
	BLUE: '\x1b[34m',
	DIM: '\x1b[2m'
};

const log = (msg) => console.log(msg);
const header = (msg) => log(`\n${COLORS.BOLD}${COLORS.BLUE}${msg}${COLORS.RESET}\n`);
const ok = (msg) => log(`${COLORS.GREEN}✓${COLORS.RESET} ${msg}`);
const fail = (msg) => log(`${COLORS.RED}✗${COLORS.RESET} ${msg}`);
const dim = (msg) => log(`${COLORS.DIM}${msg}${COLORS.RESET}`);

// ============================================================================
// Step 1 — Build compute-app with the node adapter.
// ============================================================================

function buildComputeApp() {
	header('[1/4] Building @selvajs/compute-app + its workspace deps with ADAPTER=node');
	// `...^@selvajs/compute-app` is pnpm's "all workspace deps of compute-app
	// EXCEPT compute-app itself". We build those first so their dist/ outputs
	// are fresh, then build compute-app against them.
	//
	// Without the prebuild step, the compute-app build can fail with
	// "X is not exported by ../ui/dist/index.js" whenever a new export was
	// added to @selvajs/ui's source but not yet baked into its dist.
	//
	// `--if-present` skips packages that have no `build` script (e.g.
	// @selvajs/config, which is pure config files) instead of erroring.
	execSync('pnpm --filter "...^@selvajs/compute-app" run --if-present build', {
		cwd: repoRoot,
		stdio: 'inherit'
	});
	execSync('pnpm --filter @selvajs/compute-app run build', {
		cwd: repoRoot,
		stdio: 'inherit',
		env: { ...process.env, ADAPTER: 'node' }
	});
	const buildOut = join(computeAppDir, 'build');
	if (!existsSync(buildOut)) {
		throw new Error(`compute-app build did not produce ${buildOut}`);
	}
	ok(`compute-app built → ${buildOut}`);
}

// ============================================================================
// Step 2 — Copy build output into the runtime package.
// ============================================================================

function copyBuildOutput() {
	header('[2/4] Copying build output into @selvajs/runtime');
	const dest = join(runtimeDir, 'build');
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });
	cpSync(join(computeAppDir, 'build'), dest, { recursive: true });
	ok(`build → ${dest}`);
}

// ============================================================================
// Step 3 — Compile selva.config.ts as a deployment template.
//
// The runtime loader (providers.server.ts) expects a .js file at
// SELVA_CONFIG_PATH — there's no TS compiler at runtime. Operators copy this
// example into their deployment dir as selva.config.js and edit it.
//
// Provider imports stay external so the operator's node_modules resolves them
// against the published @selvajs/* packages, not a frozen snapshot.
// ============================================================================

async function buildConfigTemplate() {
	header('[3/4] Compiling selva.config.ts → templates/selva.config.example.js');
	const templatesDir = join(runtimeDir, 'templates');
	mkdirSync(templatesDir, { recursive: true });

	await esbuild.build({
		entryPoints: [join(repoRoot, 'selva.config.ts')],
		outfile: join(templatesDir, 'selva.config.example.js'),
		format: 'esm',
		platform: 'node',
		target: 'node20',
		bundle: true,
		external: ['@selvajs/platform', '@selvajs/local-provider', '@selvajs/supabase-provider'],
		logLevel: 'info'
	});
	ok('selva.config.example.js compiled');
}

// ============================================================================
// Step 4 — Write deployment templates (PM2 config, .env example).
// ============================================================================

function writeDeploymentTemplates() {
	header('[4/4] Writing deployment templates');
	const templatesDir = join(runtimeDir, 'templates');
	mkdirSync(templatesDir, { recursive: true });

	const ecosystem = `// PM2 process file — runtime template shipped with @selvajs/runtime.
//
// Drop this into a deployment directory alongside selva.config.js and .env,
// then \`pm2 start ecosystem.config.cjs\`.
//
// Runtime config is loaded from .env via Node's --env-file flag (Node >= 20.6).
// PM2's own env_file option is silently ignored by \`pm2 start\` (only works
// under pm2-runtime) — using --env-file via node_args avoids that footgun.
//
// SELVA_CONFIG_PATH points the runtime at the operator's compiled config.
// Rhino.Compute server URL + API key are configured in /admin/compute.
module.exports = {
\tapps: [
\t\t{
\t\t\tname: 'selva-compute',
\t\t\tscript: './node_modules/@selvajs/runtime/build/index.js',
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
\t\t\t\tNODE_ENV: 'production',
\t\t\t\tSELVA_CONFIG_PATH: './selva.config.js'
\t\t\t}
\t\t}
\t]
};
`;
	writeFileSync(join(templatesDir, 'ecosystem.config.cjs'), ecosystem);
	ok('templates/ecosystem.config.cjs written');

	// .env.example — copied verbatim from compute-app so operators have the
	// authoritative reference without needing to reach back into a checkout.
	const envExampleSrc = join(computeAppDir, '.env.example');
	if (existsSync(envExampleSrc)) {
		cpSync(envExampleSrc, join(templatesDir, '.env.example'));
		ok('templates/.env.example copied from compute-app/.env.example');
	} else {
		dim('compute-app/.env.example not found — skipping');
	}
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	try {
		header(`${COLORS.BOLD}Building @selvajs/runtime${COLORS.RESET}`);
		dim(`  runtime:    ${runtimeDir}`);
		dim(`  repo root:  ${repoRoot}`);

		buildComputeApp();
		copyBuildOutput();
		await buildConfigTemplate();
		writeDeploymentTemplates();

		header('✓ @selvajs/runtime build complete');
		log('Next steps:');
		log('  cd packages/runtime');
		log('  pnpm pack           # inspect the publish-ready tarball');
		log('                      # pnpm rewrites workspace:* + catalog: → versions');
		log('  pnpm publish        # when ready');
		log('');
	} catch (err) {
		fail(err instanceof Error ? err.message : String(err));
		if (err instanceof Error && err.stack) dim(err.stack);
		process.exit(1);
	}
}

main();
