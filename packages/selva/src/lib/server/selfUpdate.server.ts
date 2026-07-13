/**
 * Self-update observability (audit O2): durable log/state paths for the update
 * runner, plus post-restart reconciliation of the update's outcome into the
 * audit event log.
 *
 * The process that launches an update is killed mid-update (`pm2 stop
 * selva-compute` is a step of the update itself), so only the
 * `system.update.started` event can be emitted synchronously by the POST
 * handler. The terminal event (`finished` / `rolled_back` / `failed`) is
 * derived AFTER the app is back up: the POST persists a pending-update state
 * file next to the log, and the reconciler here polls the log until the
 * runner's `[EXIT] code=N` marker appears, classifies it via `deriveOutcome`,
 * emits the matching event, and consumes the state file. Kicked from both the
 * POST (covers the no-restart "already up to date" path) and the first request
 * after boot (covers the real update path, where the emitting process is new).
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainEvent } from '@selvajs/platform';
import { deriveOutcome } from '$lib/update-outcome';

// ============================================================================
// Deployment-dir detection + durable paths
// ============================================================================

// Selva self-updates as a CLI-scaffolded npm deployment: the deployment dir
// holds a package.json that depends on @selvajs/selva. We probe the cwd upward
// for the installed package as proof we're in such a deployment; `INSTALL_DIR`
// lets an operator pin the root explicitly (useful when the SvelteKit process
// cwd isn't the install dir).
export function isDeploymentDir(dir: string): boolean {
	return existsSync(join(dir, 'node_modules', '@selvajs', 'selva', 'package.json'));
}

export function findDeploymentDir(env: Record<string, string | undefined>): string | null {
	if (env.INSTALL_DIR && isDeploymentDir(env.INSTALL_DIR)) return env.INSTALL_DIR;
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		if (isDeploymentDir(dir)) return dir;
		const parent = join(dir, '..');
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * Where the update runner mirrors all its output. Lives in the deployment dir
 * so it survives reboots (it used to be `/tmp/selva-update.log`, wiped on
 * reboot — audit O2); the `/tmp` fallback only applies outside a deployment
 * (dev), where no update can actually run.
 */
export function updateLogPath(deploymentDir: string | null): string {
	return deploymentDir ? join(deploymentDir, 'selva-update.log') : '/tmp/selva-update.log';
}

/** Pending-update marker consumed by the reconciler. Sits next to the log. */
export function updateStatePath(deploymentDir: string): string {
	return join(deploymentDir, 'selva-update-state.json');
}

/** Written by the update POST just before it spawns the runner. */
export interface PendingUpdateState {
	startedAt: string;
	actorId: string;
	channel: string;
	fromVersion?: string;
}

// ============================================================================
// Outcome reconciliation
// ============================================================================

/** Injected so the reconciler is testable without providers or real timers. */
export interface ReconcilerDeps {
	deploymentDir: string;
	emit: (event: DomainEvent) => Promise<void>;
	/** Error-tracker hook — called for rollback/failure outcomes. */
	report: (error: unknown) => void;
}

export type ReconcileResult = 'no_pending_update' | 'still_running' | 'reconciled';

/**
 * One reconciliation attempt. Reads the pending-update state file; if the log
 * carries the runner's terminal `[EXIT] code=N` marker, classifies the outcome,
 * emits the terminal audit event, reports rollback/failure to the error
 * tracker, and deletes the state file (exactly-once across restarts — the
 * state file is the emission token).
 */
export async function reconcileUpdateOutcome(deps: ReconcilerDeps): Promise<ReconcileResult> {
	const statePath = updateStatePath(deps.deploymentDir);
	let state: PendingUpdateState;
	try {
		state = JSON.parse(readFileSync(statePath, 'utf8'));
	} catch {
		return 'no_pending_update';
	}

	let logs = '';
	try {
		logs = readFileSync(updateLogPath(deps.deploymentDir), 'utf8');
	} catch {
		// State without a log: the launcher truncates the log as its first act,
		// so this is either the sub-second startup window or a manually deleted
		// log. Treat as still running; the poll cap below resolves a stuck state.
	}

	const exitMatch = /\[EXIT\] code=(\d+)/.exec(logs);
	if (!exitMatch) return 'still_running';
	const exitCode = Number(exitMatch[1]);

	const outcome = deriveOutcome(exitCode, logs);
	const base = {
		fromVersion: state.fromVersion ?? outcome.from,
		toVersion: outcome.to,
		actorId: state.actorId
	};

	let event: DomainEvent;
	if (outcome.severity === 'critical') {
		event = { type: 'system.update.failed', ...base, detail: outcome.title };
	} else if (exitCode === 5 || logs.includes('Rolled back')) {
		event = { type: 'system.update.rolled_back', ...base, detail: outcome.title };
	} else if (outcome.severity === 'success' || outcome.severity === 'info') {
		event = { type: 'system.update.finished', ...base };
	} else {
		// Residual warnings (e.g. "no version change — stale npm cache"): the app
		// is up but nothing was installed. Surface the title so the audit row is
		// self-explanatory.
		event = { type: 'system.update.finished', ...base, detail: outcome.title };
	}

	await deps.emit(event);
	if (event.type !== 'system.update.finished') {
		deps.report(new Error(`[selfUpdate] ${outcome.title}`));
	}

	try {
		rmSync(statePath);
	} catch {
		// Already gone (concurrent tick) — the emit above may then double, which
		// is acceptable for an audit trail; losing the event would not be.
	}
	return 'reconciled';
}

// ============================================================================
// Polling wrapper
// ============================================================================

const POLL_MS = 15_000;
// The runner is hard-capped at 15 minutes by the POST's group-kill; leave
// headroom, then close the pending state as failed so it can't dangle forever.
const MAX_POLLS = 80;

let reconcilerActive = false;

/**
 * Idempotently start polling for a pending update's terminal state. Safe to
 * call on every boot and on every update POST — it exits immediately when no
 * state file exists and never runs twice concurrently.
 */
export function startUpdateOutcomeReconciler(deps: ReconcilerDeps): void {
	if (reconcilerActive) return;
	if (!existsSync(updateStatePath(deps.deploymentDir))) return;
	reconcilerActive = true;

	let polls = 0;
	const timer = setInterval(() => {
		void (async () => {
			polls += 1;
			let result: ReconcileResult;
			try {
				result = await reconcileUpdateOutcome(deps);
			} catch (err) {
				console.error('[selfUpdate] outcome reconciliation failed:', err);
				result = 'still_running';
			}
			if (result === 'still_running' && polls < MAX_POLLS) return;

			if (result === 'still_running') {
				// No terminal marker within the window — close the pending state as
				// failed rather than leaving it to re-arm on every future boot.
				try {
					const statePath = updateStatePath(deps.deploymentDir);
					const state: PendingUpdateState = JSON.parse(readFileSync(statePath, 'utf8'));
					await deps.emit({
						type: 'system.update.failed',
						fromVersion: state.fromVersion,
						actorId: state.actorId,
						detail: 'No terminal marker in the update log within 20 minutes.'
					});
					deps.report(new Error('[selfUpdate] update never reached a terminal state'));
					rmSync(statePath);
				} catch {
					// State file unreadable/already gone — nothing left to close.
				}
			}
			clearInterval(timer);
			reconcilerActive = false;
		})();
	}, POLL_MS);
	// Never keep the process alive just to poll.
	timer.unref?.();
}
