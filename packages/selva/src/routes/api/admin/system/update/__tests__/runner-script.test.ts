/**
 * Contract tests for the generated update runner.
 *
 * The runner is bash emitted from a TS template string and executed detached on
 * a customer's server — nothing type-checks it, and the process that launches it
 * is killed mid-update, so a syntax error or a renamed log line surfaces as a
 * dark site rather than a failing build.
 *
 * Two contracts are pinned here:
 *   1. The emitted script parses (`bash -n`) and quotes its interpolations.
 *   2. Every log line and exit code the runner produces is one `deriveOutcome`
 *      classifies as intended. Fixtures are cut from the REAL generated script,
 *      not hand-written — hand-written logs are what let the runner's
 *      "Already on the '<channel>' channel version" rewrite drift away from the
 *      matcher without a test noticing.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildNpmRunnerScript,
	buildLauncher,
	npmInstallArgs,
	shellQuote
} from '$lib/server/updateRunner.server';
import { deriveOutcome, TIMED_OUT } from '$lib/update-outcome';

const ECOSYSTEM = '/srv/selva/ecosystem.config.cjs';

function runner(versionBefore: string | undefined = '4.2.0', tag = 'latest'): string {
	return buildNpmRunnerScript(
		npmInstallArgs(tag === 'beta' ? 'beta' : 'stable'),
		versionBefore,
		ECOSYSTEM,
		tag
	);
}

/**
 * `bash -n` parses without executing — catches unterminated blocks, broken
 * heredocs, and quoting damage, which is what editing a template string breaks.
 *
 * It does NOT catch an unclosed `[`: test is a command, not syntax, so
 * `if [ "$X" = "1" ; then` parses clean and only fails at runtime. `assertTestBrackets`
 * covers that class; shellcheck would subsume both but isn't a repo dependency.
 */
function assertParses(script: string) {
	const dir = mkdtempSync(join(tmpdir(), 'selva-runner-'));
	const file = join(dir, 'script.sh');
	try {
		writeFileSync(file, script);
		execFileSync('bash', ['-n', file], { stdio: 'pipe' });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Every `[` opening a test must be closed by a matching `]` on the same line.
 * `bash -n` is blind to this — an unclosed bracket is a runtime failure, and in
 * the rollback path a runtime failure means the app stays down.
 */
function assertTestBrackets(script: string) {
	script.split('\n').forEach((line, i) => {
		const code = line.replace(/#.*$/, '');
		const opens = (code.match(/(?:^|\s)\[{1,2}(?=\s)/g) ?? []).length;
		const closes = (code.match(/(?:^|\s)\]{1,2}(?=\s|;|$)/g) ?? []).length;
		if (opens !== closes) {
			throw new Error(`Unbalanced test brackets at line ${i + 1}: ${line.trim()}`);
		}
	});
}

/**
 * Pull a literal log line out of the generated script by its marker, resolving
 * the shell quoting back to what the runner actually prints. Fails loudly if
 * the marker is gone — that IS the drift signal.
 */
function emittedLine(script: string, needle: string): string {
	const line = script
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.startsWith('echo ') && l.includes(needle));
	if (!line) throw new Error(`Runner no longer emits a line containing ${JSON.stringify(needle)}`);
	return line
		.replace(/^echo\s+/, '')
		.replace(/^"|"$/g, '')
		.replace(/\\`/g, '`')
		.replace(/\\\$/g, '$');
}

describe('generated runner script', () => {
	it('parses as valid bash', () => {
		assertParses(runner());
	});

	it('closes every test bracket — bash -n cannot see this', () => {
		assertTestBrackets(runner());
		assertTestBrackets(runner(undefined));
	});

	it('parses with no prior version (the rollback-impossible path)', () => {
		assertParses(runner(undefined));
	});

	it('parses once wrapped in the launcher heredoc', () => {
		assertParses(buildLauncher(runner(), '/srv/selva/selva-update.log', ['[INFO] starting']));
	});

	it('survives a deployment path containing a single quote', () => {
		const script = buildNpmRunnerScript(
			npmInstallArgs('stable'),
			'4.2.0',
			"/srv/o'brien/ecosystem.config.cjs",
			'latest'
		);
		assertParses(script);
		expect(script).toContain(shellQuote("/srv/o'brien/ecosystem.config.cjs"));
	});

	it('installs cli and runtime together at the channel tag', () => {
		expect(npmInstallArgs('stable')).toEqual([
			'install',
			'--save',
			'--prefer-online',
			'@selvajs/cli@latest',
			'@selvajs/selva@latest'
		]);
		expect(npmInstallArgs('beta')).toContain('@selvajs/selva@beta');
	});

	it('rolls back cli and runtime together — a split pair was never released', () => {
		const script = runner();
		const rollback = script.slice(script.indexOf('Rolling back'));
		expect(rollback).toContain('"@selvajs/selva@$BEFORE"');
		expect(rollback).toContain('"@selvajs/cli@$BEFORE"');
	});

	it('always prints the [EXIT] marker the reconciler greps for', () => {
		expect(runner()).toContain('echo "[EXIT] code=$CODE"');
	});

	it('runs the Node engine pre-flight BEFORE stopping the app (issue #176)', () => {
		const script = runner();
		const warn = script.indexOf('ENGINE_MISMATCH');
		const stop = script.indexOf('Stopping selva-compute');
		expect(warn).toBeGreaterThan(-1);
		// A warning after the stop would arrive once downtime had already started.
		expect(warn).toBeLessThan(stop);
	});

	it('aborts on pm2 skew before stopping the app (issue #118)', () => {
		const script = runner();
		const skew = script.indexOf('PM2_SKEW');
		const stop = script.indexOf('Stopping selva-compute');
		expect(skew).toBeGreaterThan(-1);
		expect(skew).toBeLessThan(stop);
		// The abort must leave the app running — it exits before `pm2 stop`.
		expect(script.slice(skew, stop)).toContain('exit 8');
	});

	// A production update went dark on exactly this: `pm2 stop` returns before the
	// process dies, so npm and the restart both ran inside the kill_timeout drain
	// window, where the table entry has a name and an id but no live pid. `pm2
	// start` resolved the name, converted to a restart, found no process, and
	// pm2's table printer crashed on `undefined.pm2_env`. The EXIT trap ran the
	// same command and failed identically.
	it('waits for the drain to finish before npm rewrites build/', () => {
		const script = runner();
		const stop = script.indexOf('Stopping selva-compute');
		const npm = script.indexOf('Updating @selvajs/* packages');
		const wait = script.indexOf('wait_until_stopped', stop);
		expect(wait).toBeGreaterThan(stop);
		expect(wait).toBeLessThan(npm);
	});

	it('treats only a settled entry as safe to act on', () => {
		expect(runner()).toContain('if [ "$STATUS" != "stopping" ]; then');
	});

	it('drops a stale process entry when start fails, instead of retrying it', () => {
		const script = runner();
		const start = script.slice(script.indexOf('start_app() {'));
		expect(start).toContain('"$PM2" delete selva-compute');
	});

	// The EXIT trap is the last thing standing between a failed update and a dark
	// site. Restarting a still-draining entry is what failed in production, so the
	// trap has to settle it first and be able to drop a stale entry.
	it('recovers through the delete-and-retry path, not a bare start', () => {
		const script = runner();
		const trap = script.slice(script.indexOf('on_exit() {'), script.indexOf('trap on_exit EXIT'));
		expect(trap).toContain('wait_until_stopped');
		expect(trap).toContain('start_app');
		expect(trap).not.toContain('"$PM2" start "$ECOSYSTEM" --update-env');
	});

	// The runner is re-launched via `setsid bash` from a tempfile and inherits
	// whatever PATH the spawning process had. A cron- or shell-triggered update
	// has no node_modules/.bin on PATH, and a bare `pm2` there fails with
	// "command not found" — including inside the EXIT trap.
	it('resolves pm2 explicitly rather than trusting inherited PATH', () => {
		const script = runner();
		expect(script).toContain('PM2="$(dirname "$ECOSYSTEM")/node_modules/.bin/pm2"');
		// Only command positions count. The script also prints `pm2 ...` inside
		// recovery advice aimed at a human, and those strings are not invocations.
		const invocations = script
			.split('\n')
			.map((l) => l.replace(/#.*$/, '').trim())
			.filter((l) => /^(?:if\s+!?\s*)?pm2\s/.test(l));
		expect(invocations).toEqual([]);
	});
});

describe('runner log lines → deriveOutcome (the drift-prone seam)', () => {
	it('classifies the pre-flight no-op from the line the runner really emits', () => {
		// Cut from the generated script, so a rewrite of this line fails here.
		const line = emittedLine(runner(), 'Already on the');
		const logs = `${line.replace('$TAG', 'latest').replace('$BEFORE', '4.2.0')}\n[DONE] Nothing to do\n`;
		const outcome = deriveOutcome(0, logs);
		expect(outcome.severity).toBe('info');
		expect(outcome.title).toContain('Already up to date');
	});

	it('classifies the beta-channel no-op too — the channel name is interpolated', () => {
		const line = emittedLine(runner('4.2.0-beta.1', 'beta'), 'Already on the');
		const logs = `${line.replace('$TAG', 'beta').replace('$BEFORE', '4.2.0-beta.1')}\n[DONE] Nothing to do\n`;
		expect(deriveOutcome(0, logs).severity).toBe('info');
	});

	it('parses the version transition from the runner’s own Target line', () => {
		const line = emittedLine(runner(), 'Target');
		const logs = `${line.replace('($TAG)', '(latest)').replace('$BEFORE', '4.2.0').replace('$LATEST', '4.2.1')}\n`;
		// Pending: the pre-flight ran but npm has not reported a result yet.
		const outcome = deriveOutcome(1, logs);
		expect(outcome.from).toBe('4.2.0');
		expect(outcome.to).toBe('4.2.1');
	});

	it('prefers what npm actually installed over the pre-flight target', () => {
		const logs =
			'[INFO] Target (latest): 4.2.0 → 4.2.2\n' +
			'[INFO] Current @selvajs/selva: 4.2.0\n' +
			'[INFO] New @selvajs/selva: 4.2.1\n' +
			'[DONE] Update complete\n';
		const outcome = deriveOutcome(0, logs);
		expect(outcome.to).toBe('4.2.1');
	});
});

describe('exit-code contract', () => {
	// Every code the runner can exit with, paired with the log it exits alongside.
	const CASES: Array<{ code: number; logs: string; severity: string; why: string }> = [
		{
			code: 0,
			logs: '[INFO] New @selvajs/selva: 4.2.1\n[DONE] Update complete\n',
			severity: 'success',
			why: 'clean update'
		},
		{
			code: 1,
			logs: '[FATAL] npm update failed — EXIT trap will restart the previous build\n',
			severity: 'critical',
			why: 'npm failed'
		},
		{
			code: 2,
			logs: '[FATAL] pm2 start failed — investigate with `pm2 logs selva-compute`\n',
			severity: 'critical',
			why: 'pm2 start failed'
		},
		{
			code: 3,
			logs: '[FATAL] No prior version recorded — cannot roll back automatically.\n',
			severity: 'critical',
			why: 'no rollback target'
		},
		{
			code: 4,
			logs: '[FATAL] Rollback npm install failed — EXIT trap will retry restart.\n',
			severity: 'critical',
			why: 'rollback install failed'
		},
		{
			code: 5,
			logs: '[DONE] Rolled back to 4.2.0 — previous version is online\n',
			severity: 'warning',
			why: 'safe rollback, app up'
		},
		{
			code: 6,
			logs: '[FATAL] Manual recovery required. Check: pm2 logs selva-compute\n',
			severity: 'critical',
			why: 'rollback also failed'
		},
		{
			code: 8,
			logs: "[FATAL] PM2_SKEW: the running daemon (v6.0.14) is NEWER than this deployment's pm2 (v5.4.3).\n",
			severity: 'warning',
			why: 'pm2 skew abort, app untouched'
		},
		{
			code: 9,
			logs: "[FATAL] SYSTEMD_PM2: this deployment's PM2 is supervised by systemd, and the daemon\n",
			severity: 'warning',
			why: 'systemd guard, app untouched'
		}
	];

	it.each(CASES)('exit $code ($why) → $severity', ({ code, logs, severity }) => {
		expect(deriveOutcome(code, logs).severity).toBe(severity);
	});

	it('every exit code in the script has a case above', () => {
		const script = runner();
		const codes = new Set([...script.matchAll(/^\s*exit (\d+)/gm)].map((m) => Number(m[1])));
		const covered = new Set(CASES.map((c) => c.code));
		expect([...codes].filter((c) => !covered.has(c))).toEqual([]);
	});

	it('gives every critical case an actionable next step', () => {
		for (const { code, logs } of CASES) {
			const outcome = deriveOutcome(code, logs);
			if (outcome.severity === 'critical') expect(outcome.detail).toBeTruthy();
		}
	});

	it('treats the harness timeout as critical, not a silent success', () => {
		const outcome = deriveOutcome(TIMED_OUT, '[STEP] Updating @selvajs/* packages\n');
		expect(outcome.severity).toBe('critical');
		expect(outcome.title).toContain('15 minutes');
	});

	it('never reports an unrecognised non-zero exit as success', () => {
		expect(deriveOutcome(99, 'something unexpected\n').severity).toBe('critical');
	});
});

describe('a killed runner is never a green success (issue #118)', () => {
	// The verbatim trace from the incident. `$?` inside an EXIT trap reports the
	// last completed command, not the signal — so before the TERM trap existed
	// this ended with `[EXIT] code=0` and classified as a clean update, claiming
	// "Updated 4.6.3 → 4.6.4. The app is back online." while npm never ran.
	const INCIDENT = [
		'[INFO] Current @selvajs/selva: 4.6.3',
		'[INFO] Target (latest): 4.6.3 → 4.6.4',
		"[STEP] PM2 daemon is out-of-date — running 'pm2 update' to resync",
		'[INFO] PM2 daemon resynced',
		'[STEP] Stopping selva-compute',
		"[RECOVER] selva-compute is 'error' — starting from ecosystem.config.cjs"
	].join('\n');

	it('installs TERM/INT/HUP traps so the recorded code reflects the signal', () => {
		const script = runner();
		expect(script).toContain("trap 'on_signal TERM 143' TERM");
		expect(script).toContain("trap 'on_signal INT 130' INT");
		expect(script).toContain("trap 'on_signal HUP 129' HUP");
	});

	it('classifies a SIGTERMed run as critical, not a completed update', () => {
		const logs = `${INCIDENT}\n[FATAL] KILLED: runner received SIGTERM before finishing.\n[EXIT] code=143\n`;
		const outcome = deriveOutcome(143, logs);
		expect(outcome.severity).toBe('critical');
		expect(outcome.title).toMatch(/killed|nothing was installed/i);
		// The old bug: claiming the version moved when it did not.
		expect(outcome.title).not.toMatch(/back online/i);
	});

	it('does not claim a version transition the run never performed', () => {
		const logs = `${INCIDENT}\n[FATAL] KILLED: runner received SIGTERM before finishing.\n[EXIT] code=143\n`;
		expect(deriveOutcome(143, logs).title).not.toContain('4.6.4');
	});

	it('catches a killed run even if the exit code is lost', () => {
		// Belt and braces: the KILLED marker alone is enough to classify.
		const logs = `${INCIDENT}\n[FATAL] KILLED: runner received SIGTERM before finishing.\n`;
		expect(deriveOutcome(0, logs).severity).toBe('critical');
	});

	it('refuses to resync PM2 under systemd instead of being killed by it', () => {
		const script = runner();
		const guard = script.indexOf('SYSTEMD_PM2');
		const update = script.indexOf("running 'pm2 update' to resync");
		expect(guard).toBeGreaterThan(-1);
		// The guard must come before the resync it is protecting against.
		expect(guard).toBeLessThan(update);
		expect(script.slice(guard, update)).toContain('exit 9');
	});
});

describe('Node engine mismatch is never a green success (issue #176)', () => {
	// The exact npm warning from the incident: install succeeds, pm2 starts,
	// /api/health returns 200, so nothing else in the pipeline objects.
	const EBADENGINE =
		'npm warn EBADENGINE Unsupported engine {\n' +
		"npm warn EBADENGINE   package: '@selvajs/selva@4.8.0-beta.4',\n" +
		"npm warn EBADENGINE   required: { node: '>=22.0.0' },\n" +
		"npm warn EBADENGINE   current: { node: 'v20.20.2', npm: '11.15.0' }\n" +
		'npm warn EBADENGINE }\n' +
		'[INFO] New @selvajs/selva: 4.8.0-beta.4\n' +
		'[DONE] Update complete\n';

	it('downgrades a clean exit 0 to warning when npm reported EBADENGINE', () => {
		const outcome = deriveOutcome(0, EBADENGINE);
		expect(outcome.severity).toBe('warning');
		expect(outcome.severity).not.toBe('success');
	});

	it('names both Node versions from the runner’s own marker', () => {
		const marker =
			'[WARN] ENGINE_MISMATCH: @selvajs/selva@4.8.0-beta.4 requires Node >=22.0.0 but this host runs v20.20.2\n' +
			'[INFO] New @selvajs/selva: 4.8.0-beta.4\n[DONE] Update complete\n';
		const outcome = deriveOutcome(0, marker);
		expect(outcome.severity).toBe('warning');
		expect(outcome.title).toContain('>=22.0.0');
		expect(outcome.title).toContain('20.20.2');
		expect(outcome.detail).toMatch(/Upgrade Node/i);
	});

	it('still reports a matching-engine update as success', () => {
		const clean = '[INFO] New @selvajs/selva: 4.8.0-beta.4\n[DONE] Update complete\n';
		expect(deriveOutcome(0, clean).severity).toBe('success');
	});
});
