#!/usr/bin/env node

// ============================================================================
// Downgrade check: can the latest stable release read what this build writes?
// ============================================================================
//
// An operator who switches the release channel back lands on the latest stable
// with whatever this build left on disk. If stable cannot read it, the switch
// breaks their deployment, and nothing in a normal test run notices: each
// build's own tests only read what that build wrote.
//
// This script hands one data folder back and forth between two builds of the
// local provider: the latest stable from npm, and this checkout's `dist`.
//
//   1. stable seeds the folder and reads it          (baseline)
//   2. this build boots on it and reads it           (upgrade)
//   3. stable boots on it and reads it               (downgrade after a boot)
//   4. this build saves, then stable reads again     (downgrade after a save)
//
// A broken upgrade always fails. A broken downgrade fails unless this build
// declares a higher `selva.dataFormat` than stable in packages/selva/package.json:
// that number is what makes the updater refuse the downgrade
// (packages/selva/src/lib/server/dataFormat.server.ts). So a failure here means
// one of two fixes: keep the data readable by stable, or bump the number.
//
// It covers the compute-server store, the one store that rewrites data on boot.
// A store that starts doing so needs a step in downgrade-check-worker.mjs.
//
// Requires built packages and network access: run `pnpm build` first.
// `pnpm release` runs this between the pack check and publish.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const WORKER = join(HERE, 'downgrade-check-worker.mjs');

/** The format a `package.json` declares. None means format 1. */
export function declaredDataFormat(pkg) {
	const value = pkg?.selva?.dataFormat;
	return Number.isInteger(value) && value >= 1 ? value : 1;
}

/**
 * Pass or fail from what the four steps found. `problems` lists every read that
 * went wrong, each prefixed `upgrade:` or `downgrade:`.
 */
export function verdict({ problems, stableFormat, newFormat }) {
	const upgrade = problems.filter((p) => p.startsWith('upgrade:'));
	const downgrade = problems.filter((p) => p.startsWith('downgrade:'));

	if (upgrade.length > 0) {
		return {
			pass: false,
			summary: 'This build cannot read data the latest stable release wrote.',
			problems: upgrade
		};
	}
	if (downgrade.length === 0) {
		return { pass: true, summary: 'The latest stable release reads everything this build writes.' };
	}
	if (newFormat > stableFormat) {
		return {
			pass: true,
			summary:
				`The latest stable release cannot read this build's data, and the build says so: ` +
				`data format ${stableFormat} → ${newFormat}. The updater refuses that downgrade.`,
			problems: downgrade
		};
	}
	return {
		pass: false,
		summary:
			`The latest stable release cannot read this build's data, and both declare data format ` +
			`${newFormat}. Keep the data readable by stable, or bump DATA_FORMAT in ` +
			'packages/selva/src/lib/server/dataFormat.server.ts and `selva.dataFormat` in ' +
			'packages/selva/package.json.',
		problems: downgrade
	};
}

function npm(args, cwd) {
	return execFileSync('npm', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		shell: process.platform === 'win32'
	});
}

function build(dir) {
	const entry = (pkg) => join(dir, pkg, 'dist', 'index.js');
	return { provider: entry('local-provider'), platform: entry('platform') };
}

function main() {
	const ours = {
		provider: join(ROOT, 'packages/providers/local/dist/index.js'),
		platform: join(ROOT, 'packages/platform/dist/index.js')
	};
	for (const file of Object.values(ours)) {
		if (!existsSync(file)) {
			console.error(`downgrade-check: ${file} is missing. Run \`pnpm build\` first.`);
			process.exit(1);
		}
	}

	const work = mkdtempSync(join(tmpdir(), 'selva-downgrade-'));
	try {
		writeFileSync(join(work, 'package.json'), '{"private":true}');
		npm(
			[
				'install',
				'--no-audit',
				'--no-fund',
				'--silent',
				'@selvajs/local-provider@latest',
				'@selvajs/platform@latest'
			],
			work
		);
		const stable = build(join(work, 'node_modules', '@selvajs'));
		const stableVersion = JSON.parse(
			readFileSync(join(dirname(dirname(stable.provider)), 'package.json'), 'utf8')
		).version;

		const published = npm(['view', '@selvajs/selva@latest', 'selva', '--json'], work).trim();
		const stableFormat = declaredDataFormat({ selva: published ? JSON.parse(published) : null });
		const newFormat = declaredDataFormat(
			JSON.parse(readFileSync(join(ROOT, 'packages/selva/package.json'), 'utf8'))
		);

		const data = join(work, 'data');
		const run = (which, step) =>
			JSON.parse(
				execFileSync(process.execPath, [WORKER, which.provider, which.platform, data, step], {
					encoding: 'utf8'
				})
			);

		const problems = [];
		// `expected` names the servers that exist at this point; each must read back.
		const check = (phase, which, expected) => {
			const boot = run(which, 'boot');
			const { keys } = run(which, 'read');
			if (!boot.verified)
				problems.push(`${phase}: boot check failed: ${JSON.stringify(boot.failures)}`);
			for (const name of expected) {
				if (keys[name] !== 'ok') problems.push(`${phase}: key of "${name}" server: ${keys[name]}`);
			}
		};

		run(stable, 'seed');
		check('baseline', stable, ['seeded']);
		if (problems.length > 0) {
			console.error('downgrade-check: stable cannot read its own data, so the check is broken:');
			for (const p of problems) console.error(`  ${p}`);
			process.exit(1);
		}

		check('upgrade: after boot', ours, ['seeded']);
		check('downgrade: after boot', stable, ['seeded']);
		run(ours, 'touch');
		check('upgrade: after save', ours, ['seeded', 'touched']);
		check('downgrade: after save', stable, ['seeded', 'touched']);

		const result = verdict({ problems, stableFormat, newFormat });
		console.log(
			`downgrade-check: @selvajs/local-provider@${stableVersion} (stable, data format ${stableFormat}) ` +
				`against this build (data format ${newFormat})`
		);
		console.log(`${result.pass ? 'PASS' : 'FAIL'}: ${result.summary}`);
		for (const p of result.problems ?? []) console.log(`  ${p}`);
		if (!result.pass) process.exit(1);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
