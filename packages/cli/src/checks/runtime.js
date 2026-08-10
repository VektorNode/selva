// What the host provides versus what the deployment brings itself.
//
// The split trips operators up: Node and npm come from the host (distro
// packages, nvm, whatever), pm2 comes from the deployment. Installing pm2 from
// apt or `npm i -g` looks like the tidy thing to do and produces a daemon that
// silently fights the local one. These checks name which side of the line each
// tool is on, so the answer is on screen instead of in a support thread.
//
// checkNodeEngine (doctor.js) already validates the running Node against
// engines.node. Nothing here repeats that — this covers what it can't see: npm,
// the pm2 install itself, and whether the Node running doctor is the same one
// pm2 launched the app under.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { green, red, yellow } from './result.js';
import { PM2_VERSION } from '../deployment-package.js';

/** The real OS. Tests pass a stand-in with the same shape. */
export const runtimeEnv = {
	platform: () => process.platform,
	env: () => process.env,
	homedir,
	exists: existsSync,
	readFile: (path) => readFileSync(path, 'utf8'),
	realpath: (path) => {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	},
	execPath: () => process.execPath,
	// Signal 0 probes liveness without touching the process. EPERM means it
	// exists but belongs to another user — alive for our purposes.
	processAlive: (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch (err) {
			return err?.code === 'EPERM';
		}
	},
	run: (cmd, args, opts) =>
		spawnSync(cmd, args, {
			...opts,
			encoding: 'utf8',
			shell: process.platform === 'win32'
		})
};

export function checkRuntimeEnvironment(dir, env = runtimeEnv) {
	return [
		checkNpm(env),
		checkNodeProvenance(env),
		...checkPm2Install(dir, env),
		...checkPm2Daemon(dir, env)
	];
}

// ── npm ─────────────────────────────────────────────────────────────────

// Debian's `nodejs` package doesn't always pull in `npm`, and some distro
// splits ship an npm several majors behind the Node beside it. Both only
// surface at `selva update`, which is the worst moment to discover it.
const MIN_NPM_MAJOR = 10;

function checkNpm(env) {
	const probe = env.run('npm', ['--version'], {});
	const version = String(probe.stdout ?? '')
		.trim()
		.split('\n')
		.pop();

	if ((probe.status ?? 1) !== 0 || !/^\d+\.\d+\.\d+/.test(version ?? '')) {
		return red(
			'npm not found on PATH — `selva update` and `npm install` cannot run.\n     ' +
				'On Debian/Ubuntu the `nodejs` package does not always include it. Install\n     ' +
				'Node 24 from NodeSource, which bundles a matching npm:\n     ' +
				'curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs'
		);
	}

	const major = Number(/^(\d+)\./.exec(version)[1]);
	if (major < MIN_NPM_MAJOR) {
		return yellow(
			`npm ${version} is older than the Node beside it usually ships (expected >= ${MIN_NPM_MAJOR}).\n     ` +
				'A distro-split npm can resolve dependencies the runtime does not expect.\n     ' +
				'Install Node from NodeSource so npm and Node come from one source.'
		);
	}
	return green(`npm ${version} on PATH`);
}

// ── Node provenance ─────────────────────────────────────────────────────

// Which Node runs the app is decided by pm2's environment, not by the shell
// running doctor. When those differ — a distro Node on PATH for the login
// shell, an nvm Node for the daemon, or the reverse — doctor validates a
// version the app never uses, and engines.node passes while production runs
// something else entirely.
function checkNodeProvenance(env) {
	const running = env.realpath(env.execPath());
	const source = describeNodeSource(running);

	const which = env.run(env.platform() === 'win32' ? 'where' : 'which', ['node'], {});
	const onPath = String(which.stdout ?? '')
		.trim()
		.split('\n')[0]
		?.trim();

	if (!onPath) {
		return yellow(
			`Node v${process.versions.node} at ${running} (${source}) — not resolvable on PATH`
		);
	}

	if (env.realpath(onPath) === running) {
		return green(`Node v${process.versions.node} — ${source} (${running})`);
	}

	return yellow(
		`Two Node installations are in play: this shell resolves \`node\` to ${env.realpath(onPath)},\n     ` +
			`but doctor is running under ${running} (${source}). pm2 launches the app with the\n     ` +
			`Node it inherited when the daemon started, which may be neither. Confirm with:\n     ` +
			`npx pm2 describe selva-compute | grep -i "node.js version"`
	);
}

// nvm/fnm-managed Nodes disappear for a systemd unit that starts before the
// user's shell profile runs — worth naming the manager rather than the path.
function describeNodeSource(path) {
	const p = path.replace(/\\/g, '/');
	if (/\/\.nvm\//.test(p)) return 'nvm-managed';
	if (/\/\.fnm\/|\/fnm_multishells\//.test(p)) return 'fnm-managed';
	if (/\/\.volta\//.test(p)) return 'volta-managed';
	if (/^\/usr\/bin\/|^\/bin\//.test(p)) return 'distro package';
	if (/^\/usr\/local\//.test(p)) return 'manual /usr/local install';
	if (/\/snap\//.test(p)) return 'snap package';
	return 'unknown source';
}

// ── pm2 install ─────────────────────────────────────────────────────────

// The deployment pins pm2 exactly (see deployment-package.js). This verifies
// the pin actually landed — a hand-edited package.json, a partial install, or
// an operator who ran `npm i -g pm2` and deleted the local one all end here.
function checkPm2Install(dir, env) {
	const out = [];
	const pkgPath = join(dir, 'node_modules', 'pm2', 'package.json');

	if (!env.exists(pkgPath)) {
		out.push(
			red(
				`pm2 is not installed in this deployment (expected ${join(dir, 'node_modules', 'pm2')}).\n     ` +
					'Selva ships its own pinned pm2 on purpose — the `selva` commands refuse to fall\n     ' +
					'back to a global one, because two pm2 versions sharing a daemon hang restarts.\n     ' +
					'Fix: npm install'
			)
		);
		return out;
	}

	let installed = null;
	try {
		installed = JSON.parse(env.readFile(pkgPath)).version ?? null;
	} catch {
		// Unreadable package.json — reported below as an unverifiable version.
	}

	if (!installed) {
		out.push(yellow('pm2 installed but its version is unreadable — cannot verify the pin'));
	} else if (installed === PM2_VERSION) {
		out.push(green(`pm2 ${installed} installed locally (matches the pinned version)`));
	} else {
		out.push(
			yellow(
				`pm2 ${installed} is installed but this scaffold pins ${PM2_VERSION}.\n     ` +
					'The pin is exact because pm2 CLI and daemon must match. Realign it:\n     ' +
					`npm install pm2@${PM2_VERSION} && npx pm2 update`
			)
		);
	}

	// A pm2 listed in dependencies with a range instead of the exact pin means
	// package.json was hand-edited; the next `npm install` silently drifts again.
	const declared = readDeclaredPm2(dir, env);
	if (declared && declared !== PM2_VERSION) {
		out.push(
			yellow(
				`package.json declares pm2 "${declared}" rather than the exact pin ${PM2_VERSION}.\n     ` +
					'A range lets a later `npm install` adopt a version the running daemon is not.\n     ' +
					'Run `selva migrate` to restore the canonical package.json.'
			)
		);
	}

	return out;
}

function readDeclaredPm2(dir, env) {
	try {
		const pkg = JSON.parse(env.readFile(join(dir, 'package.json')));
		return pkg.dependencies?.pm2 ?? null;
	} catch {
		return null;
	}
}

// ── pm2 daemon ──────────────────────────────────────────────────────────

// Reports three distinct states rather than pass/fail: no daemon (fine,
// nothing started yet), a matching daemon, or a daemon a foreign pm2 owns.
//
// `pm2 ping` SPAWNS a daemon when none is running, and doctor must stay
// read-only — so liveness is checked via pm2.pid + signal 0 first, and pm2
// itself is only invoked once a live daemon is confirmed.
//
// The daemon-is-newer direction is red and deliberately offers no fix: `pm2
// update` would downgrade the daemon and drop its process table, leaving
// selva-compute unregistered. Same reasoning as ensurePm2InSync in commands/pm2.js.
function checkPm2Daemon(dir, env) {
	const bin = join(dir, 'node_modules', '.bin', env.platform() === 'win32' ? 'pm2.cmd' : 'pm2');
	if (!env.exists(bin)) return [];

	const pm2Home = env.env().PM2_HOME ?? join(env.homedir(), '.pm2');
	const pidPath = join(pm2Home, 'pm2.pid');
	if (!env.exists(pidPath)) {
		return [yellow('pm2 daemon is not running — it starts on `selva start`')];
	}
	let pid = NaN;
	try {
		pid = Number(String(env.readFile(pidPath)).trim());
	} catch {
		// Unreadable pid file — fall through to the stale case.
	}
	if (!Number.isInteger(pid) || pid <= 0 || !env.processAlive(pid)) {
		return [yellow('pm2 daemon is not running (stale pm2.pid) — it starts on `selva start`')];
	}

	const probe = env.run(bin, ['ping'], { cwd: dir });
	const output = String(probe.stdout ?? '') + String(probe.stderr ?? '');

	if (!/out-of-date/i.test(output)) {
		if (/pong/i.test(output)) return [green('pm2 daemon responds and matches the local pm2')];
		return [yellow('pm2 daemon did not answer `pm2 ping` — check `npx pm2 ping` by hand')];
	}

	const { daemon, local } = parseSkew(output);
	if (daemon && local && compareVersions(daemon, local) > 0) {
		return [
			red(
				`The running pm2 daemon (v${daemon}) is NEWER than this deployment's pm2 (v${local}),\n     ` +
					'so a pm2 from outside the deployment owns it. `pm2 update` would downgrade the\n     ' +
					'daemon and drop its process table, so `selva start` refuses outright.\n     ' +
					'Resolve it (the app goes down briefly):\n     ' +
					`npx pm2 kill && sudo npm uninstall -g pm2 && npm install && npm start\n     ` +
					'Then re-run: npx pm2 save && npx pm2 startup systemd -u $USER --hp $HOME'
			)
		];
	}

	return [
		yellow(
			`pm2 daemon (v${daemon ?? 'unknown'}) differs from the local pm2 (v${local ?? PM2_VERSION}).\n     ` +
				'Resync it — this briefly restarts managed processes: npx pm2 update'
		)
	];
}

function parseSkew(output) {
	// eslint-disable-next-line no-control-regex -- pm2 colourises via chalk on a TTY
	const clean = output.replace(/\[[0-9;]*m/g, '');
	return {
		daemon: /In memory PM2 version:\s*v?(\d+\.\d+\.\d+)/i.exec(clean)?.[1] ?? null,
		local: /Local PM2 version:\s*v?(\d+\.\d+\.\d+)/i.exec(clean)?.[1] ?? null
	};
}

function compareVersions(a, b) {
	const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
	for (let i = 0; i < 3; i++) {
		if (x[i] > y[i]) return 1;
		if (x[i] < y[i]) return -1;
	}
	return 0;
}

export { describeNodeSource, compareVersions, MIN_NPM_MAJOR };
