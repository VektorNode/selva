// `selva doctor --help` used to run the whole doctor: only `doctor` reads argv
// at all, and it looks for `--fix`, so `--help` was indistinguishable from no
// flag. A help request that silently performs the command is worse than one
// that errors — nothing tells the operator it was ignored.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSelva } from '../cli.js';

// Captures stdout without running any command body. Every assertion below
// depends on runSelva returning BEFORE it imports a command module — importing
// one is what would touch the deployment directory.
async function capture(fn) {
	const written = [];
	const original = console.log;
	console.log = (...args) => written.push(args.join(' '));
	try {
		await fn();
		return written.join('\n');
	} finally {
		console.log = original;
	}
}

const COMMANDS = [
	'init',
	'doctor',
	'start',
	'stop',
	'restart',
	'logs',
	'update',
	'migrate',
	'keys'
];

for (const command of COMMANDS) {
	test(`\`${command} --help\` prints usage instead of running`, async () => {
		const out = await capture(() => runSelva([command, '--help']));
		assert.match(out, new RegExp(`selva ${command}`));
	});

	test(`\`${command} -h\` is the same as --help`, async () => {
		const out = await capture(() => runSelva([command, '-h']));
		assert.match(out, new RegExp(`selva ${command}`));
	});
}

test('doctor help documents the --fix flag it actually reads', async () => {
	const out = await capture(() => runSelva(['doctor', '--help']));
	assert.match(out, /--fix/);
});

test('`keys rotate --help` is caught before the subcommand usage error', async () => {
	// --help sits at argv[1] here, not argv[0] — the position keysDispatch reads.
	const out = await capture(() => runSelva(['keys', 'rotate', '--help']));
	assert.match(out, /hmac\|at-rest/);
});

test('top-level help distinguishes the scaffold bin from the operate bin', async () => {
	const out = await capture(() => runSelva([]));
	assert.match(out, /npx @selvajs\/cli <dir>/);
	assert.match(out, /npx selva <command>/);
});

test('every dispatchable command has a usage entry', async () => {
	// A command added to COMMANDS without a USAGE entry would throw on --help.
	for (const command of COMMANDS) {
		await assert.doesNotReject(() => capture(() => runSelva([command, '--help'])));
	}
});
