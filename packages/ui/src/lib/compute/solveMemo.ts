// Client-side solve result memo (M2). A small LRU keyed on a stable serialization of
// the solve INPUTS, sitting in front of the request/response driver. Dragging a slider
// back to a value already solved this session returns instantly without a network
// round-trip — killing slider-scrub storms before they leave the browser. It pairs with
// the throttle's latest-wins abort: the memo only serves values that fully solved, so a
// hit is always a complete result.

import type { SolveResult } from '../types/solveFn';

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

export interface SolveMemo {
	/** Returns a previously stored result for these inputs, or undefined on a miss. */
	get(values: Record<string, unknown>): SolveResult | undefined;
	/** Records a completed solve result under its input key (evicting the LRU tail). */
	set(values: Record<string, unknown>, result: SolveResult): void;
	/** Drops every entry — called when the active definition changes. */
	clear(): void;
}

/**
 * A bounded LRU memo. `max` caps entries (not bytes); solve results can be large, so the
 * default is deliberately small — this targets the tight slider-scrub loop, not a durable
 * cache. Re-reading an entry refreshes its recency (Map insertion-order LRU).
 */
export function createSolveMemo(max = 16): SolveMemo {
	const entries = new Map<string, SolveResult>();

	return {
		get(values) {
			const key = stableInputKey(values);
			const hit = entries.get(key);
			if (hit === undefined) return undefined;
			// Refresh recency: re-insert at the tail.
			entries.delete(key);
			entries.set(key, hit);
			return hit;
		},
		set(values, result) {
			const key = stableInputKey(values);
			entries.delete(key);
			entries.set(key, result);
			while (entries.size > max) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
		},
		clear() {
			entries.clear();
		}
	};
}
