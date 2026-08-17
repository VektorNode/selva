#!/usr/bin/env node

// Run the Selva app against one auth provider without provisioning anything.
//
//   node scripts/dev-provider.mjs local
//   node scripts/dev-provider.mjs supabase
//   node scripts/dev-provider.mjs header [--persona member]
//
// Each provider maps to a vite `--mode`, so vite loads packages/selva/.env.<mode>
// on top of the base .env. Provider-specific backing services are started first:
// supabase brings up the CLI stack, header brings up a Caddy that injects the
// identity headers a production oauth2-proxy would.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supabaseDir = path.join(rootDir, 'packages', 'providers', 'supabase');
const caddyfilePath = path.join(rootDir, 'scripts', '.dev-caddyfile');

const APP_PORT = 5173;
const PROXY_PORT = 8080;

const PROVIDERS = new Set(['local', 'supabase', 'header']);

const IS_WINDOWS = process.platform === 'win32';

// ============================================================================
// Args
// ============================================================================

const argv = process.argv.slice(2);
const provider = argv[0];

if (!PROVIDERS.has(provider)) {
	console.error(
		`Usage: node scripts/dev-provider.mjs <${[...PROVIDERS].join('|')}> [--persona <name>]`
	);
	process.exit(1);
}

const personasFile = JSON.parse(
	fs.readFileSync(path.join(rootDir, 'scripts', 'dev-personas.json'), 'utf-8')
);
const personaIndex = argv.indexOf('--persona');
const personaName = personaIndex === -1 ? personasFile.default : argv[personaIndex + 1];
const persona = personasFile.personas[personaName];

if (!persona) {
	const names = Object.keys(personasFile.personas).join(', ');
	console.error(`Unknown persona "${personaName}". Available: ${names}`);
	process.exit(1);
}

// ============================================================================
// Child processes
// ============================================================================

/** Every long-lived child, so one Ctrl-C tears down the whole set. */
const children = [];

// `pnpm` and `npx` are .cmd shims on Windows. Node 24 refuses to spawn a .cmd
// without a shell (EINVAL), so those two need `shell: true` — which in turn
// means their args are concatenated, not escaped (DEP0190). Every arg this
// script passes is a literal defined above, none interpolated from persona
// data, so there is nothing to escape. Keep it that way: a persona field
// reaching an argv here would become shell injection.
const WINDOWS_SHIMS = new Set(['pnpm', 'npx']);

function run(command, args, options = {}) {
	const needsShell = IS_WINDOWS && WINDOWS_SHIMS.has(command);
	const child = spawn(command, args, { stdio: 'inherit', shell: needsShell, ...options });
	children.push(child);
	return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		if (!child.killed) child.kill();
	}
	process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function has(command) {
	const probe = spawnSync(command, ['version'], {
		stdio: 'ignore',
		shell: IS_WINDOWS && WINDOWS_SHIMS.has(command)
	});
	return probe.status === 0;
}

// ============================================================================
// Provider-specific setup
// ============================================================================

function startSupabase() {
	console.info('→ Starting Supabase stack (packages/providers/supabase)…');
	// Synchronous: the app reads SUPABASE_URL at first request, and a stack that
	// is still booting returns connection-refused rather than a retryable error.
	const result = spawnSync('npx', ['supabase', 'start'], {
		cwd: supabaseDir,
		stdio: 'inherit',
		shell: IS_WINDOWS
	});
	if (result.status !== 0) {
		console.error('\nSupabase failed to start. Is Docker running?');
		process.exit(1);
	}
	console.info('  Studio: http://127.0.0.1:54423   Inbucket (emails): http://127.0.0.1:54424\n');
}

function writeDevCaddyfile() {
	// Mirrors the production shape in packages/providers/header-auth/README.md:
	// strip inbound SELVA-* at site scope FIRST, then inject. The strip lines
	// must stay outside any `handle` block — Caddy reorders request_header
	// directives inside one, and the injected values get stripped again.
	//
	// The only difference from production is where the values come from: a
	// static persona here, oauth2-proxy's forward_auth there. Selva cannot tell
	// the two apart, which is exactly why this is a valid test.
	const config = `:${PROXY_PORT} {
	request_header -SELVA-UserPrincipalName
	request_header -SELVA-Email
	request_header -SELVA-DisplayName

	request_header SELVA-UserPrincipalName "${persona.upn}"
	request_header SELVA-Email "${persona.email}"
	request_header SELVA-DisplayName "${persona.displayName}"

	reverse_proxy 127.0.0.1:${APP_PORT}
}
`;
	fs.writeFileSync(caddyfilePath, config, 'utf-8');
}

function startCaddy() {
	if (!has('caddy')) {
		console.error(`
Caddy is not on PATH — the header-auth path needs a proxy to inject identity headers.

  winget install CaddyServer.Caddy      (Windows)
  brew install caddy                    (macOS)

Or skip the proxy and send the headers by hand:
  curl -H "SELVA-UserPrincipalName: ${persona.upn}" \\
       -H "SELVA-Email: ${persona.email}" \\
       -H "SELVA-DisplayName: ${persona.displayName}" \\
       http://localhost:${APP_PORT}/
`);
		process.exit(1);
	}

	writeDevCaddyfile();
	console.info(`→ Caddy on :${PROXY_PORT} as "${personaName}" (${persona.email})`);
	run('caddy', ['run', '--config', caddyfilePath, '--adapter', 'caddyfile']);
}

// ============================================================================
// Go
// ============================================================================

if (provider === 'supabase') startSupabase();
if (provider === 'header') startCaddy();

const url =
	provider === 'header' ? `http://localhost:${PROXY_PORT}` : `http://localhost:${APP_PORT}`;
console.info(`→ Provider "${provider}" — open ${url}\n`);

// --strictPort, not vite's default port-hunting: the Caddyfile hard-codes
// APP_PORT, so a vite that quietly moves to 5174 leaves the proxy pointing at
// whatever else is on 5173. Failing to boot is the better outcome.
const app = run(
	'pnpm',
	[
		'--filter',
		'@selvajs/selva',
		'exec',
		'vite',
		'dev',
		'--mode',
		`dev-${provider}`,
		'--port',
		String(APP_PORT),
		'--strictPort'
	],
	{ cwd: rootDir }
);

app.on('exit', (code) => shutdown(code ?? 0));
