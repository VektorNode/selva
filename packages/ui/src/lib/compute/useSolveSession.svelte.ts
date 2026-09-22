// A version counter, rather than mirroring each field into its own `$state`, keeps this a
// pure republish: no field list to keep in sync as the session grows, and no mirrored copy
// that can drift from the source of truth.

import type { SolveSession, SolveSessionArgs } from '@selvajs/solve/client';
import { createSolveSession } from '@selvajs/solve/client';

/**
 * Wraps a Solve Session so its state reads reactively inside Svelte components. Use this in
 * a component, never `createSolveSession` directly: the raw session's getters return correct
 * values but never re-render.
 *
 * Must be called during component initialization. The subscription is managed by `$effect`,
 * so teardown follows the owning component's lifecycle.
 */
export function useSolveSession(args: SolveSessionArgs): SolveSession {
	const session = createSolveSession(args);

	let version = $state(0);

	$effect(() => {
		// The session is created alongside this adapter and outlives no other component, so
		// dropping the subscription is the whole cleanup.
		return session.subscribe(() => {
			version += 1;
		});
	});

	function track<T>(read: () => T): T {
		// Reading `version` here is what registers the reactive dependency; don't simplify
		// this to `return read()`, the getters would stop re-rendering.
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
