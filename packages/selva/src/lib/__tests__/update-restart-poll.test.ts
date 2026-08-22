import { describe, it, expect } from 'vitest';

import {
	pollForRestart,
	exitCodeFromLog,
	RESTART_DEADLINE_MS,
	POLL_INTERVAL_MS,
	SETTLE_MS,
	type RestartHealth,
	type PollDeps
} from '../update-restart-poll';

const OLD_ID = 'instance-old';
const NEW_ID = 'instance-new';

const DONE_LOG = '[INFO] Updating\n[DONE] Update complete\n';
const ROLLBACK_LOG =
	'[INFO] Updating\n[ERROR] New process failed health check\n' +
	'[INFO] Rolled back to 4.7.3 — previous version is online\n';

function healthy(instanceId: string): RestartHealth {
	return { status: 'ok', instanceId };
}

// Drives the loop on a virtual clock: `sleep` advances the clock instead of
// waiting, so a 5-minute deadline resolves in microseconds and a probe that
// never settles can be modelled without hanging the test.
function harness(overrides: Partial<RestartProbeScript> = {}) {
	const script: RestartProbeScript = {
		health: async () => null,
		log: async () => null,
		ready: async () => false,
		...overrides
	};

	let clock = 1_000_000;
	let displayed = '';
	const appended: string[] = [];
	const calls = { health: 0, log: 0, ready: 0 };

	const deps: PollDeps = {
		probes: {
			health: () => {
				calls.health++;
				return script.health(calls.health);
			},
			log: () => {
				calls.log++;
				return script.log(calls.log);
			},
			ready: () => {
				calls.ready++;
				return script.ready(calls.ready);
			}
		},
		now: () => clock,
		sleep: async (ms) => {
			clock += ms;
		},
		onLog: (log) => {
			displayed = log;
		},
		appendLog: (line) => {
			appended.push(line);
			displayed += line;
		}
	};

	return {
		deps,
		calls,
		get displayed() {
			return displayed;
		},
		get appended() {
			return appended;
		},
		elapsed: () => clock - 1_000_000
	};
}

interface RestartProbeScript {
	health(call: number): Promise<RestartHealth | null>;
	log(call: number): Promise<string | null>;
	ready(call: number): Promise<boolean>;
}

describe('exitCodeFromLog', () => {
	it('ranks failed rollback above safe rollback', () => {
		const log = ROLLBACK_LOG + '[FATAL] Manual recovery required\n';
		expect(exitCodeFromLog(log)).toBe(6);
	});

	it('reads a safe rollback as 5, not as a clean run', () => {
		expect(exitCodeFromLog(ROLLBACK_LOG)).toBe(5);
	});

	it('reads a health-check failure with no rollback as 3', () => {
		expect(exitCodeFromLog('[ERROR] New process failed health check\n')).toBe(3);
	});

	it('reads a clean run as 0', () => {
		expect(exitCodeFromLog(DONE_LOG)).toBe(0);
	});

	it('does not report a fatal that still reached [DONE] as a failure', () => {
		expect(exitCodeFromLog('[FATAL] transient\n[DONE] finished\n')).toBe(0);
	});

	it('returns null while the log carries no terminal marker', () => {
		expect(exitCodeFromLog('[STEP] Stopping selva-compute\n')).toBeNull();
	});
});

// A stopped app behind a reverse proxy does not refuse the connection — the
// proxy holds it open until its own read timeout. The loop cannot defend against
// that on its own: it awaits `Promise.all` of the three probes, so a probe that
// never settles hangs it forever regardless of the deadline.
//
// The bound is `AbortSignal.timeout` on the caller's fetch wrappers, which turns
// a hung socket into a slow *rejection*. This module's contract is therefore
// "probes always settle" — these tests model the proxy the way the caller
// actually delivers it, and pin the behaviour that the fix has to preserve.
describe('pollForRestart — slow probes (hung proxy, bounded by the caller)', () => {
	it('keeps advancing when every probe burns most of the poll interval', async () => {
		const h = harness();
		const slow: PollDeps = {
			...h.deps,
			probes: {
				health: async () => {
					await h.deps.sleep(4000); // the caller's PROBE_TIMEOUT_MS
					return null;
				},
				log: async () => null,
				ready: async () => false
			}
		};

		const verdict = await pollForRestart(OLD_ID, slow);
		expect(verdict).toEqual({ exitCode: -2 });
	});

	it('recovers once a slow probe starts answering', async () => {
		const h = harness({
			health: async (call) => {
				if (call < 3) return null; // blackout: proxy timing out
				return healthy(NEW_ID);
			},
			log: async (call) => (call < 3 ? null : DONE_LOG),
			ready: async (call) => call >= 3
		});

		expect(await pollForRestart(OLD_ID, h.deps)).toEqual({ exitCode: 0 });
		expect(h.calls.health).toBe(3);
	});
});

describe('pollForRestart — termination branches', () => {
	it('reports success once a fresh instanceId is warm', async () => {
		const h = harness({
			health: (call) => Promise.resolve(call < 3 ? null : healthy(NEW_ID)),
			log: (call) => Promise.resolve(call < 3 ? '[STEP] Stopping\n' : DONE_LOG),
			ready: (call) => Promise.resolve(call >= 3)
		});

		expect(await pollForRestart(OLD_ID, h.deps)).toEqual({ exitCode: 0 });
	});

	it('does not accept a fresh instanceId that is neither warm nor finished', async () => {
		// /api/health flips to the new process a beat before real routes serve
		// through the proxy. Accepting on instanceId alone is the premature-online
		// race that left an immediate reload hitting a 502. With no terminal marker
		// in the log either, there is still nothing to report.
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => '[STEP] Booting\n',
			ready: async () => false
		});

		expect(await pollForRestart(OLD_ID, h.deps)).toEqual({ exitCode: -2 });
	});

	it('finishes on the runner verdict when readiness never goes green', async () => {
		// The hang this fixes: the readiness route re-runs live integrity checks,
		// so it reports false whenever an unrelated dependency is down (an
		// unreachable compute server) and can outrun the caller's probe timeout on
		// a slow host. The update itself succeeded — [DONE] is in the log and a
		// fresh process is serving — so requiring readiness left the banner
		// spinning until the deadline turned a success into a false failure.
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => DONE_LOG,
			ready: async () => false
		});

		const verdict = await pollForRestart(OLD_ID, h.deps);
		expect(verdict).toEqual({ exitCode: 0 });
		expect(h.elapsed()).toBeLessThan(RESTART_DEADLINE_MS);
	});

	it('still reports a rollback correctly when readiness never goes green', async () => {
		// The log-marker fallback must not flatten every outcome to success.
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => ROLLBACK_LOG,
			ready: async () => false
		});

		expect(await pollForRestart(OLD_ID, h.deps)).toEqual({ exitCode: 5 });
	});

	it('resolves the no-restart path when readiness never goes green', async () => {
		// "Already up to date" never restarts, so the instanceId is stable AND the
		// readiness probe may be failing for unrelated reasons. The marker decides.
		const h = harness({
			health: async () => healthy(OLD_ID),
			log: async () => '[INFO] Already on the beta channel version (4.8.0-beta.11)\n[DONE]\n',
			ready: async () => false
		});

		const verdict = await pollForRestart(OLD_ID, h.deps);
		expect(verdict).toEqual({ exitCode: 0 });
		expect(h.elapsed()).toBeLessThan(RESTART_DEADLINE_MS);
	});

	it('accepts a degraded (503) health body as a reachable process', async () => {
		// The caller maps a 503 `degraded` body to a real RestartHealth rather than
		// null — the process is up and answering, which is all this loop asks. A
		// degraded-but-serving instance must not stall the restart wait.
		const h = harness({
			health: async () => ({ status: 'degraded', instanceId: NEW_ID }),
			log: async () => DONE_LOG,
			ready: async () => false
		});

		expect(await pollForRestart(OLD_ID, h.deps)).toEqual({ exitCode: 0 });
	});

	it('reports a rollback as 5 even though a fresh process is serving', async () => {
		// A rollback brings up a healthy process on the OLD version. Reporting 0
		// here would tell the operator the update worked.
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => ROLLBACK_LOG,
			ready: async () => true
		});

		expect(await pollForRestart(OLD_ID, h.deps)).toEqual({ exitCode: 5 });
	});

	it('resolves the no-restart path where instanceId never changes', async () => {
		// "Already up to date" exits before `pm2 stop`, so the instanceId is stable
		// forever. Keying on a fresh id alone would wait out the whole deadline and
		// report a false failure.
		const h = harness({
			health: async () => healthy(OLD_ID),
			log: async () => '[INFO] Already on the beta channel version (4.8.0-beta.9)\n[DONE]\n',
			ready: async () => true
		});

		const verdict = await pollForRestart(OLD_ID, h.deps);
		expect(verdict).toEqual({ exitCode: 0 });
		expect(h.elapsed()).toBeLessThan(RESTART_DEADLINE_MS);
	});

	it('falls back to the log verdict when no baseline instanceId was captured', async () => {
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => DONE_LOG,
			ready: async () => true
		});

		expect(await pollForRestart(null, h.deps)).toEqual({ exitCode: 0 });
	});

	it('waits for a terminal marker when the build reports no instanceId at all', async () => {
		// An older build with no per-boot fingerprint: `newProcessUp` can never
		// fire, so the only usable signal is the runner's own terminal marker. A
		// reachable app with no verdict yet must not be accepted as done.
		let ticks = 0;
		const h = harness({
			health: async () => ({ status: 'ok' }),
			log: async () => {
				ticks++;
				return ticks < 4 ? '[STEP] Installing\n' : DONE_LOG;
			},
			ready: async () => true
		});

		expect(await pollForRestart(null, h.deps)).toEqual({ exitCode: 0 });
		expect(ticks).toBe(4);
	});
});

describe('pollForRestart — deadline budget', () => {
	it('spends wall-clock, not attempts, so slow probes cannot overrun the budget', async () => {
		// The bug the deadline replaced: `150 attempts × 2s` is only 5 minutes if
		// each probe returns instantly. Here every probe burns 30s of clock, so an
		// attempt-counted loop would run for well over an hour.
		const h = harness({
			health: async () => null,
			log: async () => null,
			ready: async () => false
		});

		const slow: PollDeps = {
			...h.deps,
			probes: {
				health: async () => {
					await h.deps.sleep(30_000);
					return null;
				},
				log: async () => null,
				ready: async () => false
			}
		};

		const verdict = await pollForRestart(OLD_ID, slow);
		expect(verdict).toEqual({ exitCode: -2 });
		expect(h.elapsed()).toBeLessThan(RESTART_DEADLINE_MS + 60_000);
	});

	it('settles before the first probe so PM2 can kill the old process', async () => {
		const seenAt: number[] = [];
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => DONE_LOG,
			ready: async () => true
		});
		const spy: PollDeps = {
			...h.deps,
			probes: {
				...h.deps.probes,
				health: async () => {
					seenAt.push(h.elapsed());
					return healthy(NEW_ID);
				}
			}
		};

		await pollForRestart(OLD_ID, spy);
		expect(seenAt[0]).toBe(SETTLE_MS);
	});
});

describe('pollForRestart — log surfacing', () => {
	it('replaces the display with blackout output once the log is readable', async () => {
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => DONE_LOG,
			ready: async () => true
		});

		await pollForRestart(OLD_ID, h.deps);
		expect(h.displayed).toContain('[DONE]');
	});

	it('never clobbers the SSE-collected prefix with an empty log body', async () => {
		// An empty body means the file is not there yet, not that there is nothing
		// to show. Overwriting would lose everything the SSE stream captured.
		const h = harness({
			health: async () => healthy(NEW_ID),
			log: async () => '   ',
			ready: async () => true
		});

		await pollForRestart(OLD_ID, h.deps);
		expect(h.displayed).not.toBe('   ');
		expect(h.displayed).toContain('Waiting for app to come back online');
	});

	it('appends the timeout notice when the app never returns', async () => {
		const h = harness();
		const verdict = await pollForRestart(OLD_ID, h.deps);

		expect(verdict).toEqual({ exitCode: -2 });
		expect(h.appended.join('')).toContain('did not come back within 5 minutes');
	});

	it('polls on the documented interval', async () => {
		const h = harness();
		await pollForRestart(OLD_ID, h.deps);
		// Roughly deadline/interval ticks, allowing for the settle and final fetch.
		expect(h.calls.health).toBeCloseTo(RESTART_DEADLINE_MS / POLL_INTERVAL_MS, -1);
	});
});
