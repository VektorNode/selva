/**
 * Demo: an object-list panel, the way a real app builds one.
 *
 * `createSceneOutliner` is the brain of an outliner: it reads a live scene and tells you what the
 * content is, how it groups into layers, what is hidden and what is selected. It renders nothing —
 * that is this file's job, and it is deliberately plain DOM so the wiring stays visible.
 *
 * The four things a host has to get right, all shown below:
 *
 *   1. Render `outliner.layerGroups(query)`      — the grouped, search-filtered content
 *   2. Forward clicks to `outliner.select(...)`  — with the shift/toggle modifiers
 *   3. Toggle with `outliner.toggleObject(...)`  — follows a multi-selection
 *   4. Call `outliner.applyTo()` after a solve   — or everything hidden comes back visible
 */
import * as THREE from 'three';

import { createPlayground } from '../shared/playground';
import { updateScene } from '@/render/index.js';
import { getThreeObjectsFromComputeResponse } from '@/parse/index.js';
import { createSceneOutliner, getObjectLabel, getTypeLabel } from '@/scene/index.js';

import responseUrl from '../shared/samples/compute-response.json?url';

const pg = createPlayground({
	title: 'Outliner — Scene Layer',
	axes: false,
	viewer: {
		grid: { enabled: true },
		edges: { enabled: true },
		events: {
			// Clicking in the 3D view drives the same selection state the panel reads, so the two stay
			// in sync for free — the outliner is the single source of truth.
			onObjectSelected: (object) => {
				outliner.select(object.uuid, { shiftKey: false, toggleKey: false });
				renderOutliner();
			},
			onBackgroundClicked: () => {
				outliner.selection.clear();
				renderOutliner();
			}
		}
	}
});

const { viewer } = pg;

// ============================================================================
// THE OUTLINER
// ============================================================================
// One outliner per scene, created once and kept. It holds the hidden/selected state, so rebuilding
// it on every solve would throw that state away.
//
// Its state is three plain Sets. A framework app passes its own observable sets here (`SvelteSet`
// in Svelte) so mutating them re-renders the UI. This demo is plain DOM, so it takes the defaults
// and calls `renderOutliner()` by hand after every mutation.

const outliner = createSceneOutliner(viewer.scene);

let searchQuery = '';

// ============================================================================
// RENDERING THE PANEL
// ============================================================================

const panel = document.createElement('div');
panel.className = 'outliner';

function renderOutliner() {
	// Pass the SAME query to layerGroups and select. Search is a parameter rather than outliner
	// state, so a shift-range resolves against exactly the rows the user can see.
	const groups = outliner.layerGroups(searchQuery);
	panel.replaceChildren();

	if (groups.size === 0) {
		panel.textContent = searchQuery ? `No objects match "${searchQuery}".` : 'Scene is empty.';
		return;
	}

	for (const [layerName, objects] of groups) {
		const group = document.createElement('details');
		group.className = 'outliner-layer';
		group.open = !outliner.isCollapsed(layerName);
		group.addEventListener('toggle', () => {
			if (group.open === outliner.isCollapsed(layerName)) outliner.toggleCollapsed(layerName);
		});

		const summary = document.createElement('summary');
		const layerHidden = outliner.visibility.isLayerHidden(objects);
		const layerPartial = outliner.visibility.isLayerPartial(objects);
		summary.textContent =
			`${layerName || 'Default'} (${objects.length})` +
			(layerPartial ? ' ◐' : layerHidden ? ' ○' : '');
		// Double-click a layer to hide or show all of it at once.
		summary.addEventListener('dblclick', (event) => {
			event.preventDefault();
			outliner.visibility.toggleLayer(objects);
			renderOutliner();
		});
		group.appendChild(summary);

		for (const object of objects) group.appendChild(renderRow(object));
		panel.appendChild(group);
	}
}

function renderRow(object: THREE.Object3D): HTMLElement {
	const row = document.createElement('div');
	row.className = 'outliner-row';

	const hidden = outliner.visibility.isHidden(object);
	if (hidden) row.classList.add('hidden-row');
	if (outliner.selection.isSelected(object.uuid)) row.classList.add('selected');

	const eye = document.createElement('span');
	eye.className = 'eye';
	eye.textContent = hidden ? '○' : '●';
	// Toggling one object of a multi-selection toggles the whole selection — that's what
	// `toggleObject` adds over `visibility.setVisible`.
	eye.addEventListener('click', (event) => {
		event.stopPropagation();
		outliner.toggleObject(object);
		renderOutliner();
	});

	const name = document.createElement('span');
	name.className = 'name';
	name.textContent = getObjectLabel(object);
	name.title = `${getObjectLabel(object)} — ${getTypeLabel(object)}`;

	// Modifiers are `{ shiftKey, toggleKey }`; the host normalizes ctrl (Win/Linux) vs meta (macOS).
	row.addEventListener('click', (event) => {
		outliner.select(
			object.uuid,
			{ shiftKey: event.shiftKey, toggleKey: event.ctrlKey || event.metaKey },
			searchQuery
		);
		renderOutliner();
		pg.setStatus(`${outliner.selection.selected.size} selected.`);
	});

	row.append(eye, name);
	return row;
}

// ============================================================================
// LOADING A SOLVE
// ============================================================================

let cameraPlaced = false;

async function loadResponse() {
	pg.setStatus('Solving…');

	type ComputeResponse = Parameters<typeof getThreeObjectsFromComputeResponse>[0];
	const response: ComputeResponse = await fetch(responseUrl).then((r) => r.json());
	const objects = await getThreeObjectsFromComputeResponse(response);

	updateScene(viewer.scene, objects, viewer.camera, viewer.controls, cameraPlaced);
	cameraPlaced = true;
	viewer.applyEdges(viewer.scene);

	// THE IMPORTANT LINE. A solve throws away all content and rebuilds it, so whatever the user hid
	// would come back visible. `applyTo` re-applies the hidden state to the new objects — it works
	// because that state is keyed by a stable tracking key, not by uuid, which is fresh every solve.
	// Selection is dropped: it pointed at objects that no longer exist.
	outliner.applyTo();

	renderOutliner();
	pg.setStatus(`${objects.length} objects. Click a row to select, the dot to hide.`);
}

/** Extra geometry on named layers, so grouping and search have something to chew on. */
function addSampleLayers() {
	const specs = [
		{ layer: 'Walls', color: 0x9a8f80, count: 3 },
		{ layer: 'Slabs', color: 0x6f7d8c, count: 2 },
		{ layer: 'Furniture', color: 0x8c6f6f, count: 4 }
	];

	const objects: THREE.Object3D[] = [];
	for (const spec of specs) {
		for (let i = 0; i < spec.count; i++) {
			const mesh = new THREE.Mesh(
				new THREE.BoxGeometry(1 + Math.random(), 1 + Math.random(), 0.5 + Math.random()),
				new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.6 })
			);
			mesh.name = `${spec.layer.slice(0, -1)}_${i + 1}`;
			mesh.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 0.5);
			// The outliner groups by the Grasshopper layer name the parser writes here.
			mesh.userData.layer = spec.layer;
			objects.push(mesh);
		}
	}

	pg.addObjects(objects);
	outliner.applyTo();
	renderOutliner();
	requestAnimationFrame(() => viewer.fitToView());
	pg.setStatus(`Added ${objects.length} objects across ${specs.length} layers.`);
}

// ============================================================================
// SIDEBAR
// ============================================================================

pg.addSection('Content');
pg.addButton('Load compute response', () => void loadResponse());
pg.addButton('Add sample layers', addSampleLayers);
pg.addButton('Clear scene', () => {
	pg.clearObjects();
	renderOutliner();
	pg.setStatus('Scene cleared.');
});

pg.addSection('Outliner');
const search = document.createElement('input');
search.type = 'search';
search.placeholder = 'Search objects and layers…';
search.className = 'outliner-search';
search.addEventListener('input', () => {
	searchQuery = search.value;
	renderOutliner();
});
pg.sidebar.appendChild(search);
pg.sidebar.appendChild(panel);

pg.addButton('Show everything', () => {
	outliner.reset();
	outliner.applyTo();
	renderOutliner();
});

addSampleLayers();
