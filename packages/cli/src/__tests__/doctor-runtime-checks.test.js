// Host-provided (Node, npm) versus deployment-provided (pm2) tooling.
//
// Every failure here is silent on a running deployment: a distro npm resolves
// dependencies nobody inspects, a second Node means doctor validates a version
// the app never runs, and a foreign pm2 daemon only refuses at the next
// restart. The real OS arrives through an injected `env`, so the Linux paths
// run on any platform without pm2, systemd, or root.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkRuntimeEnvironment, describeNodeSource, compareVersions } from '../checks/runtime.js';
import { PM2_VERSION } from '../deployment-package.js';

const DIR = '/srv/deploy';
const PM2_PKG = join(DIR, 'node_modules', 'pm2', 'package.json');
const PM2_BIN = join(DIR, 'node_modules', '.bin', 'pm2');
const PM2_PID = join('/home/selva', '.pm2', 'pm2.pid');
const LOGROTATE = join('/home/selva', '.pm2', 'node_modules', 'pm2-logrotate');
const DEPLOY_PKG = join(DIR, 'package.json');
const NODE = '/usr/bin/node';

/**
 * A healthy Linux deployment. Each test overrides just the facet it is about,
 * so a failure names one cause rather than a whole fixture.
 */
function fakeEnv({
	npm = { status: 0, stdout: '10.9.2\n' },
	nodePath = NODE,
	whichNode = NODE,
	files = [PM2_PKG, PM2_BIN, PM2_PID, DEPLOY_PKG, LOGROTATE],
	pm2Version = PM2_VERSION,
	declaredPm2 = PM2_VERSION,
	daemonAlive = true,
	ping = { status: 0, stdout: 'pong\n' }
} = {}) {
	const present = new Set(files);
	return {
		platform: () => 'linux',
		env: () => ({ PATH: '/usr/bin' }),
		homedir: () => '/home/selva',
		exists: (p) => present.has(p),
		readFile: (p) => {
			if (p === PM2_PKG) {
				if (pm2Version === null) throw new Error('EACCES');
				return JSON.stringify({ version: pm2Version });
			}
			if (p === DEPLOY_PKG) {
				return JSON.stringify({ dependencies: { pm2: declaredPm2 } });
			}
			if (p === PM2_PID) return '4242\n';
			throw new Error('ENOENT');
		},
		realpath: (p) => p,
		execPath: () => nodePath,
		processAlive: () => daemonAlive,
		run: (cmd, args) => {
			if (cmd === 'npm') return npm;
			if (cmd === 'which') return { status: 0, stdout: whichNode ? whichNode + '\n' : '' };
			if (args?.[0] === 'ping') return ping;
			return { status: 0, stdout: '' };
		}
	};
}

const lines = (checks) => checks.map((c) => c.line).join('\n');
const severities = (checks) => checks.map((c) => c.severity);
const find = (checks, re) => checks.find((c) => re.test(c.line));

// ── The healthy case ────────────────────────────────────────────────────

test('a correctly provisioned host passes every runtime check', () => {
	const checks = checkRuntimeEnvironment(DIR, fakeEnv());
	assert.deepEqual(severities(checks), ['green', 'green', 'green', 'green', 'green']);
	assert.match(lines(checks), /npm 10\.9\.2 on PATH/);
	assert.match(lines(checks), /matches the pinned version/);
	assert.match(lines(checks), /daemon responds and matches/);
	assert.match(lines(checks), /pm2-logrotate installed/);
});

// ── npm ─────────────────────────────────────────────────────────────────

test('a missing npm is a failure that names the Debian cause', () => {
	// Debian's `nodejs` package does not always pull in npm, which is exactly
	// the case an operator installing distro packages lands in.
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ npm: { status: 127, stdout: '' } }));
	assert.equal(checks[0].severity, 'red');
	assert.match(checks[0].line, /npm not found on PATH/);
	assert.match(checks[0].line, /deb\.nodesource\.com\/setup_24\.x/);
});

test('npm that exits zero with unparseable output is still treated as missing', () => {
	const checks = checkRuntimeEnvironment(
		DIR,
		fakeEnv({ npm: { status: 0, stdout: 'not-a-version' } })
	);
	assert.equal(checks[0].severity, 'red');
});

test('a distro-split npm several majors behind warns rather than fails', () => {
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ npm: { status: 0, stdout: '7.5.2\n' } }));
	assert.equal(checks[0].severity, 'yellow');
	assert.match(checks[0].line, /older than the Node beside it/);
});

// ── Node provenance ─────────────────────────────────────────────────────

test('two Node installations warn, because doctor would validate the wrong one', () => {
	// The shell's node and doctor's node differ — pm2 may be running a third.
	// engines.node passes against a version production never executes.
	const checks = checkRuntimeEnvironment(
		DIR,
		fakeEnv({ nodePath: '/home/selva/.nvm/versions/node/v24.3.0/bin/node', whichNode: NODE })
	);
	const node = find(checks, /Two Node installations/);
	assert.equal(node.severity, 'yellow');
	assert.match(node.line, /pm2 describe selva-compute/);
});

test('a Node unresolvable on PATH is reported without claiming a conflict', () => {
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ whichNode: '' }));
	const node = find(checks, /not resolvable on PATH/);
	assert.equal(node.severity, 'yellow');
});

test('describeNodeSource names the version manager, not just the path', () => {
	// A nvm/fnm Node vanishes for a systemd unit that starts before the user's
	// shell profile — naming the manager points at the actual fix.
	assert.equal(describeNodeSource('/home/x/.nvm/versions/node/v24.0.0/bin/node'), 'nvm-managed');
	assert.equal(describeNodeSource('/home/x/.fnm/node-versions/v24/bin/node'), 'fnm-managed');
	assert.equal(describeNodeSource('/home/x/.volta/tools/image/node/24/bin/node'), 'volta-managed');
	assert.equal(describeNodeSource('/usr/bin/node'), 'distro package');
	assert.equal(describeNodeSource('/usr/local/bin/node'), 'manual /usr/local install');
	assert.equal(describeNodeSource('/snap/node/current/bin/node'), 'snap package');
	assert.equal(describeNodeSource('/opt/weird/node'), 'unknown source');
});

// ── pm2 install ─────────────────────────────────────────────────────────

test('a deployment with no local pm2 fails and explains why a global one is refused', () => {
	// This is the operator question the check exists to answer: pm2 is the one
	// thing Selva deliberately brings itself.
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ files: [DEPLOY_PKG] }));
	const pm2 = find(checks, /not installed in this deployment/);
	assert.equal(pm2.severity, 'red');
	assert.match(pm2.line, /ships its own pinned pm2 on purpose/);
	assert.match(pm2.line, /npm install/);
});

test('a pm2 version other than the pin warns with the realignment command', () => {
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ pm2Version: '6.0.14' }));
	const pm2 = find(checks, /is installed but this scaffold pins/);
	assert.equal(pm2.severity, 'yellow');
	assert.match(pm2.line, new RegExp(`npm install pm2@${PM2_VERSION.replace(/\./g, '\\.')}`));
});

test('an unreadable pm2 package.json warns instead of crashing the run', () => {
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ pm2Version: null }));
	assert.ok(find(checks, /version is unreadable/));
});

test('a caret range in package.json is flagged even when the installed pm2 matches', () => {
	// The install is correct today and drifts on the next `npm install` — the
	// failure is in the declaration, not the current node_modules.
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ declaredPm2: '^5.4.3' }));
	assert.ok(find(checks, /matches the pinned version/), 'install itself still passes');
	const declared = find(checks, /declares pm2 "\^5\.4\.3"/);
	assert.equal(declared.severity, 'yellow');
	assert.match(declared.line, /selva migrate/);
});

// ── pm2 daemon ──────────────────────────────────────────────────────────

test('no running daemon is normal, not a problem — and pm2 is never invoked', () => {
	// `pm2 ping` SPAWNS a daemon when none is running. Doctor is read-only, so
	// with no pid file the check must conclude without touching the binary.
	const env = fakeEnv({ files: [PM2_PKG, PM2_BIN, DEPLOY_PKG] });
	const invoked = [];
	env.run = (cmd, args) => {
		invoked.push([cmd, ...(args ?? [])].join(' '));
		if (cmd === 'npm') return { status: 0, stdout: '10.9.2\n' };
		if (cmd === 'which') return { status: 0, stdout: NODE + '\n' };
		return { status: 0, stdout: 'pong\n' };
	};
	const checks = checkRuntimeEnvironment(DIR, env);
	const daemon = find(checks, /daemon is not running/);
	assert.equal(daemon.severity, 'yellow');
	assert.ok(
		!invoked.some((c) => c.includes('ping')),
		`pm2 must not be invoked without a live daemon, got: ${JSON.stringify(invoked)}`
	);
});

test('a stale pm2.pid (dead process) reads as not-running, still without a ping', () => {
	// Common after a crash or unclean reboot — the pid file survives, the
	// daemon didn't. Pinging here would spawn one as a side effect.
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ daemonAlive: false }));
	const daemon = find(checks, /stale pm2\.pid/);
	assert.equal(daemon.severity, 'yellow');
});

test('a live daemon that fails to pong is reported, not assumed healthy', () => {
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ ping: { status: 1, stderr: 'boom' } }));
	const daemon = find(checks, /did not answer/);
	assert.equal(daemon.severity, 'yellow');
});

test('a newer daemon is red and never suggests `pm2 update`', () => {
	// pm2 update would downgrade the daemon and drop its process table,
	// leaving selva-compute unregistered — the one direction that cannot be
	// repaired forward.
	const ping = {
		status: 0,
		stderr: 'pm2 is out-of-date\nIn memory PM2 version: 6.0.14\nLocal PM2 version: 5.4.3\n'
	};
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ ping }));
	const daemon = find(checks, /is NEWER than/);
	assert.equal(daemon.severity, 'red');
	assert.doesNotMatch(daemon.line, /npx pm2 update/, 'must not offer the destructive direction');
	assert.match(daemon.line, /npx pm2 kill/);
	assert.match(daemon.line, /npm uninstall -g pm2/);
});

test('an older daemon warns and offers the resync', () => {
	const ping = {
		status: 0,
		stderr: 'out-of-date\nIn memory PM2 version: 5.3.0\nLocal PM2 version: 5.4.3\n'
	};
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ ping }));
	const daemon = find(checks, /differs from the local pm2/);
	assert.equal(daemon.severity, 'yellow');
	assert.match(daemon.line, /npx pm2 update/);
});

test('skew detection survives pm2 colourising its output', () => {
	const ping = {
		status: 0,
		stderr: '[31mout-of-date[0m\nIn memory PM2 version: 6.0.14\nLocal PM2 version: 5.4.3\n'
	};
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ ping }));
	assert.ok(find(checks, /is NEWER than/), 'ANSI codes must not defeat the version parse');
});

test('unparseable skew output falls back to the resync warning, not a false red', () => {
	const ping = { status: 0, stderr: 'pm2 is out-of-date, please update\n' };
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ ping }));
	const daemon = find(checks, /differs from the local pm2/);
	assert.equal(daemon.severity, 'yellow');
});

test('the daemon check is skipped when the deployment has no pm2 binary', () => {
	// Nothing to ping, and the missing-install check already said so — a second
	// failure about the daemon would just be noise.
	const checks = checkRuntimeEnvironment(DIR, fakeEnv({ files: [DEPLOY_PKG] }));
	assert.equal(find(checks, /pm2 daemon/), undefined);
});

// ── pm2 log rotation ────────────────────────────────────────────────────

test('a missing pm2-logrotate warns and names the disk consequence', () => {
	const checks = checkRuntimeEnvironment(
		DIR,
		fakeEnv({ files: [PM2_PKG, PM2_BIN, PM2_PID, DEPLOY_PKG] })
	);
	const rotate = find(checks, /logrotate/);
	assert.equal(rotate.severity, 'yellow');
	assert.match(rotate.line, /grow without bound/);
	assert.ok(rotate.fix, 'a repair should be offered');
});

test('detecting log rotation never invokes pm2', () => {
	// An invocation with no live daemon spawns one as a side effect, which is
	// exactly what doctor must not do — same rule as the daemon check.
	const invoked = [];
	const env = fakeEnv({ files: [PM2_PKG, PM2_BIN, DEPLOY_PKG], daemonAlive: false });
	const spy = {
		...env,
		run: (cmd, args, opts) => (invoked.push([cmd, args]), env.run(cmd, args, opts))
	};
	checkRuntimeEnvironment(DIR, spy);
	assert.ok(
		!invoked.some(([cmd, args]) => cmd.includes('pm2') && args?.[0] !== 'ping'),
		`pm2 must not be invoked to detect logrotate, got: ${JSON.stringify(invoked)}`
	);
});

test('the repair installs the module and applies the weekly settings', () => {
	const calls = [];
	const env = fakeEnv({ files: [PM2_PKG, PM2_BIN, PM2_PID, DEPLOY_PKG] });
	const spy = {
		...env,
		run: (cmd, args, opts) => {
			if (args?.[0] === 'install' || args?.[0] === 'set') {
				calls.push(args);
				return { status: 0, stdout: '' };
			}
			return env.run(cmd, args, opts);
		}
	};
	const result = find(checkRuntimeEnvironment(DIR, spy), /logrotate/).fix.run();

	assert.equal(result.severity, 'green');
	assert.deepEqual(calls[0], ['install', 'pm2-logrotate']);
	const settings = Object.fromEntries(calls.slice(1).map(([, k, v]) => [k, v]));
	assert.equal(settings['pm2-logrotate:rotateInterval'], '0 0 * * 0');
	assert.equal(settings['pm2-logrotate:retain'], '8');
	assert.equal(settings['pm2-logrotate:compress'], 'true');
});

test('a failed install reports rather than claiming success', () => {
	const env = fakeEnv({ files: [PM2_PKG, PM2_BIN, PM2_PID, DEPLOY_PKG] });
	const spy = {
		...env,
		run: (cmd, args, opts) =>
			args?.[0] === 'install'
				? { status: 1, stderr: 'network unreachable' }
				: env.run(cmd, args, opts)
	};
	const result = find(checkRuntimeEnvironment(DIR, spy), /logrotate/).fix.run();
	assert.equal(result.severity, 'red');
	assert.match(result.line, /network unreachable/);
});

test('a failed setting leaves rotation on at pm2 defaults rather than failing', () => {
	// Rotation at the wrong interval still beats unbounded growth.
	const env = fakeEnv({ files: [PM2_PKG, PM2_BIN, PM2_PID, DEPLOY_PKG] });
	const spy = {
		...env,
		run: (cmd, args, opts) => {
			if (args?.[0] === 'install') return { status: 0, stdout: '' };
			if (args?.[0] === 'set') return { status: 1, stderr: 'nope' };
			return env.run(cmd, args, opts);
		}
	};
	const result = find(checkRuntimeEnvironment(DIR, spy), /logrotate/).fix.run();
	assert.equal(result.severity, 'yellow');
	assert.match(result.line, /installed, but could not set/);
});

// ── Version comparison ──────────────────────────────────────────────────

test('compareVersions orders each component numerically', () => {
	assert.equal(compareVersions('6.0.14', '5.4.3'), 1);
	assert.equal(compareVersions('5.4.3', '6.0.14'), -1);
	assert.equal(compareVersions('5.4.3', '5.4.3'), 0);
	// 14 > 3 numerically but "14" < "3" as strings — the case a string compare
	// would get wrong.
	assert.equal(compareVersions('5.4.14', '5.4.3'), 1);
});
