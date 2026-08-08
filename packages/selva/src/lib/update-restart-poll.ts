// ============================================================================
// Restart-wait polling
// ============================================================================
//
// After the update runner is daemonized, the SSE stream dies at `pm2 stop` and
// the browser's only remaining view of the update is polling. This module owns
// that poll loop.
//
// It is separated from the admin page for the same reason `deriveOutcome` is:
// the loop's real inputs are three probe results and a clock, and its real
// output is a verdict. Everything else — the `$state` writes, the fetch calls —
// is I/O costume. With the clock and probes injected, a 5-minute deadline runs
// in microseconds.
//
// **Every probe MUST settle.** The loop awaits `Promise.all` of the three, so a
// probe that hangs forever hangs the loop, deadline or not. This matters because
// a probe against a stopped app usually does NOT fail fast — the reverse proxy
// in front of it holds the connection open until its own read timeout rather
// than refusing the connection. Bounding that is the caller's job
// (`AbortSignal.timeout` on each fetch); without it the UI freezes on
// "PM2 is restarting…" and only a manual reload shows the real state.

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
	/** /api/health — null when unreachable, non-2xx, or still booting. */
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
	/** Called when a probe returns log content that should replace the display. */
	onLog(logs: string): void;
	/** Called with each appended line (the waiting notice, the timeout notice). */
	appendLog(line: string): void;
}

export interface RestartVerdict {
	exitCode: number;
}

/** Synthetic exit code for "the app never came back" — matches `TIMED_OUT`. */
const NEVER_CAME_BACK = -2;

/** How long to give PM2 to actually kill the old process before polling. */
export const SETTLE_MS = 2000;
/** Gap between poll ticks. */
export const POLL_INTERVAL_MS = 2000;
/**
 * npm update on a slow VPS with a cold packument cache plus a pm2 cold start can
 * legitimately take 60–90s. An earlier 90s budget was failing live customers
 * whose update was otherwise succeeding in the background.
 */
export const RESTART_DEADLINE_MS = 5 * 60 * 1000;

/**
 * The health poll only proves the app is *reachable* — NOT that the update
 * succeeded. A rollback (runner exit 5) leaves the app perfectly healthy on the
 * OLD version; reporting that as exit 0 would tell the operator the update
 * worked. So we read the runner's own verdict out of the log and map it to the
 * exit code the UI classifies.
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
 * Poll until we're confident the *new* process is serving, or the deadline
 * passes.
 *
 * The reliable signal is `instanceId`: a per-boot fingerprint from /api/health
 * that changes on every restart. We wait for it to differ from the process that
 * was running before we started — the only moment we know the old process is
 * gone and a fresh one is answering. That works in every deployment shape (npm
 * has no git commit) and even when the new build is the same version.
 *
 * "Reachable" is deliberately not treated as "ready". `health()` resolves null
 * for a 503 or a refused connection, and a bare 200 from the OLD process carries
 * the OLD instanceId. Even a fresh instanceId isn't enough alone: /api/health
 * answers the instant the process boots, a beat before real routes serve through
 * the proxy, so we additionally require the heavier readiness probe. That
 * pairing is what prevents a premature "online" verdict leaving an immediate
 * reload on a 502.
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

	// Mirrors what the caller displays, so the log-derived verdict sees the same
	// content the operator does.
	let logs = '';

	while (now() < deadline) {
		const [health, log, ready] = await Promise.all([probes.health(), probes.log(), probes.ready()]);

		// Backfill blackout output as soon as either the old process briefly
		// recovers or the new one comes up. Empty bodies are ignored — the file
		// isn't there yet, and clobbering the SSE-collected prefix with nothing
		// would lose it.
		if (log && log.trim().length > 0) {
			logs = log;
			onLog(log);
		}

		const logVerdict = exitCodeFromLog(logs);

		// Trust the runner's logged verdict over a bare assumption of success — a
		// rollback also brings up a fresh process but must not read as a clean
		// update.
		const newProcessUp = !!health?.instanceId && health.instanceId !== previousInstanceId && ready;
		if (newProcessUp) {
			return { exitCode: logVerdict ?? 0 };
		}

		// No-restart terminal: the runner reached a verdict WITHOUT bringing up a
		// new process — the pre-flight "already up to date" path exits before `pm2
		// stop`, and an early failure aborts while the old process still serves. In
		// both cases the instanceId never changes, so `newProcessUp` can never fire;
		// keying on it alone would wait out the full deadline and report a false
		// failure. When the app is reachable+warm on the SAME instanceId and the log
		// carries a terminal marker, that marker IS the outcome.
		if (logVerdict !== null && health && ready && health.instanceId === previousInstanceId) {
			return { exitCode: logVerdict };
		}

		// No baseline instanceId (the pre-update health fetch failed, or an old
		// build with no fingerprint): we can't tell the new process from the old one
		// by id, so hold out for the runner's own terminal marker rather than
		// latching onto the still-running old process.
		if (!previousInstanceId && health && ready && logVerdict !== null) {
			return { exitCode: logVerdict };
		}

		await sleep(POLL_INTERVAL_MS);
	}

	// Final fetch so the post-mortem carries the latest content the script managed
	// to write before the deadline.
	const finalLog = await probes.log();
	if (finalLog && finalLog.trim().length > 0) onLog(finalLog);
	appendLog('\n⚠ App did not come back within 5 minutes — check PM2 logs.\n');
	return { exitCode: NEVER_CAME_BACK };
}
