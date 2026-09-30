// ============================================================================
// Which parts of a merged mesh draw, and with what material
// ============================================================================
//
// A merged mesh draws many source members in one call. Two features draw only part of it: hiding
// a member (`scene/`) and tinting the selected member (`render/`). Both need geometry groups, and
// three honours groups only when `material` is an array: with a single material it draws the whole
// index range and ignores them. So one owner builds the groups and the material array from both
// states together. Two writers each replacing the groups would undo each other.
//
// Members are addressed by their index in `userData.members`, which carries each member's window
// into the index buffer (`finalizeMergedMesh`).

import type * as THREE from 'three';

interface MemberWindow {
	indexStart?: number;
	indexCount?: number;
}

interface DrawState {
	/** The mesh's own material, restored once nothing is hidden or highlighted. */
	base: THREE.Material;
	hidden: ReadonlySet<number>;
	highlight: { index: number; material: THREE.Material } | null;
}

const states = new WeakMap<THREE.Mesh, DrawState>();
const listeners = new WeakMap<THREE.Mesh, Set<() => void>>();

const NONE: ReadonlySet<number> = new Set();

function windowsOf(mesh: THREE.Mesh): Required<MemberWindow>[] | null {
	const members = mesh.userData?.members as MemberWindow[] | undefined;
	if (!Array.isArray(members) || members.length === 0) return null;
	// One member without a window means the ranges can't be rebuilt without dropping geometry.
	if (members.some((m) => m.indexStart == null || m.indexCount == null)) return null;
	return members as Required<MemberWindow>[];
}

function stateOf(mesh: THREE.Mesh): DrawState {
	let state = states.get(mesh);
	if (!state) {
		const base = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
		state = { base, hidden: NONE, highlight: null };
		states.set(mesh, state);
	}
	return state;
}

function rebuild(mesh: THREE.Mesh, windows: Required<MemberWindow>[], state: DrawState): void {
	const { geometry } = mesh;
	geometry.clearGroups();

	if (state.hidden.size === 0 && !state.highlight) {
		mesh.material = state.base;
		states.delete(mesh);
		return;
	}

	// Coalesce neighbours with the same material, so hiding one member costs two draws, not N.
	let runStart = -1;
	let runEnd = 0;
	let runMaterial = 0;
	const flush = () => {
		if (runStart >= 0) geometry.addGroup(runStart, runEnd - runStart, runMaterial);
		runStart = -1;
	};
	for (let i = 0; i < windows.length; i++) {
		if (state.hidden.has(i)) {
			flush();
			continue;
		}
		const { indexStart, indexCount } = windows[i]!;
		const material = state.highlight?.index === i ? 1 : 0;
		if (runStart < 0 || material !== runMaterial || indexStart !== runEnd) {
			flush();
			runStart = indexStart;
			runMaterial = material;
		}
		runEnd = indexStart + indexCount;
	}
	flush();

	mesh.material = state.highlight ? [state.base, state.highlight.material] : [state.base];
}

function update(mesh: THREE.Mesh, change: (state: DrawState) => void): void {
	const windows = windowsOf(mesh);
	if (!windows) return;
	const state = stateOf(mesh);
	change(state);
	rebuild(mesh, windows, state);
	listeners.get(mesh)?.forEach((listener) => listener());
}

/** Members of `mesh` not drawn, by index into `userData.members`. */
export function getHiddenMembers(mesh: THREE.Mesh): ReadonlySet<number> {
	return states.get(mesh)?.hidden ?? NONE;
}

export function setHiddenMembers(mesh: THREE.Mesh, hidden: ReadonlySet<number>): void {
	const current = getHiddenMembers(mesh);
	if (current.size === hidden.size && [...hidden].every((i) => current.has(i))) return;
	update(mesh, (state) => {
		state.hidden = new Set(hidden);
	});
}

/** The material `mesh` draws with when nothing is highlighted. */
export function getBaseMaterial(mesh: THREE.Mesh): THREE.Material {
	return (
		states.get(mesh)?.base ?? (Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material)
	);
}

/** Draws member `index` with `material`. The caller owns `material` and disposes it. */
export function setMemberHighlight(
	mesh: THREE.Mesh,
	index: number,
	material: THREE.Material
): void {
	update(mesh, (state) => {
		state.highlight = { index, material };
	});
}

export function clearMemberHighlight(mesh: THREE.Mesh): void {
	if (!states.get(mesh)?.highlight) return;
	update(mesh, (state) => {
		state.highlight = null;
	});
}

/** Calls `listener` after the hidden set or highlight of `mesh` changes. Returns an unsubscribe. */
export function onMemberDrawChange(mesh: THREE.Mesh, listener: () => void): () => void {
	let set = listeners.get(mesh);
	if (!set) listeners.set(mesh, (set = new Set()));
	set.add(listener);
	return () => set.delete(listener);
}
