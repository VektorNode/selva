// Will a reboot bring the app back?
//
// Three things have to line up: pm2 has a saved process list to resurrect, a
// systemd unit exists to do the resurrecting, and that unit points at THIS
// deployment's pm2 rather than a global one. Each fails silently — the
// deployment runs fine until the VM restarts, which is exactly when nobody is
// watching.
//
// Every OS interaction arrives through `env` so the whole matrix (unit missing,
// unit pointing elsewhere, unit unreadable, stray global pm2) is reachable in a
// test without a Linux box, a systemd unit, or root.

import { existsSync, readFileSync, accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { green, red, yellow, fixable } from './result.js';

/** The real OS. Tests pass a stand-in with the same shape. */
export const systemEnv = {
	platform: () => process.platform,
	env: () => process.env,
	homedir,
	exists: existsSync,
	readFile: (path) => readFileSync(path, 'utf8'),
	isWritable: (path) => {
		try {
			accessSync(path, constants.W_OK);
			return true;
		} catch {
			return false;
		}
	},
	run: (cmd, args, opts) => spawnSync(cmd, args, { ...opts, encoding: 'utf8' })
};

export function checkBootPersistence(dir, env = systemEnv) {
	// pm2's boot integration is Linux/systemd-specific. On macOS it's launchd
	// (different unit path) and on Windows pm2 boot persistence isn't a thing —
	// stay silent rather than emit misleading checks.
	if (env.platform() !== 'linux') return [];

	return [
		checkSavedProcessList(dir, env),
		...checkSystemdUnit(dir, env),
		...checkStrayGlobalPm2(dir, env)
	];
}

// dump.pm2 is what `pm2 resurrect` replays. Without it the unit starts pm2 and
// pm2 starts nothing.
function checkSavedProcessList(dir, env) {
	const pm2Home = env.env().PM2_HOME ?? join(env.homedir(), '.pm2');
	if (env.exists(join(pm2Home, 'dump.pm2'))) {
		return green('pm2 process list saved (dump.pm2 present)');
	}
	return yellow(
		'pm2 process list not saved — run `npx pm2 save` so a reboot can ' +
			'resurrect the app (nothing to restore without it)',
		fixable('run `pm2 save` to persist the current process list', () => {
			const bin = join(dir, 'node_modules', '.bin', 'pm2');
			if (!env.exists(bin)) return red('pm2 not installed in this deployment');
			const r = env.run(bin, ['save'], { cwd: dir });
			return (r.status ?? 1) === 0
				? green('pm2 process list saved')
				: red(`pm2 save failed: ${(r.stderr || r.stdout || '').trim()}`);
		})
	);
}

function checkSystemdUnit(dir, env) {
	const user = env.env().USER ?? env.env().LOGNAME;
	const unitPath = user ? `/etc/systemd/system/pm2-${user}.service` : null;

	if (!unitPath || !env.exists(unitPath)) {
		return [
			yellow(
				'pm2 systemd boot unit not installed — the app will NOT restart after a ' +
					'reboot. Run `npx pm2 startup systemd -u $USER --hp $HOME` and paste the ' +
					'printed command (point it at this deployment’s pm2).'
			)
		];
	}

	let unit;
	try {
		unit = env.readFile(unitPath);
	} catch {
		return [yellow(`pm2 systemd unit present but unreadable (${unitPath})`)];
	}

	const localPm2 = join(dir, 'node_modules', 'pm2', 'bin', 'pm2');
	const execStart = /^ExecStart=(.+)$/m.exec(unit)?.[1] ?? '';
	if (execStart.includes(localPm2)) {
		return [green('pm2 systemd boot unit installed (uses deployment-local pm2)')];
	}

	return [
		red(
			`pm2 systemd boot unit points at a different pm2 than this deployment's.\n     ` +
				`ExecStart: ${execStart || '(not found)'}\n     ` +
				`expected:  ${localPm2} resurrect\n     ` +
				`Reboots will resurrect via the wrong pm2 (version skew). Re-run startup ` +
				`with the local binary:\n     ` +
				`sudo env PATH=$PATH:${join(dir, 'node_modules', '.bin')} ${localPm2} ` +
				`startup systemd -u $USER --hp $HOME`
		)
	];
}

// A pm2 outside the deployment is the root cause of daemon version skew.
function checkStrayGlobalPm2(dir, env) {
	const globalPm2 = findGlobalPm2(dir, env);
	if (!globalPm2) return [];

	// Only offer the removal when we could actually perform it. A global
	// install under /usr is root-owned; attempting it would half-fail and
	// leave the operator worse informed than a printed instruction.
	const writable = env.isWritable(dirname(globalPm2));

	return [
		yellow(
			`a pm2 outside this deployment is on PATH (${globalPm2}) — it can fork a ` +
				`mismatched daemon and trigger skew. Prefer \`npm run\` wrappers / \`npx pm2\` ` +
				`from this directory; consider \`npm uninstall -g pm2\`.` +
				(writable ? '' : `\n     (${dirname(globalPm2)} is not writable — needs sudo)`),
			writable
				? fixable(`uninstall the global pm2 at ${globalPm2}`, () => {
						const r = env.run('npm', ['uninstall', '-g', 'pm2'], {});
						return (r.status ?? 1) === 0
							? green('global pm2 uninstalled')
							: red(`npm uninstall -g pm2 failed: ${(r.stderr || r.stdout || '').trim()}`);
					})
				: undefined
		)
	];
}

// Scan PATH for a stray pm2 binary (read-only).
export function findGlobalPm2(dir, env = systemEnv) {
	const localBin = resolve(dir, 'node_modules', '.bin');
	const dirs = (env.env().PATH ?? '').split(delimiter).filter(Boolean);
	for (const d of dirs) {
		if (resolve(d) === localBin) continue;
		const candidate = join(d, 'pm2');
		if (env.exists(candidate)) return candidate;
	}
	return null;
}
