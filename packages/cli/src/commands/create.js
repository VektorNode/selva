// Scaffolds a fresh deployment: package.json, node_modules, .env (merged from
// template + prompts), and ecosystem.config.cjs.

import { writeFileSync, existsSync, mkdirSync, readFileSync, cpSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { collectConfig, collectConfigFromEnv } from '../prompts.js';
import { generateKey } from '../secrets.js';
import { writeEnvFile } from '../env.js';
import { isEmptyOrMissing, requiredNodeRange, runtimeTemplatePath } from '../paths.js';
import {
	buildDeploymentPackageJson,
	needsSupabaseProvider,
	npmDistTagVersion,
	resolveSelvaPins
} from '../deployment-package.js';
import { satisfiesNodeRange } from '../node-range.js';

export async function runCreate(argv) {
	const { dir: rawDir, force, skipInstall, yes } = parseArgs(argv);

	// Scaffolding under too old a Node installs and passes the health check,
	// then fails only under real traffic — npm treats an engine mismatch as a
	// warning, not an error, unless engine-strict is set, which no deployment
	// sets. Refuse now, while the operator is still choosing their environment.
	const required = requiredNodeRange();
	if (required && satisfiesNodeRange(process.versions.node, required) === false) {
		console.error(
			`${pc.red('✗')} Selva requires Node ${required}, but this shell runs ` +
				`v${process.versions.node}.\n` +
				`  A deployment scaffolded here would install and start, then fail once real\n` +
				`  requests hit newer Node APIs. Upgrade Node first (nvm, fnm, or your package\n` +
				`  manager), then re-run this command.`
		);
		process.exit(1);
	}

	const targetDir = resolve(rawDir);
	if (!isEmptyOrMissing(targetDir) && !force) {
		console.error(
			`${pc.red('✗')} ${targetDir} already exists and isn't empty. ` +
				`Pass --force to overwrite, or choose another directory.`
		);
		process.exit(1);
	}
	mkdirSync(targetDir, { recursive: true });

	const nonInteractive = yes || envBool(process.env.CI);
	const values = nonInteractive
		? collectConfigFromEnv(process.env)
		: await collectConfig({ defaults: {}, mode: 'create' });

	values.SELVA_HMAC_KEY = generateKey();
	values.SELVA_AT_REST_KEY = generateKey();

	const deployName = basename(targetDir);

	// Resolve the dist-tags to concrete versions before writing. A stored
	// `"latest"` re-resolves on every later `npm install`, so the deployment
	// would follow the tag instead of the version it was scaffolded against —
	// and `selva doctor` reports a floating pin as drift.
	const supabase = needsSupabaseProvider(values);
	const { pins } = resolveSelvaPins(
		{},
		npmDistTagVersion,
		supabase ? ['@selvajs/supabase-provider'] : []
	);

	// package.json first: npm install needs it, and the runtime templates below
	// only exist once @selvajs/selva is installed into node_modules.
	const pkgJson = JSON.stringify(
		buildDeploymentPackageJson({ name: deployName, dependencies: pins, supabase }),
		null,
		2
	);
	writeFileSync(join(targetDir, 'package.json'), pkgJson + '\n', 'utf8');

	if (!skipInstall) {
		await runNpmInstall(targetDir);
	} else {
		p.log.warn(
			'--skip-install was passed: dependencies not installed. Run `npm install` manually before starting.'
		);
	}

	const envTemplatePath = runtimeTemplatePath(targetDir, '.env.example');
	const ecosystemTemplatePath = runtimeTemplatePath(targetDir, 'ecosystem.config.cjs');
	if (skipInstall || !existsSync(envTemplatePath)) {
		p.log.warn(
			`Couldn't read runtime templates from ${dirname(envTemplatePath)}. ` +
				`Run \`npm install\`, then \`selva init\` to finish setup.`
		);
		p.outro(`Partial scaffold at ${pc.cyan(targetDir)}.`);
		return;
	}

	writeEnvFile(join(targetDir, '.env'), readFileSync(envTemplatePath, 'utf8'), values);

	cpSync(ecosystemTemplatePath, join(targetDir, 'ecosystem.config.cjs'));

	writeGitignore(targetDir);

	p.outro(nextSteps({ rawDir, values, supabase }).join('\n'));
}

/**
 * The remaining work, in the order it has to happen.
 *
 * Ordered by dependency, not by importance: the schema has to exist before the
 * app can serve a request, and the proxy has to terminate TLS before a browser
 * will keep the session cookie. A list that mentioned them in any other order
 * would have the operator debugging a 503 or a login loop that the next step
 * was about to fix.
 */
function nextSteps({ rawDir, values, supabase }) {
	const lines = [
		pc.green('Scaffolded ' + pc.cyan(targetDirLabel(rawDir))),
		'',
		pc.bold('Next steps:')
	];
	let n = 1;

	lines.push(`  ${n++}. cd ${rawDir}`);

	if (supabase) {
		lines.push(
			`  ${n++}. Apply the database schema (once per Supabase project):`,
			pc.dim('       npx supabase login          # or: export SUPABASE_ACCESS_TOKEN=sbp_...'),
			pc.dim('       npx selva-supabase          # copy migrations into ./supabase'),
			pc.dim('       npx supabase link --project-ref <ref>'),
			pc.dim('       npx supabase db push'),
			// `link` fails without an ACCOUNT credential, which is none of the three
			// project keys the prompts just collected — the distinction is the most
			// common first-run stall, so name it here rather than only in the docs.
			pc.dim('       (login is a Supabase account credential — not the keys in .env)')
		);
	}

	lines.push(
		`  ${n++}. npm run doctor${pc.dim('       # verify config, schema, and boot persistence')}`
	);
	lines.push(`  ${n++}. npm start${pc.dim('            # start under pm2')}`);

	if (values.ORIGIN?.startsWith('https://')) {
		lines.push(
			`  ${n++}. npx selva setup-proxy${pc.dim(' # Caddy + TLS for ' + hostOf(values.ORIGIN))}`
		);
	}

	lines.push(
		'',
		values.ORIGIN
			? `Then visit ${pc.cyan(values.ORIGIN)} and open ${pc.cyan('/setup')} to claim admin.`
			: `Then visit ${pc.cyan('http://localhost:3000')} and open ${pc.cyan('/setup')} to claim admin.`,
		'',
		pc.dim('`npm run doctor --fix` repairs what it can, including pm2 boot persistence.')
	);
	return lines;
}

function targetDirLabel(rawDir) {
	return resolve(rawDir);
}

function hostOf(origin) {
	try {
		return new URL(origin).host;
	} catch {
		return origin;
	}
}

function runNpmInstall(cwd) {
	return new Promise((resolveP, rejectP) => {
		const s = p.spinner();
		s.start('Installing dependencies (this can take a minute)');

		const tail = [];
		const remember = (line) => {
			tail.push(line);
			if (tail.length > 80) tail.shift();
		};

		const updateProgress = (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			if (/^added \d+ packages/.test(trimmed)) {
				s.message('Finalizing installation');
				return;
			}
			const reify = trimmed.match(/^reify:([^:]+):/);
			if (reify) {
				s.message(`Installing ${pc.cyan(reify[1])}`);
				return;
			}
			if (/^npm (WARN|error|notice)/.test(trimmed)) return;
		};

		// --loglevel=info is what makes npm print the reify: lines updateProgress matches on.
		const child = spawn('npm', ['install', '--loglevel=info'], {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: process.platform === 'win32'
		});

		const handleStream = (stream) => {
			let buf = '';
			stream.setEncoding('utf8');
			stream.on('data', (chunk) => {
				buf += chunk;
				const lines = buf.split('\n');
				buf = lines.pop() ?? '';
				for (const line of lines) {
					remember(line);
					updateProgress(line);
				}
			});
			stream.on('end', () => {
				if (buf) {
					remember(buf);
					updateProgress(buf);
				}
			});
		};
		handleStream(child.stdout);
		handleStream(child.stderr);

		child.on('error', (err) => {
			s.stop(pc.red('npm install could not start'));
			rejectP(err);
		});

		child.on('close', (code) => {
			if (code === 0) {
				s.stop(pc.green('Dependencies installed'));
				resolveP();
				return;
			}
			s.stop(pc.red(`npm install failed (exit ${code})`));

			// Without this the operator has to dig through ~/.npm/_logs/*-debug-0.log
			// to find out what actually went wrong.
			console.error('');
			console.error(pc.dim('── last lines of npm output ──'));
			for (const line of tail) console.error(line);
			console.error(pc.dim('──────────────────────────────'));

			// A stale npm cache resolves versions that no longer exist on the
			// registry, and the error it produces names the package rather than the
			// cache — so this is worth suggesting on any install failure.
			console.error('');
			console.error(
				pc.yellow(
					'If the output above names a version that cannot be resolved, the local\n' +
						'npm cache is stale. Clear it and retry:\n\n' +
						'  npm cache clean --force\n' +
						'  rm -rf node_modules package-lock.json\n' +
						'  npm install --prefer-online'
				)
			);

			rejectP(new Error(`npm install exited with code ${code}`));
		});
	});
}

// `npx @selvajs/cli` resolves to the `cli` bin — the scaffolder — while every
// operate command lives on the sibling `selva` bin. So `npx @selvajs/cli doctor
// --fix` lands here, where "doctor" is just a directory name and `--fix` an
// unknown flag. Name the bin split rather than letting the operator conclude
// their CLI is too old for a flag it has shipped for releases.
const OPERATE_COMMANDS = new Set([
	'doctor',
	'start',
	'stop',
	'restart',
	'logs',
	'update',
	'migrate',
	'keys',
	'init'
]);

function parseArgs(argv) {
	let dir;
	let force = false;
	let skipInstall = false;
	let yes = false;

	if (OPERATE_COMMANDS.has(argv[0])) {
		throw new Error(
			`\`${argv[0]}\` is an operate command, but \`npx @selvajs/cli\` runs the scaffolder.\n` +
				`  Run it through the deployment's own CLI instead:\n` +
				`    npx selva ${argv.join(' ')}`
		);
	}

	for (const arg of argv) {
		if (arg === '--force') force = true;
		else if (arg === '--skip-install') skipInstall = true;
		else if (arg === '--yes' || arg === '-y') yes = true;
		else if (arg.startsWith('--')) {
			throw new Error(`Unknown flag: ${arg}`);
		} else if (!dir) {
			dir = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}
	if (!dir) {
		throw new Error('Usage: npx @selvajs/cli <directory> [--force] [--skip-install] [--yes]');
	}
	return { dir, force, skipInstall, yes };
}

function envBool(v) {
	if (!v) return false;
	return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
}

function writeGitignore(dir) {
	const path = join(dir, '.gitignore');
	if (existsSync(path)) return;
	writeFileSync(
		path,
		['node_modules/', '.env', '.env.local', '.selva-data/', 'logs/', '*.log', ''].join('\n'),
		'utf8'
	);
}
