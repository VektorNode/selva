// Escalation is the one decision in the CLI where getting it wrong is both
// silent and expensive: escalate when nobody is watching and the command hangs
// on a password prompt forever; refuse when sudo was available and the operator
// copy-pastes a line the tool could have run.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalationMode, escalationHint, runPrivileged } from '../checks/privileged.js';

function fakeEnv({
	platform = 'linux',
	isTTY = true,
	euid = 1000,
	run = () => ({ status: 0 })
} = {}) {
	return {
		platform: () => platform,
		isTTY: () => isTTY,
		geteuid: () => euid,
		run
	};
}

test('root needs no sudo at all', () => {
	const mode = escalationMode(fakeEnv({ euid: 0 }));
	assert.equal(mode.mode, 'root');
});

test('passwordless sudo works without a TTY', () => {
	// The Terraform startup script and CI both run with no terminal attached.
	// Requiring a TTY unconditionally would block exactly the paths that are
	// already privileged.
	const mode = escalationMode(fakeEnv({ isTTY: false, run: () => ({ status: 0 }) }));
	assert.equal(mode.mode, 'sudo');
});

test('sudo that would prompt is refused when nothing can answer it', () => {
	const mode = escalationMode(fakeEnv({ isTTY: false, run: () => ({ status: 1 }) }));
	assert.equal(mode.mode, 'blocked');
	assert.equal(mode.reason, 'no-tty');
	assert.match(escalationHint(mode.reason), /nothing is attached/);
});

test('sudo that would prompt is fine when someone is there', () => {
	const mode = escalationMode(fakeEnv({ isTTY: true, run: () => ({ status: 1 }) }));
	assert.equal(mode.mode, 'sudo');
});

test('a host without sudo is blocked, not retried', () => {
	const mode = escalationMode(fakeEnv({ run: () => ({ error: new Error('ENOENT') }) }));
	assert.equal(mode.mode, 'blocked');
	assert.equal(mode.reason, 'no-sudo');
});

test('non-Linux is blocked before anything is probed', () => {
	for (const platform of ['darwin', 'win32']) {
		let probed = false;
		const mode = escalationMode(
			fakeEnv({
				platform,
				run: () => {
					probed = true;
					return { status: 0 };
				}
			})
		);
		assert.equal(mode.mode, 'blocked');
		assert.equal(probed, false, 'no point shelling out to sudo off Linux');
	}
});

test('a blocked run reports the command it would have used', () => {
	// This string is the whole value of a blocked result — it is what the
	// operator pastes into a root shell.
	const result = runPrivileged('systemctl', ['restart', 'caddy'], {
		env: fakeEnv({ run: () => ({ error: new Error('ENOENT') }) })
	});
	assert.equal(result.ok, false);
	assert.equal(result.blocked, true);
	assert.equal(result.command, 'sudo systemctl restart caddy');
});

test('running as root omits sudo from the command it reports', () => {
	const calls = [];
	const result = runPrivileged('systemctl', ['restart', 'caddy'], {
		env: fakeEnv({
			euid: 0,
			run: (cmd, args) => {
				calls.push([cmd, ...args].join(' '));
				return { status: 0 };
			}
		})
	});
	assert.equal(result.ok, true);
	assert.equal(result.command, 'systemctl restart caddy');
	assert.deepEqual(calls, ['systemctl restart caddy']);
});

test('a non-zero exit is a failure, not a silent success', () => {
	const result = runPrivileged('caddy', ['validate'], {
		env: fakeEnv({ euid: 0, run: () => ({ status: 1, stderr: 'bad config' }) })
	});
	assert.equal(result.ok, false);
	assert.equal(result.blocked, false);
	assert.equal(result.status, 1);
});
