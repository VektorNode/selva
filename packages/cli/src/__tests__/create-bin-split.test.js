// The package ships two bins: `cli` (scaffold) and `selva` (operate). Because
// `npx @selvajs/cli doctor --fix` resolves to the scaffolder, the flag was
// rejected as unknown and the operator had no way to tell that the command had
// simply gone to the wrong bin.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCreate } from '../commands/create.js';

// Every command on the `selva` dispatcher. A command added there without being
// added here silently regains the old behaviour: treated as a directory name.
const OPERATE = ['doctor', 'start', 'stop', 'restart', 'logs', 'update', 'migrate', 'keys', 'init'];

for (const command of OPERATE) {
	test(`\`${command}\` through the scaffolder points at the selva bin`, async () => {
		await assert.rejects(() => runCreate([command]), {
			message: new RegExp(`npx selva ${command}`)
		});
	});
}

test('the redirect carries the whole argv, not just the command', async () => {
	await assert.rejects(() => runCreate(['doctor', '--fix']), {
		message: /npx selva doctor --fix/
	});
});

test('a command name is only special in first position', async () => {
	// Scaffolding into ./deploy, with a stray second argument — the redirect
	// must not fire just because "logs" appears somewhere in argv.
	await assert.rejects(() => runCreate(['deploy', 'logs']), {
		message: /Unexpected argument: logs/
	});
});
