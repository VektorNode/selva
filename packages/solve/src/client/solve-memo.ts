// Client-side solve result memo (M2). A small LRU keyed on a stable serialization of
// the solve INPUTS, sitting in front of the request/response driver. Dragging a slider
// back to a value already solved this session returns instantly without a network
// round-trip — killing slider-scrub storms before they leave the browser. It pairs with
// the throttle's latest-wins abort: the memo only serves values that fully solved, so a
// hit is always a complete result.
//
// Mesh ownership (audit C1) is the reason this file takes an options object at all. A
// SolveResult can carry live renderer objects, and a viewer typically takes ownership of
// every mesh array it renders — disposing the previous content on the next update. So the
// memo can neither hand out its own instances (they'd be disposed under it, then re-added
// dead on the next hit) nor drop entries silently (their GPU buffers would leak). It
// therefore keeps private copies, serves a fresh copy per hit, and releases an entry
// whenever it leaves the map.
//
// **But it does not know what a mesh is.** `TMesh` is opaque here and the clone/release
// policy is injected. The three.js implementation lives in `@selvajs/visualization`, next
// to the viewer whose disposal rule creates the requirement — which is what keeps `three`
// out of this package entirely.

import type { SolveResult } from '../shared/solve-fn.js';

/**
 * Deterministic string key for a set of input values. Object keys are sorted at every
 * level so two logically-equal inputs (built in different key order) collide, matching
 * the server's stable-input keying intent. Values are plain JSON (numbers, strings,
 * booleans, arrays) — the projected solve inputs never contain functions or cycles.
 */
export function stableInputKey(values: Record<string, unknown>): string {
	return serialize(values);
}

function serialize(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`).join(',')}}`;
}

/**
 * The ownership policy a memo needs when its results carry meshes someone else disposes.
 *
 * Omit it for mesh-free results, or for meshes no consumer takes ownership of: the memo
 * then stores and serves them by reference, which is correct precisely because nothing
 * frees them behind its back.
 *
 * @property clone - Returns copies the recipient owns outright. Called on the way in AND
 *   on every hit, so neither the stored entry nor a previously served one can be disposed
 *   by the other's owner.
 * @property release - Frees an entry's resources when it leaves the map (eviction,
 *   overwrite, `clear()`). Must NOT free anything shared with live content — see
 *   `disposeSceneObjects` in `@selvajs/visualization/parse`, which skips materials for
 *   exactly that reason.
 */
export interface MeshPolicy<TMesh> {
	clone(meshes: TMesh[]): TMesh[];
	release(meshes: TMesh[]): void;
}

export interface SolveMemoOptions<TMesh> {
	/**
	 * Entry cap (entries, not bytes). Solve results can be large, so the default is
	 * deliberately small — this targets the tight slider-scrub loop, not a durable cache.
	 */
	max?: number;
	/** Mesh ownership policy. Pass one whenever results carry meshes a consumer disposes. */
	meshPolicy?: MeshPolicy<TMesh>;
}

export interface SolveMemo<TMesh = unknown> {
	/** Returns a previously stored result for these inputs, or undefined on a miss. */
	get(values: Record<string, unknown>): SolveResult<TMesh> | undefined;
	/** Records a completed solve result under its input key (evicting the LRU tail). */
	set(values: Record<string, unknown>, result: SolveResult<TMesh>): void;
	/** Drops every entry — called when the active definition changes. */
	clear(): void;
}

/**
 * A bounded LRU memo. Re-reading an entry refreshes its recency (Map insertion-order LRU).
 */
export function createSolveMemo<TMesh = unknown>(
	options: SolveMemoOptions<TMesh> = {}
): SolveMemo<TMesh> {
	const { max = 16, meshPolicy } = options;
	const entries = new Map<string, SolveResult<TMesh>>();

	function release(result: SolveResult<TMesh>): void {
		if (result.meshes?.length) meshPolicy?.release(result.meshes);
	}

	/** A copy the recipient owns, or the original when no policy governs ownership. */
	function copy(result: SolveResult<TMesh>): SolveResult<TMesh> {
		if (!meshPolicy || !result.meshes?.length) return result;
		return { ...result, meshes: meshPolicy.clone(result.meshes) };
	}

	/** Drop an entry and release its resources. No-op when the key is absent. */
	function evict(key: string): void {
		const entry = entries.get(key);
		if (entry === undefined) return;
		entries.delete(key);
		release(entry);
	}

	return {
		get(values) {
			const key = stableInputKey(values);
			const hit = entries.get(key);
			if (hit === undefined) return undefined;
			// Refresh recency: re-insert at the tail.
			entries.delete(key);
			entries.set(key, hit);
			// A memo hit skips the transport entirely, so no other log line fires —
			// this line is the only trace it wasn't a fresh solve.
			console.info(`[Solve/memo] HIT — served from client memo (${entries.size}/${max})`);
			// Copy on the way out: the consumer disposes what it renders, so the retained
			// entry must never be the instance handed to it (audit C1).
			return copy(hit);
		},
		set(values, result) {
			const key = stableInputKey(values);
			// Overwriting a key strands the old value's resources unless it's released first.
			evict(key);
			// Store a private copy for the same reason `get` copies: the caller reports this
			// same object onward, and its consumer may dispose it.
			entries.set(key, copy(result));
			while (entries.size > max) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				evict(oldest);
				console.info(`[Solve/memo] evicted LRU entry (cap ${max})`);
			}
		},
		clear() {
			if (entries.size > 0) {
				console.info(`[Solve/memo] cleared ${entries.size} entries (definition changed)`);
			}
			entries.forEach(release);
			entries.clear();
		}
	};
}
