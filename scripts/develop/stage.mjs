#!/usr/bin/env node

// A Selva deployment as an operator gets it, on this machine: this tree's
// packages published to a throwaway npm registry, installed with the real CLI
// into a Linux container, run under pm2 behind Caddy.
//
//   node scripts/develop/stage.mjs local|supabase|header [--persona <name>] [--no-build]
//   node scripts/develop/stage.mjs publish [--broken] [--no-build]
//   node scripts/develop/stage.mjs persona <name>
//   node scripts/develop/stage.mjs logs | sh | down
//
// `publish` puts the current tree in the registry as the next version, so the
// admin page offers a real self-update. STAGING.md has the walkthrough.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderCaddyfile } from '../../packages/cli/src/caddyfile.js';
import { readWorkspacePackages } from '../release/publishable-packages.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stageDir = path.join(rootDir, '.selva-data', 'stage');
const statePath = path.join(stageDir, 'state.json');
const supabaseDir = path.join(rootDir, 'packages', 'providers', 'supabase');

const PORT = Number(process.env.SELVA_STAGE_PORT ?? 8180);
const REGISTRY_PORT = Number(process.env.SELVA_STAGE_REGISTRY_PORT ?? 4873);

const NETWORK = 'selva-stage';
const REGISTRY = 'selva-stage-registry';
const HOST = 'selva-stage-host';
const DEPLOY_DIR = '/srv/selva';
// Unprivileged inside the container, so Caddy runs as the same user as pm2.
const PROXY_INNER_PORT = 8080;

// Every publish and dist-tag names this registry on the command line. The
// packages carry real names: falling back to npm's default would put a staged
// build on npmjs.org.
const REGISTRY_URL = `http://localhost:${REGISTRY_PORT}/`;
const REGISTRY_URL_IN_NETWORK = `http://${REGISTRY}:4873/`;

const MODES = new Set(['local', 'supabase', 'header']);
const IS_WINDOWS = process.platform === 'win32';

// ============================================================================
// Pure parts
// ============================================================================

/**
 * The nth staged version of a tree version. Always a prerelease that sorts
 * after the one before it, and reads as staged wherever a version is shown.
 */
export function stageVersion(base, round) {
	return base.includes('-') ? `${base}.stage.${round}` : `${base}-stage.${round}`;
}

/**
 * The production Caddyfile, served over plain HTTP on a port.
 *
 * `persona` fills the header-auth slot the way oauth2-proxy would. `forwardPort`
 * makes a host port answer on the container's own loopback, so one Supabase URL
 * works for the app in the container and the browser outside it: the token
 * issuer has to match from both.
 */
export function stageCaddyfile({ persona, forwardPort } = {}) {
	let text = renderCaddyfile({ domain: `:${PROXY_INNER_PORT}`, acmeEmail: 'stage@localhost' });

	if (persona) {
		const slot = /\t# === HEADER AUTH SLOT ===\n\t#[^\n]*\n/;
		// A renamed slot would otherwise serve the app with no identity at all.
		if (!slot.test(text)) throw new Error('The Caddyfile no longer has a header-auth slot.');
		// Strip before inject, both at site scope: inside a `handle` block Caddy
		// reorders them and strips the injected values.
		text = text.replace(
			slot,
			[
				'\trequest_header -SELVA-UserPrincipalName',
				'\trequest_header -SELVA-Email',
				'\trequest_header -SELVA-DisplayName',
				`\trequest_header SELVA-UserPrincipalName "${persona.upn}"`,
				`\trequest_header SELVA-Email "${persona.email}"`,
				`\trequest_header SELVA-DisplayName "${persona.displayName}"`,
				''
			].join('\n')
		);
	}

	if (forwardPort) {
		text += `\n:${forwardPort} {\n\tbind 127.0.0.1\n\treverse_proxy host.docker.internal:${forwardPort}\n}\n`;
	}
	return text;
}

/**
 * What a deployment of `mode` installs, and the workspace packages those need
 * at install time. `bump` marks the ones the updater moves.
 */
export function packagesToPublish(mode, workspace) {
	const roots = ['@selvajs/cli', '@selvajs/selva'];
	if (mode === 'supabase') roots.push('@selvajs/supabase-provider');

	const byName = new Map(workspace.map((p) => [p.name, p]));
	const seen = new Map();
	const visit = (name) => {
		const pkg = byName.get(name);
		if (!pkg || seen.has(name)) return;
		seen.set(name, { ...pkg, bump: roots.includes(name) });
		for (const dep of Object.keys(pkg.dependencies)) visit(dep);
	};
	roots.forEach(visit);
	return [...seen.values()];
}

/** `KEY=value` lines of an env file, quotes stripped. */
export function parseEnv(text) {
	const out = {};
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) out[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
	}
	return out;
}

// ============================================================================
// Processes
// ============================================================================

function fail(message) {
	console.error(`\n${message}\n`);
	process.exit(1);
}

// pnpm, npm and npx are .cmd shims on Windows and need a shell, which joins
// args unescaped. Every arg passed to them here is a literal or a path
// relative to the stage folder, so none contains a space.
const SHIMS = new Set(['pnpm', 'npm', 'npx']);

function run(command, args, { quiet = false, ...options } = {}) {
	const viaShell = IS_WINDOWS && SHIMS.has(command);
	const spawnOptions = { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8', ...options };
	// One string for the shell: Node warns (DEP0190) when it has to join args itself.
	const result = viaShell
		? spawnSync([command, ...args].join(' '), { ...spawnOptions, shell: true })
		: spawnSync(command, args, spawnOptions);
	if (result.status !== 0) {
		if (quiet) console.error(`${result.stdout ?? ''}${result.stderr ?? ''}`);
		fail(`Failed: ${command} ${args.join(' ')}`);
	}
	return quiet ? result.stdout : '';
}

function docker(args, options) {
	return run('docker', args, options);
}

/** Runs and reports success, for probes and cleanup that may find nothing. */
function dockerOk(args) {
	return spawnSync('docker', args, { stdio: 'ignore' }).status === 0;
}

/** A script inside the staged host, as the deployment's user. */
function inHost(script, { env = {}, cwd = DEPLOY_DIR, ...options } = {}) {
	const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
	return docker(['exec', ...envArgs, '-w', cwd, HOST, 'bash', '-c', script], options);
}

async function waitFor(label, probe, seconds = 90) {
	for (let i = 0; i < seconds; i++) {
		if (await probe()) return;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	fail(`${label} did not come up within ${seconds}s.`);
}

// ============================================================================
// State
// ============================================================================

function readState() {
	if (!fs.existsSync(statePath)) return null;
	return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function requireState() {
	const state = readState();
	if (!state || !dockerOk(['inspect', HOST])) {
		fail('No staged deployment. Start one with: pnpm stage local|supabase|header');
	}
	return state;
}

function writeState(state) {
	fs.writeFileSync(statePath, JSON.stringify(state, null, '\t') + '\n');
}

function readPersona(name) {
	const file = JSON.parse(
		fs.readFileSync(path.join(rootDir, 'scripts', 'develop', 'dev-personas.json'), 'utf8')
	);
	const persona = file.personas[name ?? file.default];
	if (!persona) {
		fail(`Unknown persona "${name}". Available: ${Object.keys(file.personas).join(', ')}`);
	}
	return { name: name ?? file.default, admin: file.personas.admin, ...persona };
}

// ============================================================================
// Registry
// ============================================================================

const VERDACCIO_CONFIG = `storage: /verdaccio/storage/data
auth:
  htpasswd:
    file: /verdaccio/storage/htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  # No uplink: a staged deployment must never resolve a Selva package from npm.
  '@selvajs/*':
    access: $all
    publish: $authenticated
  '**':
    access: $all
    proxy: npmjs
max_body_size: 200mb
log: { type: stdout, format: pretty, level: warn }
`;

async function startRegistry() {
	const configPath = path.join(stageDir, 'verdaccio.yaml');
	fs.writeFileSync(configPath, VERDACCIO_CONFIG);
	docker(
		[
			'run',
			'-d',
			'--name',
			REGISTRY,
			'--network',
			NETWORK,
			'-p',
			`127.0.0.1:${REGISTRY_PORT}:4873`,
			'-v',
			`${configPath}:/verdaccio/conf/config.yaml:ro`,
			'verdaccio/verdaccio:6'
		],
		{ quiet: true }
	);
	await waitFor('The registry', async () => {
		try {
			return (await fetch(`${REGISTRY_URL}-/ping`)).ok;
		} catch {
			return false;
		}
	});

	const response = await fetch(`${REGISTRY_URL}-/user/org.couchdb.user:stage`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'stage', password: randomUUID() })
	});
	const { token } = await response.json();
	if (!token) fail('The registry did not issue a publish token.');
	fs.writeFileSync(
		path.join(stageDir, 'npmrc'),
		`//localhost:${REGISTRY_PORT}/:_authToken=${token}\n`
	);
}

async function isPublished(name, version) {
	const url = `${REGISTRY_URL}${name.replace('/', '%2F')}/${version}`;
	// The synchronous publishes block the event loop, so fetch has not seen the
	// registry close its idle socket and fails once on reusing it.
	const response = await fetch(url).catch(() => fetch(url));
	return response.ok;
}

function npmToRegistry(args) {
	run('npm', [...args, '--registry', REGISTRY_URL, '--userconfig', 'npmrc', '--loglevel=error'], {
		cwd: stageDir,
		quiet: true
	});
}

function pack(pkg) {
	const packs = path.relative(pkg.dir, path.join(stageDir, 'packs'));
	const out = run('pnpm', ['pack', '--pack-destination', packs], {
		cwd: pkg.dir,
		quiet: true
	});
	return path.basename(out.trim().split('\n').pop().trim());
}

/** Publishes the tree as round `round`. Returns the version of `@selvajs/selva`. */
async function publishRound(mode, round, { broken = false } = {}) {
	fs.mkdirSync(path.join(stageDir, 'packs'), { recursive: true });
	let selvaVersion;

	for (const pkg of packagesToPublish(mode, readWorkspacePackages())) {
		if (!pkg.bump) {
			if (await isPublished(pkg.name, pkg.version)) continue;
			npmToRegistry(['publish', `./packs/${pack(pkg)}`, '--tag', 'latest']);
			console.info(`  ${pkg.name}@${pkg.version}`);
			continue;
		}

		// The version is rewritten inside the unpacked tarball, never in the tree.
		const tarball = pack(pkg);
		const unpacked = path.join(stageDir, 'publish', pkg.name.split('/')[1]);
		fs.rmSync(unpacked, { recursive: true, force: true });
		fs.mkdirSync(unpacked, { recursive: true });
		// Relative paths: GNU tar reads `C:\...` as a remote host.
		run('tar', ['-xzf', tarball, '-C', `../publish/${path.basename(unpacked)}`], {
			cwd: path.join(stageDir, 'packs'),
			quiet: true
		});

		const manifestPath = path.join(unpacked, 'package', 'package.json');
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		manifest.version = stageVersion(pkg.version, round);
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');

		if (pkg.name === '@selvajs/selva') {
			selvaVersion = manifest.version;
			if (broken) {
				const entry = path.join(unpacked, 'package', 'build', 'index.js');
				fs.writeFileSync(entry, `process.exit(1);\n${fs.readFileSync(entry, 'utf8')}`);
			}
		}

		const folder = `./publish/${pkg.name.split('/')[1]}/package`;
		npmToRegistry(['publish', folder, '--ignore-scripts', '--tag', 'latest']);
		// Both channels follow the staged line, so switching channel in the admin
		// page still lands on a staged build.
		npmToRegistry(['dist-tag', 'add', `${pkg.name}@${manifest.version}`, 'beta']);
		console.info(`  ${pkg.name}@${manifest.version}${broken ? '  (will not boot)' : ''}`);
	}

	fs.rmSync(path.join(stageDir, 'publish'), { recursive: true, force: true });
	fs.rmSync(path.join(stageDir, 'packs'), { recursive: true, force: true });
	return selvaVersion;
}

function build(mode) {
	const filters = packagesToPublish(mode, readWorkspacePackages())
		.filter((pkg) => pkg.bump)
		.map((pkg) => `--filter=${pkg.name}`);
	console.info('→ Building…');
	run('pnpm', ['build', ...filters], { cwd: rootDir });
}

// ============================================================================
// Host
// ============================================================================

const HOST_DOCKERFILE = `FROM node:24-bookworm
COPY --from=caddy:2 /usr/bin/caddy /usr/bin/caddy
RUN install -d -o node -g node ${DEPLOY_DIR} /var/log/caddy
USER node
WORKDIR ${DEPLOY_DIR}
`;

function startHost() {
	docker(['build', '-q', '-t', HOST, '-'], { input: HOST_DOCKERFILE, quiet: true });
	docker(
		[
			'run',
			'-d',
			// pm2 daemonizes and the update runner orphans itself: something has to reap.
			'--init',
			'--name',
			HOST,
			'--network',
			NETWORK,
			'--add-host',
			'host.docker.internal:host-gateway',
			'-p',
			`127.0.0.1:${PORT}:${PROXY_INNER_PORT}`,
			HOST,
			'sleep',
			'infinity'
		],
		{ quiet: true }
	);
}

function writeCaddyfile(state) {
	const text = stageCaddyfile({
		persona: state.mode === 'header' ? readPersona(state.persona) : undefined,
		forwardPort: state.supabasePort
	});
	const local = path.join(stageDir, 'Caddyfile');
	fs.writeFileSync(local, text);
	docker(['cp', local, `${HOST}:/home/node/Caddyfile`], { quiet: true });
}

function caddy(verb) {
	return ['bash', '-c', `caddy ${verb} --config /home/node/Caddyfile --adapter caddyfile`];
}

function supabaseEnv() {
	const env = parseEnv(
		fs.readFileSync(path.join(rootDir, 'packages', 'selva', '.env.dev-supabase'), 'utf8')
	);
	return Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('SUPABASE_')));
}

function startSupabase() {
	console.info('→ Starting the Supabase stack and applying migrations…');
	for (const args of [
		['supabase', 'start'],
		['supabase', 'migration', 'up']
	]) {
		// Quiet: `start` prints the stack's keys on every run.
		run('npx', args, { cwd: supabaseDir, quiet: true });
	}
}

/** Scaffolds with the published CLI, exactly as `npx @selvajs/cli <dir>` on a server. */
function scaffold(state) {
	const origin = `http://localhost:${PORT}`;
	const supabase = state.mode === 'supabase' ? supabaseEnv() : {};
	const env = {
		CI: '1',
		SELVA_AUTH_PROVIDER: state.mode,
		ORIGIN: origin,
		...supabase
	};
	if (state.mode === 'header') env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL = readPersona().admin.email;

	console.info('→ Scaffolding with the published CLI…');
	inHost(`npm config set registry ${REGISTRY_URL_IN_NETWORK} && npx --yes @selvajs/cli@latest .`, {
		env
	});

	// The scaffold asks for none of these. NPM_CONFIG_REGISTRY points the update
	// check at the staged registry; npm reads the same variable for the install.
	const extra = {
		NPM_CONFIG_REGISTRY: REGISTRY_URL_IN_NETWORK,
		ADDRESS_HEADER: 'X-Forwarded-For',
		XFF_DEPTH: '1',
		...Object.fromEntries(
			Object.entries(supabase).filter(
				([key]) => !['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].includes(key)
			)
		)
	};
	const lines = Object.entries(extra).map(([key, value]) => `${key}=${value}`);
	docker(['exec', '-i', HOST, 'sh', '-c', `cat >> ${DEPLOY_DIR}/.env`], {
		input: `\n# Added by scripts/develop/stage.mjs\n${lines.join('\n')}\n`,
		quiet: true
	});
}

async function startApp() {
	console.info('→ Starting under pm2…');
	inHost('npm start', { quiet: true });
	// Asked inside the container, past the proxy: in header mode a request
	// through Caddy carries the persona and would claim admin.
	await waitFor('The app', () =>
		dockerOk(['exec', HOST, 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:3000/api/health'])
	);
}

// ============================================================================
// Commands
// ============================================================================

function down({ quiet = false } = {}) {
	for (const name of [HOST, REGISTRY]) dockerOk(['rm', '-f', name]);
	dockerOk(['network', 'rm', NETWORK]);
	fs.rmSync(stageDir, { recursive: true, force: true });
	if (!quiet) console.info('Staged deployment removed.');
}

async function up(mode, argv) {
	if (!dockerOk(['version'])) fail('Docker is not running.');
	const personaIndex = argv.indexOf('--persona');
	const persona = readPersona(personaIndex === -1 ? undefined : argv[personaIndex + 1]);

	down({ quiet: true });
	fs.mkdirSync(stageDir, { recursive: true });

	if (!argv.includes('--no-build')) build(mode);
	if (mode === 'supabase') startSupabase();

	const state = { mode, round: 1, persona: persona.name };
	if (mode === 'supabase') state.supabasePort = Number(new URL(supabaseEnv().SUPABASE_URL).port);

	console.info('→ Starting the registry and publishing this tree…');
	docker(['network', 'create', NETWORK], { quiet: true });
	await startRegistry();
	const version = await publishRound(mode, state.round);
	writeState(state);

	console.info('→ Starting the host…');
	startHost();
	writeCaddyfile(state);
	docker(['exec', '-d', HOST, ...caddy('run')], { quiet: true });

	scaffold(state);
	await startApp();

	const url = `http://localhost:${PORT}`;
	console.info(`\nSelva ${version} is running under pm2 behind Caddy.\n`);
	if (mode === 'header') {
		console.info(`  Open ${url}: Caddy signs you in as ${persona.displayName} <${persona.email}>.`);
		console.info('  Switch identity with: pnpm stage persona <name>');
	} else {
		console.info(inHost('npx selva setup-url', { quiet: true }).trim());
	}
	console.info(`
  pnpm stage publish     publish this tree as the next version, then update at ${url}/admin/system
  pnpm stage logs        update log, pm2 and app output
  pnpm stage sh          a shell in the deployment (npx selva update, doctor, pm2 ls)
  pnpm stage down        remove everything
`);
}

async function publish(argv) {
	const state = requireState();
	if (!argv.includes('--no-build')) build(state.mode);

	state.round += 1;
	const broken = argv.includes('--broken');
	console.info('→ Publishing this tree…');
	const version = await publishRound(state.mode, state.round, { broken });
	writeState(state);

	console.info(`\n${version} is in the registry. Update to it:`);
	console.info(`  in the browser   http://localhost:${PORT}/admin/system`);
	console.info('  on the server    pnpm stage sh, then: npx selva update');
	if (broken) console.info('This build exits at boot: the updater should roll back.');
}

function persona(name) {
	const state = requireState();
	if (state.mode !== 'header') fail('Personas only apply to a header deployment.');
	state.persona = readPersona(name).name;
	writeCaddyfile(state);
	docker(['exec', HOST, ...caddy('reload')], { quiet: true });
	writeState(state);
	console.info(`Caddy now signs you in as "${state.persona}".`);
}

function logs() {
	requireState();
	// -F: the update log does not exist until the first update.
	spawnSync(
		'docker',
		[
			'exec',
			HOST,
			'bash',
			'-c',
			`tail -n 20 -F ${DEPLOY_DIR}/selva-update.log ~/.pm2/pm2.log ~/.pm2/logs/*.log 2>/dev/null`
		],
		{ stdio: 'inherit' }
	);
}

function shell() {
	requireState();
	spawnSync('docker', ['exec', '-it', HOST, 'bash'], { stdio: 'inherit' });
}

const USAGE = `Usage:
  pnpm stage local|supabase|header [--persona <name>] [--no-build]
  pnpm stage publish [--broken] [--no-build]
  pnpm stage persona <name>
  pnpm stage logs | sh | down`;

async function main([command, ...argv]) {
	if (MODES.has(command)) return up(command, argv);
	if (command === 'publish') return publish(argv);
	if (command === 'persona') return persona(argv[0]);
	if (command === 'logs') return logs();
	if (command === 'sh') return shell();
	if (command === 'down') return down();
	fail(USAGE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main(process.argv.slice(2));
}
