// LRU cache of solve results keyed on a stable serialization of the inputs, so re-solving
// something already seen this session (e.g. dragging a slider back) returns instantly
// instead of round-tripping.
//
// A viewer typically takes ownership of every mesh it renders, disposing the previous
// content on the next update. So the memo can't hand out its own stored instances (they'd
// get disposed under it) or drop entries silently (their GPU buffers would leak): it keeps
// private copies via an injected clone/release policy, which also keeps `three` out of this
// package — `TMesh` stays opaque here.

import type { SolveResult } from '../shared/solve-fn.js';

/**
 * Deterministic string key for a set of input values. Sorts object keys at every level so
 * two logically-equal inputs built in different key order collide. Otherwise matches what
 * `JSON.stringify` sends: `toJSON` is honoured and an `undefined` property is absent, which a
 * server treats differently from `null`.
 *
 * Throws on a `bigint`, as `JSON.stringify` does.
 */
export function stableInputKey(input: unknown): string {
	const hasToJSON =
		input !== null &&
		typeof input === 'object' &&
		typeof (input as { toJSON?: unknown }).toJSON === 'function';
	const value = hasToJSON ? (input as { toJSON(): unknown }).toJSON() : input;

	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableInputKey).join(',')}]`;
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableInputKey(obj[k])}`).join(',')}}`;
}

/**
 * Omit when results are mesh-free or nothing takes ownership of the meshes — the memo then
 * stores and serves them by reference, which is safe only because nothing frees them behind
 * its back.
 */
export interface MeshPolicy<TMesh> {
	/** Called on the way in and on every hit, so the stored entry and a served copy are never the same instance. */
	clone(meshes: TMesh[]): TMesh[];
	/** Must not free anything shared with live content (e.g. materials another object still uses). */
	release(meshes: TMesh[]): void;
}

export interface SolveMemoOptions<TMesh> {
	/** Entry cap, not a byte cap. Kept small on purpose: this targets the slider-scrub loop, not a durable cache. */
	max?: number;
	meshPolicy?: MeshPolicy<TMesh>;
}

export interface SolveMemo<TMesh = unknown> {
	get(values: Record<string, unknown>): SolveResult<TMesh> | undefined;
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
			entries.delete(key);
			entries.set(key, hit);
			// eslint-disable-next-line no-console -- fires per frame during a slider scrub
			console.debug(`[Solve/memo] HIT — served from client memo (${entries.size}/${max})`);
			return copy(hit);
		},
		set(values, result) {
			const key = stableInputKey(values);
			evict(key);
			entries.set(key, copy(result));
			for (const oldest of entries.keys()) {
				if (entries.size <= max) break;
				evict(oldest);
			}
		},
		clear() {
			entries.forEach(release);
			entries.clear();
		}
	};
}
