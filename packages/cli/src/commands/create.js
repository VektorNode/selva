// Scaffold a fresh deployment: write .env (merged from template + prompts),
// ecosystem.config.cjs, package.json, and bootstrap node_modules. Runtime
// templates are the source of truth; providers are env-driven.

import { writeFileSync, existsSync, mkdirSync, readFileSync, cpSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { collectConfig, collectConfigFromEnv } from '../prompts.js';
import { generateKey } from '../secrets.js';
import { writeEnvFile } from '../env.js';
import { isEmptyOrMissing, requiredNodeRange } from '../paths.js';
import { satisfiesNodeRange } from './doctor.js';

const CLI_VERSION = '0.1.0';

export async function runCreate(argv) {
	const { dir: rawDir, force, skipInstall, yes } = parseArgs(argv);

	// Scaffolding under too old a Node produces a deployment that installs
	// cleanly and passes its health check, then fails only under real traffic —
	// npm treats an engine mismatch as a warning unless engine-strict is set,
	// which no deployment sets (issue #176). Refuse at the one moment the
	// operator is still choosing their environment. The floor comes from this
	// CLI's own engines.node, so a bump can't leave a stale copy behind.
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

	// --yes or CI=1 skips prompts (unattended bootstrap).
	const nonInteractive = yes || envBool(process.env.CI);
	const values = nonInteractive
		? collectConfigFromEnv(process.env)
		: await collectConfig({ defaults: {}, mode: 'create' });

	// Generate fresh secrets (stable across restarts; init refuses to regen).
	values.SELVA_HMAC_KEY = generateKey();
	values.SELVA_AT_REST_KEY = generateKey();

	const deployName = basename(targetDir);

	// Write package.json, then install (need templates from @selvajs/selva).
	const pkgJson = buildPackageJson(deployName, values);
	writeFileSync(join(targetDir, 'package.json'), pkgJson + '\n', 'utf8');

	if (!skipInstall) {
		await runNpmInstall(targetDir);
	} else {
		p.log.warn(
			'--skip-install was passed: dependencies not installed. Run `npm install` manually before starting.'
		);
	}

	// Copy templates from installed runtime.
	const runtimeTemplates = join(targetDir, 'node_modules', '@selvajs', 'selva', 'templates');
	if (skipInstall || !existsSync(runtimeTemplates)) {
		p.log.warn(
			`Couldn't read runtime templates from ${runtimeTemplates}. ` +
				`Run \`npm install\`, then \`selva init\` to finish setup.`
		);
		writeFileSync(join(targetDir, '.selva-version'), CLI_VERSION + '\n', 'utf8');
		p.outro(`Partial scaffold at ${pc.cyan(targetDir)}.`);
		return;
	}

	const envTemplate = readFileSync(join(runtimeTemplates, '.env.example'), 'utf8');
	writeEnvFile(join(targetDir, '.env'), envTemplate, values);

	cpSync(join(runtimeTemplates, 'ecosystem.config.cjs'), join(targetDir, 'ecosystem.config.cjs'));

	writeFileSync(join(targetDir, '.selva-version'), CLI_VERSION + '\n', 'utf8');
	writeGitignore(targetDir);

	p.outro(
		[
			pc.green('Scaffolded ' + pc.cyan(targetDir)),
			'',
			pc.bold('Next steps:'),
			`  cd ${rawDir}`,
			`  npm run doctor         # sanity-check the install`,
			`  npm start              # pm2 start ecosystem.config.cjs`,
			'',
			values.ORIGIN
				? `Then visit ${pc.cyan(values.ORIGIN)} (set up your reverse proxy first).`
				: `Then visit ${pc.cyan('http://localhost:3000')}.`
		].join('\n')
	);
}

// Stream npm output with live progress; on failure, show tail for debugging.
// Cache-bust hint: surface broken versions like @selvajs/selva@0.10.2.
function runNpmInstall(cwd) {
	return new Promise((resolveP, rejectP) => {
		const s = p.spinner();
		s.start('Installing dependencies (this can take a minute)');

		// Keep last 80 lines for failure output.
		const tail = [];
		const remember = (line) => {
			tail.push(line);
			if (tail.length > 80) tail.shift();
		};

		// Extract progress milestones (reify: lines, package count).
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

		// Spawn with --loglevel=info for reify: progress; pipe stdout/stderr for live updates.
		const child = spawn('npm', ['install', '--loglevel=info'], {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: process.platform === 'win32'
		});

		let sawBrokenVersion = false;
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
					if (line.includes('@selvajs/selva@0.10.2')) sawBrokenVersion = true;
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

			// Show what npm actually said. Without this the operator has to
			// dig through ~/.npm/_logs/*-debug-0.log to find a single line.
			console.error('');
			console.error(pc.dim('── last lines of npm output ──'));
			for (const line of tail) console.error(line);
			console.error(pc.dim('──────────────────────────────'));

			if (sawBrokenVersion) {
				console.error('');
				console.error(
					pc.yellow(
						'npm resolved @selvajs/selva@0.10.2 — that version is broken (unresolved\n' +
							"workspace:* / catalog: specs) and has been unpublished. Your local npm\n" +
							'cache is stale. Clear it and retry:\n\n' +
							'  npm cache clean --force\n' +
							'  rm -rf node_modules package-lock.json\n' +
							'  npm install --prefer-online'
					)
				);
			}

			rejectP(new Error(`npm install exited with code ${code}`));
		});
	});
}

function parseArgs(argv) {
	let dir;
	let force = false;
	let skipInstall = false;
	let yes = false;
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
		throw new Error(
			'Usage: npx @selvajs/cli <directory> [--force] [--skip-install] [--yes]'
		);
	}
	return { dir, force, skipInstall, yes };
}

function envBool(v) {
	if (!v) return false;
	return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
}

// Depends on @selvajs/selva (prebuilt) + @selvajs/cli (operator tool).
// @selvajs/cli links the `selva` bin; without it, only global CLI works.
function buildPackageJson(name /*, values */) {
	const deps = {
		'@selvajs/cli': 'latest',
		'@selvajs/selva': 'latest',
		// Deployment-local pm2 (pinned exact to prevent daemon version skew).
		pm2: '5.4.3'
	};

	const pkg = {
		name: sanitizePackageName(name),
		version: '0.1.0',
		private: true,
		type: 'module',
		scripts: {
			start: 'selva start',
			stop: 'selva stop',
			restart: 'selva restart',
			logs: 'selva logs',
			doctor: 'selva doctor',
			update: 'selva update'
		},
		dependencies: deps
	};
	return JSON.stringify(pkg, null, 2);
}

function sanitizePackageName(name) {
	// npm package names: lowercase, no spaces, limited punctuation.
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^[-._]+|[-._]+$/g, '') || 'selva-deployment'
	);
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
