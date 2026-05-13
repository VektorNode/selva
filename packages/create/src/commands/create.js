// `npx @selvajs/create <dir>` — scaffold a fresh deployment.
//
// What this writes into <dir>:
//   .env                    merged from runtime's .env.example + prompt values
//   selva.config.js         copied from runtime's templates (operator can edit)
//   ecosystem.config.cjs    copied verbatim
//   package.json            depends on @selvajs/selva + providers
//   .selva-version          marker for future CLI migrations
//   node_modules/           after `npm install`
//
// The runtime templates are the source of truth — we don't carry our own
// copies in @selvajs/create. We install @selvajs/selva first, then copy
// from node_modules/@selvajs/selva/templates/.

import { writeFileSync, existsSync, mkdirSync, readFileSync, cpSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { collectConfig } from '../prompts.js';
import { generateKey } from '../secrets.js';
import { writeEnvFile } from '../env.js';
import { isEmptyOrMissing } from '../paths.js';

const CLI_VERSION = '0.1.0';

export async function runCreate(argv) {
	const { dir: rawDir, force, skipInstall } = parseArgs(argv);

	const targetDir = resolve(rawDir);
	if (!isEmptyOrMissing(targetDir) && !force) {
		console.error(
			`${pc.red('✗')} ${targetDir} already exists and isn't empty. ` +
				`Pass --force to overwrite, or choose another directory.`
		);
		process.exit(1);
	}
	mkdirSync(targetDir, { recursive: true });

	// 1. Prompt the operator. We need answers before installing because the
	//    chosen provider determines which dependencies go into package.json.
	const values = await collectConfig({ defaults: {}, mode: 'create' });

	// 2. Always generate fresh secrets for a new install. They MUST be stable
	//    across restarts; the env-merge logic below writes them once and
	//    `selva init` later refuses to regenerate them.
	values.SELVA_HMAC_KEY = generateKey();
	values.SELVA_AT_REST_KEY = generateKey();

	const deployName = basename(targetDir);

	// 3. Write package.json before installing so npm has something to read.
	const pkgJson = buildPackageJson(deployName, values);
	writeFileSync(join(targetDir, 'package.json'), pkgJson + '\n', 'utf8');

	// 4. Install. We need @selvajs/selva on disk to copy templates from it.
	if (!skipInstall) {
		await runNpmInstall(targetDir);
	} else {
		p.log.warn(
			'--skip-install was passed: dependencies not installed. Run `npm install` manually before starting.'
		);
	}

	// 5. Now copy templates from the installed runtime and fill them in.
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

	cpSync(join(runtimeTemplates, 'selva.config.example.js'), join(targetDir, 'selva.config.js'));
	cpSync(join(runtimeTemplates, 'ecosystem.config.cjs'), join(targetDir, 'ecosystem.config.cjs'));

	writeFileSync(join(targetDir, '.selva-version'), CLI_VERSION + '\n', 'utf8');
	writeGitignore(targetDir);

	// 6. Outro with next steps.
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

// Run `npm install` with live progress and a real error report.
//
// The previous implementation used execSync + stdio:'pipe' which buffered
// everything in memory and discarded it on failure — operators saw "Command
// failed: npm install" with no clue what went wrong. We stream stdout/stderr
// into a ring buffer instead, and on failure dump the last lines so they can
// act on the actual error (sharp's libvips missing, registry timeout, etc.)
// without fishing through /home/user/.npm/_logs/.
//
// Cache-bust hint: if npm prints a placeDep for @selvajs/selva@0.10.2
// (which was published broken and unpublished), surface that so the operator
// knows to `npm cache clean --force`.
function runNpmInstall(cwd) {
	return new Promise((resolveP, rejectP) => {
		const s = p.spinner();
		s.start('Installing dependencies (this can take a minute)');

		// Ring buffer — keep the last 80 lines so we can show them on failure.
		const tail = [];
		const maxTail = 80;
		const remember = (line) => {
			tail.push(line);
			if (tail.length > maxTail) tail.shift();
		};

		// Visible progress milestones. npm doesn't emit a clean progress
		// stream; we cherry-pick recognizable transitions and pass them to
		// the spinner so the operator sees movement.
		const updateProgress = (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			// "added 412 packages" — final summary
			if (/^added \d+ packages/.test(trimmed)) {
				s.message('Finalizing installation');
				return;
			}
			// "reify:foo: timing reifyNode..." — npm 8/9/10 progress lines.
			// Pull the package name out and show it.
			const reify = trimmed.match(/^reify:([^:]+):/);
			if (reify) {
				s.message(`Installing ${pc.cyan(reify[1])}`);
				return;
			}
			// "npm WARN ..." / "npm error ..." — pass through prefixed.
			if (/^npm (WARN|error|notice)/.test(trimmed)) {
				// Don't change the spinner message for these — they're noisy.
				return;
			}
		};

		// Spawn npm with --loglevel=info so we get reify: progress lines.
		// We DO NOT use stdio: 'inherit' because that would interleave with
		// the spinner; we DO want a live read so we can update the message.
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
	for (const arg of argv) {
		if (arg === '--force') force = true;
		else if (arg === '--skip-install') skipInstall = true;
		else if (arg.startsWith('--')) {
			throw new Error(`Unknown flag: ${arg}`);
		} else if (!dir) {
			dir = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}
	if (!dir) {
		throw new Error('Usage: npx @selvajs/create <directory> [--force] [--skip-install]');
	}
	return { dir, force, skipInstall };
}

// The deployment's package.json depends on @selvajs/selva (prebuilt
// SvelteKit app) plus whichever providers the operator picked. Providers are
// imported by selva.config.js — npm needs them resolvable from node_modules.
//
// We also list @selvajs/create itself as a dep so the `selva` bin gets linked
// into node_modules/.bin/. Without this the operator's only way to run
// `selva doctor` / `selva start` is a global install of the CLI.
function buildPackageJson(name, values) {
	const deps = {
		'@selvajs/create': 'latest',
		'@selvajs/platform': 'latest',
		'@selvajs/selva': 'latest'
	};

	const providers = new Set([
		values.SELVA_AUTH_PROVIDER,
		values.SELVA_DATA_PROVIDER,
		values.SELVA_STORAGE_PROVIDER
	]);

	if (providers.has('local')) deps['@selvajs/local-provider'] = 'latest';
	if (providers.has('supabase')) deps['@selvajs/supabase-provider'] = 'latest';
	if (providers.has('header')) deps['@selvajs/header-auth-provider'] = 'latest';

	// Use `selva` (resolved via node_modules/.bin) in the npm scripts. Running
	// them as `npm run start` / `npm run doctor` works without remembering the
	// ./node_modules/.bin/ prefix.
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
