#!/usr/bin/env node
// ============================================================================
// sync-migrations — copy this package's Supabase migrations into a consuming
// app's supabase/migrations/ directory.
//
// Files copy verbatim, never renamed: the timestamp-prefixed filename is the
// migration's identity in the consuming app's history table, so renaming at
// copy time would make every machine/CI produce a different history.
//
// Usage:
//   npx @selvajs/supabase-provider sync-migrations [--dir <path>] [--force]
//
//   --dir <path>   Target migrations dir (default: ./supabase/migrations)
//   --force        Overwrite files that exist with differing content
// ============================================================================

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

// Runs from dist/cli/ — package root is two levels up.
const packageRoot = resolve(here, '..', '..');
const sourceDir = join(packageRoot, 'supabase', 'migrations');

interface Options {
	targetDir: string;
	force: boolean;
}

function parseArgs(argv: string[]): Options {
	let targetDir = resolve(process.cwd(), 'supabase', 'migrations');
	let force = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dir') {
			const value = argv[++i];
			if (!value) fail('--dir requires a path argument');
			targetDir = resolve(process.cwd(), value);
		} else if (arg === '--force') {
			force = true;
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			fail(`unknown argument: ${arg}`);
		}
	}

	return { targetDir, force };
}

function printHelp(): void {
	console.log(
		[
			'sync-migrations — copy @selvajs/supabase-provider migrations into your app.',
			'',
			'Usage:',
			'  npx @selvajs/supabase-provider sync-migrations [--dir <path>] [--force]',
			'',
			'  --dir <path>   Target migrations dir (default: ./supabase/migrations)',
			'  --force        Overwrite files that exist with differing content',
			'',
			'After syncing, apply with: npx supabase db push'
		].join('\n')
	);
}

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

function main(): void {
	const { targetDir, force } = parseArgs(process.argv.slice(2));

	if (!existsSync(sourceDir)) {
		fail(`could not locate packaged migrations at ${sourceDir}`);
	}

	const files = readdirSync(sourceDir)
		.filter((name) => name.endsWith('.sql'))
		.sort();

	if (files.length === 0) {
		fail(`no .sql migrations found in ${sourceDir}`);
	}

	mkdirSync(targetDir, { recursive: true });

	let copied = 0;
	let skipped = 0;
	let conflicts = 0;

	for (const name of files) {
		const from = join(sourceDir, name);
		const to = join(targetDir, name);
		const contents = readFileSync(from);

		if (existsSync(to)) {
			const existing = readFileSync(to);
			if (existing.equals(contents)) {
				skipped++;
				continue;
			}
			if (!force) {
				console.warn(
					`  conflict  ${name} exists with different content (use --force to overwrite)`
				);
				conflicts++;
				continue;
			}
		}

		writeFileSync(to, contents);
		console.log(`  copied    ${name}`);
		copied++;
	}

	console.log(`\n${copied} copied, ${skipped} unchanged, ${conflicts} conflict(s) -> ${targetDir}`);

	if (conflicts > 0) {
		process.exit(1);
	}

	console.log('\nNext: review the files, then run  npx supabase db push');
}

main();
