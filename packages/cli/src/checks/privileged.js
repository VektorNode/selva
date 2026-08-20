// Running a command as root from a tool the operator invoked as themselves.
//
// Every privileged repair in the CLI funnels through here so there is exactly
// one place that decides whether escalation is possible, and exactly one shape
// for "we could not, here is the line to run yourself". A fixer that shells out
// to sudo on its own would each need to re-derive that fallback, and the ones
// that got it wrong would strand an operator mid-repair with no printed command.
//
// The contract: never escalate without the caller having already confirmed, and
// never escalate when nobody is at the terminal to answer a password prompt.
// `sudo -n` (non-interactive) is the probe for the second — it exits non-zero
// rather than blocking when a password would be needed.

import { spawnSync } from 'node:child_process';

/** The real OS. Tests pass a stand-in with the same shape. */
export const systemPrivileged = {
	platform: () => process.platform,
	isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
	geteuid: () => (typeof process.geteuid === 'function' ? process.geteuid() : null),
	run: (cmd, args, opts) => spawnSync(cmd, args, { ...opts, encoding: 'utf8' })
};

/**
 * How a privileged command can be run here, if at all.
 *
 * - `root`    — already uid 0; run it directly, no sudo needed.
 * - `sudo`    — sudo exists and a TTY is attached to answer for it.
 * - `blocked` — no way to escalate. `reason` says which, for the printed hint.
 */
export function escalationMode(env = systemPrivileged) {
	if (env.platform() !== 'linux') return { mode: 'blocked', reason: 'not-linux' };
	if (env.geteuid() === 0) return { mode: 'root' };

	const probe = env.run('sudo', ['-n', 'true'], {});
	// ENOENT surfaces as a null status with an error — sudo isn't installed.
	if (probe.error) return { mode: 'blocked', reason: 'no-sudo' };

	// A passwordless sudo (NOPASSWD, or a live credential cache) works even with
	// no TTY, so it's checked before the TTY requirement rather than after.
	if ((probe.status ?? 1) === 0) return { mode: 'sudo' };

	if (!env.isTTY()) return { mode: 'blocked', reason: 'no-tty' };
	return { mode: 'sudo' };
}

/** The reason text a blocked escalation reports, for a printed fallback. */
export function escalationHint(reason) {
	switch (reason) {
		case 'not-linux':
			return 'this step is Linux-only';
		case 'no-sudo':
			return 'sudo is not available on this host';
		case 'no-tty':
			return 'sudo needs a password and nothing is attached to answer it';
		default:
			return 'privileged commands cannot be run from here';
	}
}

/**
 * Run `cmd args` with root privileges.
 *
 * Returns `{ ok, status, stdout, stderr, command }` — `command` is the exact
 * line that was run (or would have been), so a caller can print it verbatim
 * when escalation is blocked rather than reconstructing it.
 *
 * Callers MUST have confirmed with the operator first. This does not prompt.
 */
export function runPrivileged(cmd, args, { env = systemPrivileged, cwd } = {}) {
	const { mode, reason } = escalationMode(env);
	const command = mode === 'root' ? [cmd, ...args].join(' ') : ['sudo', cmd, ...args].join(' ');

	if (mode === 'blocked') {
		return { ok: false, blocked: true, reason, command, stdout: '', stderr: '' };
	}

	const r =
		mode === 'root'
			? env.run(cmd, args, { cwd, stdio: 'inherit' })
			: // stdio inherit so sudo's own password prompt reaches the terminal.
				env.run('sudo', [cmd, ...args], { cwd, stdio: 'inherit' });

	return {
		ok: (r.status ?? 1) === 0,
		blocked: false,
		status: r.status ?? 1,
		stdout: r.stdout ?? '',
		stderr: r.stderr ?? '',
		command
	};
}
