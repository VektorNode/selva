import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneOutliner } from '../outliner.js';

const CLICK = { shiftKey: false, toggleKey: false };
const CTRL = { shiftKey: false, toggleKey: true };
const SHIFT = { shiftKey: true, toggleKey: false };

function sceneWith(...specs: Record<string, unknown>[]) {
	const scene = new THREE.Scene();
	const objects = specs.map((data) => {
		const mesh = new THREE.Mesh();
		mesh.userData = data;
		scene.add(mesh);
		return mesh;
	});
	return { scene, objects };
}

describe('createSceneOutliner', () => {
	it('lists content and skips viewer aids', () => {
		const { scene, objects } = sceneWith({ name: 'A' }, { id: 'grid' });
		const outliner = createSceneOutliner(scene);

		expect(outliner.objects()).toEqual([objects[0]]);
	});

	it('reflects scene changes on the next read', () => {
		const { scene } = sceneWith({ name: 'A' });
		const outliner = createSceneOutliner(scene);
		expect(outliner.objects()).toHaveLength(1);

		scene.add(new THREE.Mesh());

		expect(outliner.objects()).toHaveLength(2);
	});

	it('groups by layer and applies the search query', () => {
		const { scene } = sceneWith(
			{ layer: 'Walls', name: 'north' },
			{ layer: 'Roof', name: 'ridge' }
		);
		const outliner = createSceneOutliner(scene);

		expect(outliner.layerGroups().size).toBe(2);

		expect([...outliner.layerGroups('ridge').keys()]).toEqual(['Roof']);
	});

	// Hiding one layer used to strike through every other layer in the panel, because meshes that
	// carried a component id but no index all resolved to one hidden-set key.
	it('hides only the toggled layer when meshes carry no original index', () => {
		const { scene } = sceneWith(
			{ sourceComponentId: 'gh-1', layer: 'IfcWall', name: 'w0' },
			{ sourceComponentId: 'gh-1', layer: 'IfcWall', name: 'w1' },
			{ sourceComponentId: 'gh-1', layer: 'IfcSlab', name: 's0' },
			{ sourceComponentId: 'gh-1', layer: 'IfcDoor', name: 'd0' }
		);
		const outliner = createSceneOutliner(scene);
		const groups = outliner.layerGroups();

		outliner.visibility.toggleLayer(groups.get('IfcWall')!);

		expect(outliner.visibility.isLayerHidden(groups.get('IfcWall')!)).toBe(true);
		for (const other of ['IfcSlab', 'IfcDoor']) {
			expect(outliner.visibility.isLayerHidden(groups.get(other)!)).toBe(false);
			expect(outliner.visibility.isLayerPartial(groups.get(other)!)).toBe(false);
		}
	});

	describe('collapse', () => {
		it('toggles a layer open and shut', () => {
			const { scene } = sceneWith({ layer: 'Walls' });
			const outliner = createSceneOutliner(scene);

			expect(outliner.isCollapsed('Walls')).toBe(false);
			outliner.toggleCollapsed('Walls');
			expect(outliner.isCollapsed('Walls')).toBe(true);
			outliner.toggleCollapsed('Walls');
			expect(outliner.isCollapsed('Walls')).toBe(false);
		});
	});

	describe('flatVisibleUuids', () => {
		it('lists objects of expanded layers in display order', () => {
			const { scene, objects } = sceneWith(
				{ layer: 'Walls', name: 'a' },
				{ layer: 'Roof', name: 'b' }
			);
			const outliner = createSceneOutliner(scene);

			expect(outliner.flatVisibleUuids()).toEqual([objects[0].uuid, objects[1].uuid]);
		});

		it('omits collapsed layers', () => {
			const { scene, objects } = sceneWith(
				{ layer: 'Walls', name: 'a' },
				{ layer: 'Roof', name: 'b' }
			);
			const outliner = createSceneOutliner(scene);

			outliner.toggleCollapsed('Walls');

			expect(outliner.flatVisibleUuids()).toEqual([objects[1].uuid]);
		});

		it('omits objects filtered out by the search', () => {
			const { scene, objects } = sceneWith({ name: 'north' }, { name: 'ridge' });
			const outliner = createSceneOutliner(scene);

			expect(outliner.flatVisibleUuids('ridge')).toEqual([objects[1].uuid]);
		});
	});

	describe('toggleObject', () => {
		it('flips a single object', () => {
			const { scene, objects } = sceneWith({ name: 'A' });
			const outliner = createSceneOutliner(scene);

			outliner.toggleObject(objects[0]);
			expect(objects[0].visible).toBe(false);

			outliner.toggleObject(objects[0]);
			expect(objects[0].visible).toBe(true);
		});

		it('hides the whole multi-selection when one of its members is toggled', () => {
			const { scene, objects } = sceneWith({ name: 'a' }, { name: 'b' }, { name: 'c' });
			const outliner = createSceneOutliner(scene);
			outliner.select(objects[0].uuid, CLICK);
			outliner.select(objects[1].uuid, CTRL);

			outliner.toggleObject(objects[0]);

			expect(objects[0].visible).toBe(false);
			expect(objects[1].visible).toBe(false);
			// Not selected, so untouched.
			expect(objects[2].visible).toBe(true);
		});

		it('shows a multi-selection again only once all of it is hidden', () => {
			const { scene, objects } = sceneWith({ name: 'a' }, { name: 'b' });
			const outliner = createSceneOutliner(scene);
			outliner.select(objects[0].uuid, CLICK);
			outliner.select(objects[1].uuid, CTRL);

			outliner.toggleObject(objects[0]);
			outliner.toggleObject(objects[0]);

			expect(objects.every((o) => o.visible)).toBe(true);
		});

		it('ignores the selection when only one object is selected', () => {
			const { scene, objects } = sceneWith({ name: 'a' }, { name: 'b' });
			const outliner = createSceneOutliner(scene);
			outliner.select(objects[0].uuid, CLICK);

			outliner.toggleObject(objects[1]);

			expect(objects[0].visible).toBe(true);
			expect(objects[1].visible).toBe(false);
		});
	});

	it('resolves a shift-range against the visible flat order', () => {
		const { scene, objects } = sceneWith(
			{ layer: 'L', name: 'a' },
			{ layer: 'L', name: 'b' },
			{ layer: 'L', name: 'c' }
		);
		const outliner = createSceneOutliner(scene);

		outliner.select(objects[0].uuid, CLICK);
		outliner.select(objects[2].uuid, SHIFT);

		expect(outliner.selection.selected.size).toBe(3);
	});

	it('confines a shift-range to objects surviving the search filter', () => {
		const { scene, objects } = sceneWith(
			{ layer: 'L', name: 'keep-a' },
			{ layer: 'L', name: 'drop' },
			{ layer: 'L', name: 'keep-b' }
		);
		const outliner = createSceneOutliner(scene);

		outliner.select(objects[0].uuid, CLICK, 'keep');
		outliner.select(objects[2].uuid, SHIFT, 'keep');

		expect([...outliner.selection.selected]).toEqual([objects[0].uuid, objects[2].uuid]);
	});

	it('reset drops hidden and selected state', () => {
		const { scene, objects } = sceneWith({ name: 'a' });
		const outliner = createSceneOutliner(scene);
		outliner.select(objects[0].uuid, CLICK);
		outliner.toggleObject(objects[0]);

		outliner.reset();

		expect(outliner.visibility.hidden.size).toBe(0);
		expect(outliner.selection.selected.size).toBe(0);
		expect(outliner.selection.anchor).toBeNull();
	});

	describe('applyTo', () => {
		// What a solve does: discard every object, rebuild from the same Grasshopper sources.
		const resolve = (scene: THREE.Scene, specs: Record<string, unknown>[]) => {
			scene.clear();
			return specs.map((data) => {
				const mesh = new THREE.Mesh();
				mesh.userData = data;
				scene.add(mesh);
				return mesh;
			});
		};

		it('keeps an object hidden across a solve', () => {
			const spec = { sourceComponentId: 'gh-1', originalIndex: 0, name: 'wall' };
			const { scene, objects } = sceneWith(spec);
			const outliner = createSceneOutliner(scene);
			outliner.toggleObject(objects[0]);

			const [rebuilt] = resolve(scene, [spec]);
			outliner.applyTo();

			expect(rebuilt.visible).toBe(false);
			expect(outliner.visibility.isHidden(rebuilt)).toBe(true);
		});

		it('leaves everything else visible', () => {
			const hiddenSpec = { sourceComponentId: 'gh-1', originalIndex: 0 };
			const otherSpec = { sourceComponentId: 'gh-1', originalIndex: 1 };
			const { scene, objects } = sceneWith(hiddenSpec, otherSpec);
			const outliner = createSceneOutliner(scene);
			outliner.toggleObject(objects[0]);

			const rebuilt = resolve(scene, [hiddenSpec, otherSpec]);
			outliner.applyTo();

			expect(rebuilt[0].visible).toBe(false);
			expect(rebuilt[1].visible).toBe(true);
		});

		it('clears the selection, which refers to discarded instances', () => {
			const spec = { sourceComponentId: 'gh-1', originalIndex: 0 };
			const { scene, objects } = sceneWith(spec);
			const outliner = createSceneOutliner(scene);
			outliner.select(objects[0].uuid, CLICK);

			resolve(scene, [spec]);
			outliner.applyTo();

			expect(outliner.selection.selected.size).toBe(0);
			expect(outliner.selection.anchor).toBeNull();
		});
	});

	it('reports anchor moves to subscribers until they unsubscribe', () => {
		const { scene, objects } = sceneWith({ name: 'a' });
		const outliner = createSceneOutliner(scene);
		const seen: (string | null)[] = [];

		const unsubscribe = outliner.onAnchorChange((next) => seen.push(next));
		outliner.select(objects[0].uuid, CLICK);
		unsubscribe();
		outliner.selection.clear();

		expect(seen).toEqual([objects[0].uuid]);
	});

	it('uses caller-supplied sets so a host can observe mutations', () => {
		const hidden = new Set<string>();
		const selected = new Set<string>();
		const collapsed = new Set<string>();
		const { scene, objects } = sceneWith({ layer: 'Walls', name: 'a' });
		const outliner = createSceneOutliner(scene, { sets: { hidden, selected, collapsed } });

		outliner.toggleObject(objects[0]);
		outliner.select(objects[0].uuid, CLICK);
		outliner.toggleCollapsed('Walls');

		// `hidden` is keyed by stable identity, not uuid — hence size rather than a uuid lookup.
		expect(hidden.size).toBe(1);
		expect(selected.has(objects[0].uuid)).toBe(true);
		expect(collapsed.has('Walls')).toBe(true);
	});
});
