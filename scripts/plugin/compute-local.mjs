// Selva's Rhino.Compute server, run in Docker on this machine: the same image, Selva build,
// Yak packages and limits `pnpm run compute:deploy` ships to the GCP VM.
//
//   pnpm compute:local [up|status|logs|down] [--no-build] [--fresh] [--branch <name>]
//
// Settings come from infra/compute/.env (SERVER_<NAME> over <NAME>, as deploy-server.sh reads
// them), else its .env.example. The image is built from compute.rhino3d's pushed branch on
// GitHub, as on the server, so the local checkout's branch doesn't matter.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workDir = path.join(rootDir, '.selva-data', 'compute-local');
const setupDir = path.join(workDir, 'setup');
const computeRepo = path.resolve(rootDir, process.env.COMPUTE_REPO ?? '../compute.rhino3d');

// Its own name and port, so it never replaces another local Compute (rhino-compute-x9 on 6500).
const CONTAINER = 'selva-compute-local';
const PORT = process.env.SELVA_COMPUTE_LOCAL_PORT ?? '6510';

// The GCP VM is an e2-standard-2: 2 vCPUs. Pinned rather than capped: `--cpus 2` only limits CPU
// time, so Rhino still sees every host core and its core-hour billing counts them all.
const MACHINE_CPUSET = '0-1';

// What docker-launch builds the image from. Dockerfile, .dockerignore and start.sh are the build
// context; the rest is the launcher.
const SETUP_FILES = [
	'Dockerfile',
	'.dockerignore',
	'start.sh',
	'env-lib.sh',
	'docker-launch.sh',
	'docker-launch.ps1'
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const branchAt = args.indexOf('--branch');
// What the GCP server builds: the Dockerfile's BRANCH default.
const branch = branchAt >= 0 ? args[branchAt + 1] : '9.x.selva';
const command =
	args.find((a, i) => !a.startsWith('--') && (branchAt < 0 || i !== branchAt + 1)) ?? 'up';

// ============================================================================
// Env files
// ============================================================================

/** Same rules as env-lib.sh's env_value: last assignment wins, quotes and trailing comment dropped. */
function readEnvFile(file) {
	const values = {};
	if (!fs.existsSync(file)) return values;
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
		if (!match) continue;
		const raw = match[2];
		const quoted = /^(["'])(.*?)\1/.exec(raw);
		values[match[1]] = quoted ? quoted[2] : raw.replace(/\s*#.*$/, '').trim();
	}
	return values;
}

function serverSettings() {
	const real = path.join(rootDir, 'infra', 'compute', '.env');
	const file = fs.existsSync(real) ? real : `${real}.example`;
	const env = readEnvFile(file);
	const value = (name) => env[`SERVER_${name}`] || env[name] || '';
	return { file, env, value };
}

/** The server's key when this machine has its .env; otherwise one of its own, kept across runs. */
function computeKey(settings) {
	const key = settings.value('RHINO_COMPUTE_KEY');
	if (key) return key;
	const keyFile = path.join(workDir, 'compute-key');
	if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(24).toString('hex'));
	return fs.readFileSync(keyFile, 'utf8').trim();
}

function rhinoToken(settings) {
	return (
		process.env.RHINO_TOKEN ||
		settings.value('RHINO_TOKEN') ||
		readEnvFile(path.join(computeRepo, 'setup', '.env')).RHINO_TOKEN ||
		''
	);
}

// ============================================================================
// Steps
// ============================================================================

function run(cmd, cmdArgs, options = {}) {
	const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: rootDir, ...options });
	if (result.error) throw new Error(`${cmd}: ${result.error.message}`);
	return result.status ?? 1;
}

function must(cmd, cmdArgs, options) {
	const status = run(cmd, cmdArgs, options);
	if (status !== 0) process.exit(status);
}

function git(gitArgs) {
	const result = spawnSync('git', ['-C', computeRepo, ...gitArgs], { encoding: 'buffer' });
	if (result.status !== 0) {
		console.error(result.stderr.toString());
		process.exit(1);
	}
	return result.stdout;
}

function exportSetup() {
	if (!fs.existsSync(path.join(computeRepo, '.git'))) {
		console.error(
			`${computeRepo} is not a git checkout. Check out compute.rhino3d next to this repo or set COMPUTE_REPO.`
		);
		process.exit(1);
	}
	console.log(`==> compute.rhino3d setup/ from origin/${branch}`);
	git(['fetch', '-q', 'origin', branch]);
	fs.rmSync(setupDir, { recursive: true, force: true });
	fs.mkdirSync(setupDir, { recursive: true });
	for (const file of SETUP_FILES) {
		// Blob bytes as committed: start.sh must keep its LF endings.
		fs.writeFileSync(path.join(setupDir, file), git(['show', `origin/${branch}:setup/${file}`]));
	}
}

/**
 * The deploy ships a copy of the build, not a live mount: rebuilding for a local Rhino must not
 * swap the plugin under a running Compute.
 */
function stagePlugins(settings) {
	const build = settings.value('DEPLOY_BUILD');
	if (build && !flag('no-build')) {
		console.log(`==> ${build}`);
		must(build, [], { shell: true });
	}

	const pluginDirs = (settings.value('DEPLOY_PLUGINS') || '')
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
	const staged = [];
	fs.rmSync(path.join(workDir, 'plugins'), { recursive: true, force: true });
	for (const dir of pluginDirs) {
		const source = path.resolve(rootDir, dir);
		if (!fs.existsSync(source)) {
			console.error(`Plugin build not found: ${source}`);
			process.exit(1);
		}
		// Named as docker-launch names mounts: the folder, past build-output names.
		let walk = source;
		while (/^(net[0-9].*|Release|Debug|bin|obj|Build)$/.test(path.basename(walk)))
			walk = path.dirname(walk);
		const target = path.join(workDir, 'plugins', path.basename(walk));
		fs.cpSync(source, target, { recursive: true });
		staged.push(target);
	}

	const packages = path.resolve(
		path.dirname(settings.file),
		settings.env.DEPLOY_PACKAGES || 'packages.json'
	);
	fs.copyFileSync(packages, path.join(setupDir, 'packages.json'));
	return staged;
}

function up() {
	const settings = serverSettings();
	const token = rhinoToken(settings);
	if (!token) {
		console.error(
			'No RHINO_TOKEN: set it in the shell, infra/compute/.env or compute.rhino3d/setup/.env.'
		);
		process.exit(1);
	}
	console.log(`==> Settings from ${path.relative(rootDir, settings.file)}`);

	exportSetup();
	const plugins = stagePlugins(settings);
	const key = computeKey(settings);

	const env = {
		...process.env,
		RHINO_TOKEN: token,
		RHINO_COMPUTE_KEY: key,
		IMAGE_NAME: CONTAINER,
		CONTAINER_NAME: CONTAINER,
		PORT,
		BRANCH: branch,
		LOCAL_PLUGINS: plugins.join(','),
		CHILD_COUNT: settings.value('CHILD_COUNT') || '1',
		CPUSET: settings.value('CPUSET') || MACHINE_CPUSET,
		MEMORY: settings.value('MEMORY'),
		CACHE_LIMIT_PERCENT: settings.value('CACHE_LIMIT_PERCENT'),
		IDLE_SPAN: settings.value('IDLE_SPAN'),
		...(flag('fresh') && { FRESH: '1' })
	};
	// Empty values would override the launcher's own defaults with nothing.
	for (const name of Object.keys(env)) if (env[name] === '') delete env[name];

	// The .ps1 on Windows: Git Bash rewrites `-v D:/x:/plugins` path lists into nonsense. pwsh,
	// not Windows PowerShell: 5.1 reads the BOM-less UTF-8 script as ANSI and fails to parse it.
	const status =
		process.platform === 'win32'
			? run(
					'pwsh',
					[
						'-NoProfile',
						'-ExecutionPolicy',
						'Bypass',
						'-File',
						path.join(setupDir, 'docker-launch.ps1')
					],
					{ env }
				)
			: run('bash', [path.join(setupDir, 'docker-launch.sh')], { env });
	if (status !== 0) process.exit(status);

	console.log(`
  Selva's Compute, local: http://localhost:${PORT}   key: ${key}

  Add it at /admin/compute:
    pnpm dev:selva          http://localhost:${PORT}
    pnpm stage <provider>   http://host.docker.internal:${PORT}

  pnpm compute:local status | logs | down
`);
}

function status() {
	run('docker', [
		'ps',
		'-a',
		'--filter',
		`name=^${CONTAINER}$`,
		'--format',
		'{{.Names}}  {{.Status}}  {{.Image}}'
	]);
	const key = computeKey(serverSettings());
	run('curl', [
		'-s',
		'-o',
		'-',
		'-w',
		'\nhealthcheck: %{http_code}\n',
		'-H',
		`RhinoComputeKey: ${key}`,
		`http://localhost:${PORT}/healthcheck`
	]);
	run('curl', [
		'-s',
		'-w',
		'\n',
		'-H',
		`RhinoComputeKey: ${key}`,
		`http://localhost:${PORT}/version`
	]);
}

switch (command) {
	case 'up':
		up();
		break;
	case 'status':
		status();
		break;
	case 'logs':
		process.exit(run('docker', ['logs', '-f', '--tail', '200', CONTAINER]));
		break;
	case 'down':
		process.exit(run('docker', ['rm', '-f', CONTAINER]));
		break;
	default:
		console.error(
			'Usage: pnpm compute:local [up|status|logs|down] [--no-build] [--fresh] [--branch <name>]'
		);
		process.exit(1);
}
