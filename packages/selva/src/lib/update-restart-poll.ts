// ============================================================================
// Restart-wait polling
// ============================================================================
//
// After the update runner is daemonized, the SSE stream dies at `pm2 stop` and
// the browser's only remaining view of the update is polling. This module owns
// that poll loop, kept separate from the admin page so the loop's real inputs
// (three probe results and a clock) and real output (a verdict) stay testable
// without the `$state` writes and fetch calls as I/O costume — with the clock
// and probes injected, a 5-minute deadline runs in microseconds.
//
// **Every probe MUST settle.** The loop awaits `Promise.all` of the three, so a
// probe that hangs forever hangs the loop, deadline or not. A probe against a
// stopped app usually does NOT fail fast — the reverse proxy in front of it
// holds the connection open until its own read timeout rather than refusing
// it. Bounding that is the caller's job (`AbortSignal.timeout` on each fetch);
// without it the UI freezes on "PM2 is restarting…" until a manual reload.

export interface RestartHealth {
	status: string;
	instanceId?: string | null;
	version?: string | null;
}

/**
 * The three probes the loop runs each tick. Each resolves to a "nothing yet"
 * value rather than rejecting — a failed probe during the restart blackout is
 * the expected case, not an error.
 */
export interface RestartProbes {
	/**
	 * /api/health — null when unreachable or still booting. A 503 `degraded`
	 * body still counts as reachable: the process is up and answering.
	 */
	health(): Promise<RestartHealth | null>;
	/** The tee'd update log file — null when the fetch failed. */
	log(): Promise<string | null>;
	/** The heavier readiness route — true only on a real 200. */
	ready(): Promise<boolean>;
}

export interface PollDeps {
	probes: RestartProbes;
	now(): number;
	sleep(ms: number): Promise<void>;
	/** Log content that should replace the display. */
	onLog(logs: string): void;
	/** Each appended line (the waiting notice, the timeout notice). */
	appendLog(line: string): void;
}

export interface RestartVerdict {
	exitCode: number;
}

/** Matches `TIMED_OUT` in update-outcome.ts. */
const NEVER_CAME_BACK = -2;

/** How long to give PM2 to actually kill the old process before polling. */
export const SETTLE_MS = 2000;
/** Gap between poll ticks. */
export const POLL_INTERVAL_MS = 2000;
/**
 * npm update on a slow VPS with a cold packument cache plus a pm2 cold start
 * can legitimately take 60–90s; an earlier 90s deadline was failing live
 * updates that were otherwise succeeding in the background.
 */
export const RESTART_DEADLINE_MS = 5 * 60 * 1000;

/**
 * The health poll only proves the app is *reachable* — NOT that the update
 * succeeded. A rollback (runner exit 5) leaves the app perfectly healthy on
 * the OLD version; reporting that as exit 0 would tell the operator the
 * update worked. So this reads the runner's own verdict out of the log.
 *
 * Returns null when the log carries no terminal marker yet.
 */
export function exitCodeFromLog(log: string): number | null {
	if (/\bManual recovery required\b/.test(log)) return 6; // rollback failed — app may be DOWN
	if (/\bRolled back to .* — previous version is online\b/.test(log)) return 5; // safe rollback
	if (/New process failed health check/.test(log) && !/Rolled back/.test(log)) return 3;
	if (/\[FATAL\]/.test(log) && !/\[DONE\]/.test(log)) return 1; // fatal with no clean finish
	if (/\[DONE\]/.test(log)) return 0; // runner reported clean completion
	return null;
}

/**
 * Polls until we're confident the *new* process is serving, or the deadline
 * passes.
 *
 * The reliable signal is `instanceId`: a per-boot fingerprint from /api/health
 * that changes on every restart. We wait for it to differ from the process
 * running before we started — the only moment we know the old process is gone
 * and a fresh one is answering. Works in every deployment shape (npm has no
 * git commit) and even when the new build is the same version.
 *
 * A fresh instanceId alone is not treated as done: /api/health answers the
 * instant the process boots, a beat before real routes serve through the
 * proxy, so a premature "online" verdict left an immediate reload hitting a
 * 502. The heavier readiness probe closes that gap as an *accelerator*, never
 * a requirement — it re-runs live integrity checks per request, so it reports
 * false whenever an unrelated dependency is down and can outrun the caller's
 * probe timeout on a slow host. So the loop finishes on either signal:
 * readiness going green, or the runner writing its own terminal marker to the
 * log. Requiring both is what hung a *successful* update on "PM2 is
 * restarting…" until the deadline turned it into a false failure.
 */
export async function pollForRestart(
	previousInstanceId: string | null | undefined,
	deps: PollDeps
): Promise<RestartVerdict> {
	const { probes, now, sleep, onLog, appendLog } = deps;

	appendLog('\nWaiting for app to come back online…\n');
	await sleep(SETTLE_MS);

	// A deadline, not an attempt count: a probe that times out costs seconds
	// instead of returning instantly, so N attempts × interval is not N ×
	// interval of wall-clock. Budget the wall-clock directly.
	const deadline = now() + RESTART_DEADLINE_MS;

	// Mirrors what the caller displays, so the log-derived verdict sees the
	// same content the operator does.
	let logs = '';

	while (now() < deadline) {
		const [health, log, ready] = await Promise.all([probes.health(), probes.log(), probes.ready()]);

		// Empty bodies are ignored — the file isn't there yet, and clobbering the
		// SSE-collected prefix with nothing would lose it.
		if (log && log.trim().length > 0) {
			logs = log;
			onLog(log);
		}

		const logVerdict = exitCodeFromLog(logs);
		const freshInstance = !!health?.instanceId && health.instanceId !== previousInstanceId;

		// Trust the runner's logged verdict over a bare assumption of success — a
		// rollback also brings up a fresh process but must not read as a clean
		// update.
		if (freshInstance && ready) {
			return { exitCode: logVerdict ?? 0 };
		}

		// A fresh process is answering AND the runner wrote its terminal marker,
		// but the heavy readiness route hasn't gone green. Readiness is a
		// *quality* signal, not a liveness one — it stays false whenever an
		// unrelated dependency is down (an unreachable compute server is the
		// common one) and can outrun the caller's probe timeout on a slow host.
		// Requiring it here is what left a finished update spinning on "PM2 is
		// restarting…" until the deadline reported a false failure. The runner's
		// own marker is the authority on whether the update finished.
		if (freshInstance && logVerdict !== null) {
			return { exitCode: logVerdict };
		}

		// No-restart terminal: the runner reached a verdict WITHOUT bringing up a
		// new process — the pre-flight "already up to date" path exits before
		// `pm2 stop`, and an early failure aborts while the old process still
		// serves. In both cases instanceId never changes, so the fresh-instance
		// branches can never fire and keying on them alone would wait out the
		// full deadline. When the app is reachable on the SAME instanceId and the
		// log carries a terminal marker, that marker IS the outcome.
		if (logVerdict !== null && health && health.instanceId === previousInstanceId) {
			return { exitCode: logVerdict };
		}

		// No baseline instanceId (the pre-update health fetch failed, or an old
		// build with no fingerprint): can't tell the new process from the old one
		// by id, so hold out for the runner's own terminal marker rather than
		// latching onto the still-running old process.
		if (!previousInstanceId && health && logVerdict !== null) {
			return { exitCode: logVerdict };
		}

		await sleep(POLL_INTERVAL_MS);
	}

	// Final fetch so the post-mortem carries the latest content the script
	// managed to write before the deadline.
	const finalLog = await probes.log();
	if (finalLog && finalLog.trim().length > 0) onLog(finalLog);
	appendLog('\n⚠ App did not come back within 5 minutes — check PM2 logs.\n');
	return { exitCode: NEVER_CAME_BACK };
}
