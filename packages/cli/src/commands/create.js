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
import {
	isEmptyOrMissing,
	requiredNodeRange,
	runtimeTemplatePath,
	scaffoldVersion
} from '../paths.js';
import { buildDeploymentPackageJson } from '../deployment-package.js';
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

	// package.json first: npm install needs it, and the runtime templates below
	// only exist once @selvajs/selva is installed into node_modules.
	const pkgJson = JSON.stringify(buildDeploymentPackageJson({ name: deployName }), null, 2);
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
		writeFileSync(join(targetDir, '.selva-version'), scaffoldVersion() + '\n', 'utf8');
		p.outro(`Partial scaffold at ${pc.cyan(targetDir)}.`);
		return;
	}

	writeEnvFile(join(targetDir, '.env'), readFileSync(envTemplatePath, 'utf8'), values);

	cpSync(ecosystemTemplatePath, join(targetDir, 'ecosystem.config.cjs'));

	writeFileSync(join(targetDir, '.selva-version'), scaffoldVersion() + '\n', 'utf8');
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

			// Without this the operator has to dig through ~/.npm/_logs/*-debug-0.log
			// to find out what actually went wrong.
			console.error('');
			console.error(pc.dim('── last lines of npm output ──'));
			for (const line of tail) console.error(line);
			console.error(pc.dim('──────────────────────────────'));

			if (sawBrokenVersion) {
				console.error('');
				console.error(
					pc.yellow(
						'npm resolved @selvajs/selva@0.10.2 — that version is broken (unresolved\n' +
							'workspace:* / catalog: specs) and has been unpublished. Your local npm\n' +
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
