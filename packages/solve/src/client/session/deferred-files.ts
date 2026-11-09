// The files a preview skipped, for the result on screen. A preview solve lists the outputs whose
// files it did not make (`SolveResult.deferred`); one full solve of the same values makes all of
// them, and they stay until a different result takes the screen.
//
// The full solve runs with the values the shown result was solved with, never the form's live
// values: on a warm document unchanged inputs mean only the skipped exports rerun, and the files
// must belong to what the user is looking at.

import type { SolveDiagnostic, SolveResult } from '../../shared/solve-fn.js';
import type { RetainedSolveResult } from './solve-session-core.js';

export type DeferredFiles =
	/** The result on screen skipped nothing: its file outputs, if any, arrived with it. */
	| { status: 'none' }
	| { status: 'waiting'; ids: string[] }
	| { status: 'making'; ids: string[]; startedAt: number }
	| { status: 'ready'; ids: string[]; outputs: Record<string, unknown>; durationMs: number }
	/** The full solve ran and made no file for any of `ids`. */
	| { status: 'empty'; ids: string[] }
	| { status: 'failed'; ids: string[]; error: string; diagnostics: SolveDiagnostic[] };

export const NO_DEFERRED_FILES: DeferredFiles = { status: 'none' };

/** Runs one full solve of `values` whose meshes and live events nobody wants. */
export type SolveFiles = (
	values: Record<string, unknown>,
	signal: AbortSignal
) => Promise<SolveResult>;

export interface DeferredFilesTracker {
	readonly state: DeferredFiles;
	/**
	 * Call whenever the result on screen may have changed. A different result drops the old set.
	 * Silent: its callers are landing a result and notify once for both.
	 */
	show(result: RetainedSolveResult | null): void;
	/** Starts the full solve, or joins the running one. Resolves once it settles; never rejects. */
	make(): Promise<void>;
	/** Stops a running full solve; the set goes back to `waiting`. */
	cancel(): void;
}

function hasFile(value: unknown): boolean {
	return Array.isArray(value) ? value.length > 0 : value != null && value !== '';
}

export function createDeferredFiles(
	solveFiles: SolveFiles | undefined,
	onChange: () => void
): DeferredFilesTracker {
	let state: DeferredFiles = NO_DEFERRED_FILES;
	let shown: RetainedSolveResult | null = null;
	let running: { controller: AbortController; done: Promise<void> } | null = null;

	function set(next: DeferredFiles) {
		state = next;
		onChange();
	}

	function stop() {
		running?.controller.abort();
		running = null;
	}

	async function run(
		owner: RetainedSolveResult,
		ids: string[],
		controller: AbortController
	): Promise<void> {
		const startedAt = Date.now();
		set({ status: 'making', ids, startedAt });
		try {
			const result = await solveFiles!(owner.values ?? {}, controller.signal);
			if (controller.signal.aborted || shown !== owner) return;
			if (result.aborted) return set({ status: 'waiting', ids });
			if (result.blocked) {
				const diagnostics = result.diagnostics ?? [];
				const error =
					diagnostics.find((d) => d.level === 'error')?.message ??
					result.errors?.[0] ??
					'The definition refused to make the files.';
				return set({ status: 'failed', ids, error, diagnostics });
			}
			const outputs: Record<string, unknown> = {};
			for (const id of ids) {
				if (hasFile(result.outputs[id])) outputs[id] = result.outputs[id];
			}
			set(
				Object.keys(outputs).length === 0
					? { status: 'empty', ids }
					: { status: 'ready', ids, outputs, durationMs: Date.now() - startedAt }
			);
		} catch (err) {
			if (controller.signal.aborted || shown !== owner) return;
			const error = err instanceof Error ? err.message : String(err);
			set({ status: 'failed', ids, error, diagnostics: [] });
		} finally {
			if (running?.controller === controller) running = null;
		}
	}

	return {
		get state() {
			return state;
		},

		show(result) {
			if (result === shown) return;
			stop();
			shown = result;
			const ids = result?.deferred ?? [];
			// A transport without `solveFiles` can't make them, so it shows them as it always did.
			state = ids.length > 0 && solveFiles ? { status: 'waiting', ids } : NO_DEFERRED_FILES;
		},

		make() {
			if (running) return running.done;
			if (!shown || (state.status !== 'waiting' && state.status !== 'failed')) {
				return Promise.resolve();
			}
			const controller = new AbortController();
			const done = run(shown, state.ids, controller);
			running = { controller, done };
			return done;
		},

		cancel() {
			if (!running || state.status !== 'making') return;
			const { ids } = state;
			stop();
			set({ status: 'waiting', ids });
		}
	};
}
