// A small LRU keyed on a stable serialization of the solve inputs, sitting in front of the
// request/response driver: re-solving inputs already seen this session (e.g. dragging a
// slider back) returns instantly instead of round-tripping. A hit is always a complete
// result, since only fully-solved values are ever stored.
//
// A SolveResult can carry live renderer objects, and a viewer typically takes ownership of
// every mesh array it renders — disposing the previous content on the next update. So the
// memo can neither hand out its own instances (they'd be disposed under it, then re-added
// dead on the next hit) nor drop entries silently (their GPU buffers would leak). It
// therefore keeps private copies, serves a fresh copy per hit, and releases an entry
// whenever it leaves the map — but it does not know what a mesh is: `TMesh` is opaque and
// the clone/release policy is injected, which keeps `three` out of this package entirely.

import type { SolveResult } from '../shared/solve-fn.js';

/**
 * Deterministic string key for a set of input values. Object keys are sorted at every
 * level so two logically-equal inputs (built in different key order) collide, matching the
 * server's stable-input keying intent. Values are plain JSON — the projected solve inputs
 * never contain functions or cycles.
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
 * Omit for mesh-free results, or for meshes no consumer takes ownership of: the memo then
 * stores and serves them by reference, which is correct precisely because nothing frees
 * them behind its back.
 *
 * @property clone - Called on the way in AND on every hit, so neither the stored entry nor
 *   a previously served one can be disposed by the other's owner.
 * @property release - Must NOT free anything shared with live content — see
 *   `releaseSceneObjects` in `@selvajs/visualization/parse`, which skips materials for
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
	meshPolicy?: MeshPolicy<TMesh>;
}

export interface SolveMemo<TMesh = unknown> {
	get(values: Record<string, unknown>): SolveResult<TMesh> | undefined;
	/** Evicts the LRU tail if `set` pushes the map past its cap. */
	set(values: Record<string, unknown>, result: SolveResult<TMesh>): void;
	clear(): void;
}

export function createSolveMemo<TMesh = unknown>(
	options: SolveMemoOptions<TMesh> = {}
): SolveMemo<TMesh> {
	const { max = 16, meshPolicy } = options;
	const entries = new Map<string, SolveResult<TMesh>>();

	function release(result: SolveResult<TMesh>): void {
		if (result.meshes?.length) meshPolicy?.release(result.meshes);
	}

	function copy(result: SolveResult<TMesh>): SolveResult<TMesh> {
		if (!meshPolicy || !result.meshes?.length) return result;
		return { ...result, meshes: meshPolicy.clone(result.meshes) };
	}

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
			// The consumer disposes what it renders, so the retained entry must never be
			// the same instance handed out twice.
			return copy(hit);
		},
		set(values, result) {
			const key = stableInputKey(values);
			// Overwriting a key strands the old value's resources unless it's released first.
			evict(key);
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
