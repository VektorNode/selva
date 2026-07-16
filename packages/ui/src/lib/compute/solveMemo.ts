// Client-side solve result memo (M2). A small LRU keyed on a stable serialization of
// the solve INPUTS, sitting in front of the request/response driver. Dragging a slider
// back to a value already solved this session returns instantly without a network
// round-trip — killing slider-scrub storms before they leave the browser. It pairs with
// the throttle's latest-wins abort: the memo only serves values that fully solved, so a
// hit is always a complete result.
//
// GPU ownership (audit C1): a SolveResult carries live three.js objects, and the viewer
// takes ownership of every mesh array it renders — `updateScene` disposes the previous
// content on the next update. So the memo can neither hand out its own instances (they'd
// be disposed under it, then re-added dead on the next hit) nor drop entries silently
// (their GPU buffers would leak). It therefore keeps private copies, serves a fresh clone
// per hit, and disposes an entry whenever it leaves the map.

import * as THREE from 'three';
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

/**
 * Deep-clone a solve's scene objects so the caller owns them outright.
 *
 * `Object3D.clone()` copies the transform hierarchy but SHARES `geometry` and `material`
 * by reference — which is exactly the aliasing that makes a naive clone useless here, so
 * geometry is copied explicitly. Materials are deliberately left shared: the viewer's
 * `clearScene` skips disposing anything in its SHARED_MATERIALS set (module-scope
 * singletons reused across solves), and per-mesh materials are cheap to recreate but
 * expensive to re-compile as new shader programs.
 */
function cloneSceneObjects(meshes: THREE.Object3D[]): THREE.Object3D[] {
	return meshes.map((root) => {
		const copy = root.clone(true);
		const sources: THREE.Object3D[] = [];
		root.traverse((child) => sources.push(child));
		let i = 0;
		copy.traverse((child) => {
			const source = sources[i++] as Partial<THREE.Mesh> & THREE.Object3D;
			const target = child as Partial<THREE.Mesh> & THREE.Object3D;
			if (source.geometry) target.geometry = source.geometry.clone();
		});
		return copy;
	});
}

/**
 * Release an entry's GPU buffers. Mirrors `clearScene`'s traversal, minus materials —
 * the memo never owns those (see {@link cloneSceneObjects}), so disposing one here would
 * free a singleton still referenced by live scene content.
 */
function disposeSceneObjects(result: SolveResult): void {
	result.meshes?.forEach((root: THREE.Object3D) =>
		root.traverse((child) => {
			(child as Partial<THREE.Mesh>).geometry?.dispose();
		})
	);
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

	/** Drop an entry and release its GPU buffers. No-op when the key is absent. */
	function evict(key: string): void {
		const entry = entries.get(key);
		if (entry === undefined) return;
		entries.delete(key);
		disposeSceneObjects(entry);
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
			// this debug line is the only trace it wasn't a fresh solve.
			console.debug(`[Compute/memo] HIT — served from client memo (${entries.size}/${max})`);
			// Clone on the way out: the viewer disposes what it renders, so the retained
			// entry must never be the instance handed to it (audit C1).
			if (!hit.meshes?.length) return hit;
			return { ...hit, meshes: cloneSceneObjects(hit.meshes) };
		},
		set(values, result) {
			const key = stableInputKey(values);
			// Overwriting a key strands the old value's buffers unless it's disposed first.
			evict(key);
			// Store a private copy for the same reason `get` clones: the caller reports this
			// same object to the viewer, which will dispose it on the next scene update.
			entries.set(
				key,
				result.meshes?.length ? { ...result, meshes: cloneSceneObjects(result.meshes) } : result
			);
			while (entries.size > max) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				evict(oldest);
				console.debug(`[Compute/memo] evicted LRU entry (cap ${max})`);
			}
		},
		clear() {
			if (entries.size > 0) {
				console.debug(`[Compute/memo] cleared ${entries.size} entries (definition changed)`);
			}
			entries.forEach(disposeSceneObjects);
			entries.clear();
		}
	};
}
