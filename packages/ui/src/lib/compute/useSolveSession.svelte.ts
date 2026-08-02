// The Svelte binding for a Solve Session.
//
// The session itself lives in `@selvajs/solve/client` and is framework-free: it
// exposes plain getters plus a `subscribe()` seam. That makes it usable headless, but a
// plain getter read inside Svelte markup is NOT reactive — nothing tells the component to
// re-run. This adapter closes that gap: it subscribes once, bumps a `$state` version
// counter on every notification, and reads that counter inside each getter so any
// component touching one re-runs when the session changes.
//
// The counter (rather than mirroring each field into its own `$state`) keeps this a pure
// republish: no field list to keep in sync as the session grows, and no risk of a mirrored
// copy drifting from the source of truth.

import type { SolveSession, SolveSessionArgs } from '@selvajs/solve/client';
import { createSolveSession } from '@selvajs/solve/client';

/**
 * Wraps a Solve Session so its state reads reactively inside Svelte components.
 *
 * Returns the same `SolveSession` surface — every method delegates untouched, and every
 * getter additionally depends on the version counter. Callers use it exactly like the
 * session it wraps.
 *
 * Must be called during component initialization (it uses `$effect` to manage the
 * subscription, so teardown follows the owning component's lifecycle).
 */
export function useSolveSession(args: SolveSessionArgs): SolveSession {
	const session = createSolveSession(args);

	// Bumped on every session notification. Reading it inside a getter is what registers
	// the dependency; the value itself is never meaningful.
	let version = $state(0);

	$effect(() => {
		// Re-read on mount and unsubscribe on teardown. The session outlives no component
		// here — it is created alongside this adapter — so dropping the subscription is the
		// whole cleanup.
		return session.subscribe(() => {
			version += 1;
		});
	});

	/** Registers the reactive dependency, then returns the live value. */
	function track<T>(read: () => T): T {
		void version;
		return read();
	}

	return {
		get values() {
			return track(() => session.values);
		},
		get error() {
			return track(() => session.error);
		},
		get computeErrors() {
			return track(() => session.computeErrors);
		},
		get computeWarnings() {
			return track(() => session.computeWarnings);
		},
		get meshes() {
			return track(() => session.meshes);
		},
		get lastResult() {
			return track(() => session.lastResult);
		},
		get hasPendingChanges() {
			return track(() => session.hasPendingChanges);
		},
		get hasNeverSolved() {
			return track(() => session.hasNeverSolved);
		},
		get isSolving() {
			return track(() => session.isSolving);
		},
		setValue: (id, value, forceSolve) => session.setValue(id, value, forceSolve),
		solve: () => session.solve(),
		loadValues: (incoming) => session.loadValues(incoming),
		rebuild: (schema, scopeKey) => session.rebuild(schema, scopeKey),
		report: (result) => session.report(result),
		reportError: (message) => session.reportError(message),
		subscribe: (listener) => session.subscribe(listener),
		notify: () => session.notify()
	};
}
