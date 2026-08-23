// Boot persistence is the check nobody validates by hand: everything looks
// healthy until the VM reboots and the app doesn't come back. All three
// failure modes (no saved process list, no systemd unit, a unit pointing at
// the wrong pm2) are silent on a running deployment.
//
// The real OS arrives through an injected `env`, so these run the Linux paths
// on any platform without a systemd unit or root.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix as path } from 'node:path';
import { checkBootPersistence, findGlobalPm2 } from '../checks/boot.js';

const DIR = '/srv/deploy';
const LOCAL_PM2 = path.join(DIR, 'node_modules', 'pm2', 'bin', 'pm2');
const UNIT = '/etc/systemd/system/pm2-selva.service';
const DUMP = '/home/selva/.pm2/dump.pm2';

/**
 * A healthy Linux deployment. Each test overrides just the facet it is about,
 * so a failure names one cause rather than a whole fixture.
 */
function fakeEnv({
	files = [DUMP, UNIT],
	unit = `ExecStart=${LOCAL_PM2} resurrect`,
	PATH = '',
	writable = true,
	run = () => ({ status: 0 }),
	runPrivileged = () => ({ ok: true, blocked: false, status: 0, command: 'sudo …' })
} = {}) {
	const present = new Set(files);
	return {
		platform: () => 'linux',
		env: () => ({ USER: 'selva', PATH }),
		homedir: () => '/home/selva',
		exists: (p) => present.has(p),
		readFile: () => {
			if (unit === null) throw new Error('EACCES');
			return unit;
		},
		isWritable: () => writable,
		run,
		runPrivileged
	};
}

const lines = (checks) => checks.map((c) => c.line).join('\n');
const severities = (checks) => checks.map((c) => c.severity);

// ── Platform gating ─────────────────────────────────────────────────────

test('non-Linux platforms report nothing rather than something misleading', () => {
	// pm2 boot persistence is systemd-specific; macOS uses launchd and Windows
	// has no equivalent. A warning there would be noise an operator can't act on.
	for (const platform of ['darwin', 'win32']) {
		const env = { ...fakeEnv({ files: [] }), platform: () => platform };
		assert.deepEqual(checkBootPersistence(DIR, env), []);
	}
});

// ── The healthy case ────────────────────────────────────────────────────

test('a correctly configured host passes every boot check', () => {
	const checks = checkBootPersistence(DIR, fakeEnv());
	assert.deepEqual(severities(checks), ['green', 'green']);
	assert.match(lines(checks), /dump\.pm2 present/);
	assert.match(lines(checks), /uses deployment-local pm2/);
});

// ── dump.pm2 ────────────────────────────────────────────────────────────

test('a missing dump.pm2 warns — a reboot would resurrect nothing', () => {
	const checks = checkBootPersistence(DIR, fakeEnv({ files: [UNIT] }));
	assert.equal(checks[0].severity, 'yellow');
	assert.match(checks[0].line, /process list not saved/);
	assert.ok(checks[0].fix, 'running `pm2 save` is safe to offer');
});

test('PM2_HOME overrides where the dump is looked for', () => {
	// An operator who relocated PM2_HOME would otherwise be told to run
	// `pm2 save` forever, because doctor was looking in the wrong place.
	const env = {
		...fakeEnv({ files: ['/custom/pm2/dump.pm2', UNIT] }),
		env: () => ({ USER: 'selva', PATH: '', PM2_HOME: '/custom/pm2' })
	};
	assert.equal(checkBootPersistence(DIR, env)[0].severity, 'green');
});

test('the pm2 save repair reports a non-zero exit as a failure', () => {
	const env = fakeEnv({
		files: [UNIT, path.join(DIR, 'node_modules', '.bin', 'pm2')],
		run: () => ({ status: 1, stderr: 'daemon not running' })
	});
	const result = checkBootPersistence(DIR, env)[0].fix.run();
	assert.equal(result.severity, 'red');
	assert.match(result.line, /daemon not running/);
});

test('the pm2 save repair refuses when the deployment has no pm2', () => {
	const result = checkBootPersistence(DIR, fakeEnv({ files: [UNIT] }))[0].fix.run();
	assert.equal(result.severity, 'red');
	assert.match(result.line, /pm2 not installed/);
});

// ── systemd unit ────────────────────────────────────────────────────────

test('a missing systemd unit warns that the app will not survive a reboot', () => {
	const checks = checkBootPersistence(DIR, fakeEnv({ files: [DUMP] }));
	assert.equal(checks[1].severity, 'yellow');
	assert.match(checks[1].line, /will NOT restart after a reboot/);
	// The advice stays in the line: --fix is opt-in, and an operator reading a
	// plain `doctor` run still needs the command.
	assert.match(checks[1].line, /pm2 startup systemd/);
});

test('installing the boot unit runs pm2 startup through sudo, then saves', () => {
	// The two halves are one repair: a unit with no saved process list
	// resurrects nothing, which looks identical to no unit at all after a reboot.
	const privileged = [];
	const plain = [];
	const checks = checkBootPersistence(
		DIR,
		fakeEnv({
			files: [DUMP, LOCAL_PM2],
			runPrivileged: (cmd, args) => {
				privileged.push([cmd, ...args].join(' '));
				return { ok: true, blocked: false, status: 0, command: 'sudo …' };
			},
			run: (cmd, args) => {
				plain.push([cmd, ...args].join(' '));
				return { status: 0 };
			}
		})
	);
	const result = checks[1].fix.run();

	assert.equal(result.severity, 'green');
	assert.equal(privileged.length, 1);
	assert.match(privileged[0], /pm2 startup systemd -u selva --hp \/home\/selva/);
	// PATH carries the deployment's .bin so the unit systemd writes resolves to
	// the local pm2 — without it root's own pm2 wins and we recreate the skew.
	assert.match(privileged[0], /node_modules\/\.bin/);
	assert.ok(
		plain.some((c) => /pm2 save/.test(c)),
		`expected a pm2 save, got: ${JSON.stringify(plain)}`
	);
});

test('a blocked escalation prints the command instead of half-applying it', () => {
	// No sudo, or no TTY to answer for it. The operator has to run it elsewhere,
	// so the exact line matters more than the failure.
	const checks = checkBootPersistence(
		DIR,
		fakeEnv({
			files: [DUMP, LOCAL_PM2],
			runPrivileged: () => ({
				ok: false,
				blocked: true,
				reason: 'no-sudo',
				command: 'sudo env PATH=… pm2 startup systemd -u selva --hp /home/selva'
			})
		})
	);
	const result = checks[1].fix.run();

	assert.equal(result.severity, 'yellow');
	assert.match(result.line, /sudo is not available/);
	assert.match(result.line, /pm2 startup systemd/, 'the command is printed to run by hand');
});

test('a boot-unit repair without pm2 installed fails before escalating', () => {
	// Asking for a sudo password and only then discovering there is no binary to
	// point the unit at is the worst order to do this in.
	let escalated = false;
	const checks = checkBootPersistence(
		DIR,
		fakeEnv({
			files: [DUMP],
			runPrivileged: () => {
				escalated = true;
				return { ok: true, blocked: false, status: 0, command: '' };
			}
		})
	);
	const result = checks[1].fix.run();

	assert.equal(result.severity, 'red');
	assert.match(result.line, /pm2 not installed/);
	assert.equal(escalated, false, 'must not prompt for sudo before checking');
});

test('a wrong-pm2 unit can be repointed rather than only reported', () => {
	const checks = checkBootPersistence(
		DIR,
		fakeEnv({
			files: [DUMP, UNIT, LOCAL_PM2],
			unit: 'ExecStart=/usr/lib/node_modules/pm2/bin/pm2 resurrect'
		})
	);
	assert.equal(checks[1].severity, 'red');
	assert.ok(checks[1].fix, 'the skew is repairable — it is the same startup command');
	assert.equal(checks[1].fix.run().severity, 'green');
});

test('a unit pointing at a different pm2 is a failure, not a warning', () => {
	// This is the silent one: the unit exists, so a cursory look says "set up".
	// It resurrects through a foreign pm2 and hits the version skew that
	// leaves selva-compute unregistered.
	const checks = checkBootPersistence(
		DIR,
		fakeEnv({ unit: 'ExecStart=/usr/lib/node_modules/pm2/bin/pm2 resurrect' })
	);
	assert.equal(checks[1].severity, 'red');
	assert.match(checks[1].line, /points at a different pm2/);
	assert.match(checks[1].line, /\/usr\/lib\/node_modules\/pm2\/bin\/pm2/, 'shows what it found');
	assert.match(
		checks[1].line,
		new RegExp(LOCAL_PM2.replace(/\//g, '\\/')),
		'shows what it expected'
	);
});

test('a unit with no ExecStart is reported rather than silently accepted', () => {
	const checks = checkBootPersistence(DIR, fakeEnv({ unit: '[Unit]\nDescription=pm2\n' }));
	assert.equal(checks[1].severity, 'red');
	assert.match(checks[1].line, /\(not found\)/);
});

test('an unreadable unit warns instead of crashing the whole run', () => {
	const checks = checkBootPersistence(DIR, fakeEnv({ unit: null }));
	assert.equal(checks[1].severity, 'yellow');
	assert.match(checks[1].line, /unreadable/);
});

test('with no USER the unit path cannot be derived, so it reports not-installed', () => {
	const env = { ...fakeEnv(), env: () => ({ PATH: '' }) };
	const checks = checkBootPersistence(DIR, env);
	assert.equal(checks[1].severity, 'yellow');
	assert.match(checks[1].line, /not installed/);
});

// ── Stray global pm2 ────────────────────────────────────────────────────

test('a global pm2 on PATH is reported as a skew risk', () => {
	const env = fakeEnv({ PATH: '/usr/local/bin', files: [DUMP, UNIT, '/usr/local/bin/pm2'] });
	const checks = checkBootPersistence(DIR, env);
	assert.equal(checks.length, 3);
	assert.equal(checks[2].severity, 'yellow');
	assert.match(checks[2].line, /outside this deployment is on PATH/);
});

test('removal is only offered where it would actually succeed', () => {
	const files = [DUMP, UNIT, '/usr/local/bin/pm2'];
	const writable = checkBootPersistence(DIR, fakeEnv({ PATH: '/usr/local/bin', files }));
	assert.ok(writable[2].fix, 'a writable dir can be repaired');

	// Root-owned: attempting it would half-fail and leave the operator worse
	// informed than a printed instruction.
	const rootOwned = checkBootPersistence(
		DIR,
		fakeEnv({ PATH: '/usr/local/bin', files, writable: false })
	);
	assert.equal(rootOwned[2].fix, undefined);
	assert.match(rootOwned[2].line, /needs sudo/);
});

test("the deployment's own pm2 is not mistaken for a global one", () => {
	// node_modules/.bin is on PATH inside an npm script — flagging it would
	// fire on every healthy deployment.
	const localBin = path.join(DIR, 'node_modules', '.bin');
	const env = fakeEnv({ PATH: localBin, files: [DUMP, UNIT, path.join(localBin, 'pm2')] });
	assert.equal(checkBootPersistence(DIR, env).length, 2, 'no stray-pm2 warning');
});

test('findGlobalPm2 scans every PATH entry and returns the first hit', () => {
	const env = {
		...fakeEnv(),
		env: () => ({ PATH: ['/empty', '/usr/local/bin', '/opt/bin'].join(':') }),
		exists: (p) => p === '/usr/local/bin/pm2' || p === '/opt/bin/pm2'
	};
	assert.equal(findGlobalPm2(DIR, env), '/usr/local/bin/pm2');
});

test('findGlobalPm2 returns null when PATH is empty or has no pm2', () => {
	assert.equal(findGlobalPm2(DIR, { ...fakeEnv(), env: () => ({ PATH: '' }) }), null);
	assert.equal(findGlobalPm2(DIR, { ...fakeEnv({ PATH: '/usr/bin' }) }), null);
});
