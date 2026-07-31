/**
 * Demo: load a Selva `.dmf` (Display Mesh File) through the EXACT pipeline the Selva app uses, so
 * the look/materials can be verified and debugged 1:1 with production.
 *
 * A `.dmf` is a saved `DisplayBatch`: a small JSON sidecar header followed by the raw SLVA/SLVZ mesh
 * blob. This demo strips the header and runs the blob through the same two calls Selva's viewer makes:
 *
 *   1. Parse — `parseMeshBatchBlob(blob, { mergeByMaterial: false })`, the
 *      options from plugin-ui's `websocket-solve-driver`. No `material` appearance override: Selva
 *      applies the look at the initThree/setLook level, never at parse time.
 *   2. Place — `updateScene(scene, meshes, camera, controls, initialPositionSet)`, the same call
 *      `Viewer.svelte` makes each solve. It clears prior content, adds the meshes, fits the camera
 *      frustum (near/far) to the part, and frames it — so a GH part sitting thousands of mm off the
 *      origin lands and frames exactly as it does in Selva, with no demo-specific recenter/fit hack.
 *
 * The viewer itself is constructed with Selva's exact `initThree` options (see `SELVA_VIEWER_OPTIONS`
 * below, copied from `Viewer.svelte`): the 'technical' look, sun/shadows off (flat ambient + baseHDR
 * image-based lighting carry it), the #E6E6E6 background, and crease edges on by default. What you
 * see here is what Selva renders.
 */
import * as THREE from 'three';

import { createPlayground } from '../shared/playground';
import { parseMeshBatchBlob } from '@/parse/index.js';
import { updateScene, type ThreeInitializerOptions, type Look } from '@/render/index.js';

// Bundled sample DMFs, served by Vite via ?url.
import sampleSmallUrl from '../fixtures/test_file.dmf?url';
import sampleMeshUrl from '../fixtures/test_mesh.dmf?url';

// ============================================================================
// SELVA VIEWER CONFIG — copied verbatim from packages/ui Viewer.svelte onMount
// ============================================================================
// Only options that differ from the library defaults, exactly as Selva sets them: seed the
// 'technical' look, switch off the sun/shadows the technical look doesn't need (flat ambient + HDR
// image-based lighting carry it), and paint Selva's #E6E6E6 background. Grid + measure are the tools
// the Selva viewer builds. Keeping this in lockstep with Viewer.svelte is the whole point of the demo.
//
// HDR / image-based lighting is what carries the technical look with the sun off — the look is
// IBL-led (env map does the shading) with a little hemisphere fill and only a thin flat ambient. The
// plugin-ui viewer (Viewer.svelte) relies on initThree's DEFAULTS here (enableEnvironmentLighting:
// true, hdrPath: '/baseHDR.hdr') — it sets neither. Two gotchas we handle to match it exactly:
//   1. The shared playground shell defaults environment lighting OFF for demos that ship no HDR, so
//      we OPT IN explicitly — otherwise this demo renders flat (no IBL) and won't match.
//   2. The examples' own baseHDR.hdr is a DIFFERENT, smaller image than the app's, so pointing at
//      '/baseHDR.hdr' would give the wrong IBL. `pluginUiHDR.hdr` is a byte-exact copy of
//      packages/ui/static/baseHDR.hdr (the file Viewer.svelte loads), so the lighting matches.
const SELVA_BACKGROUND = '#E6E6E6';
const SELVA_VIEWER_OPTIONS: ThreeInitializerOptions = {
	look: 'technical',
	lighting: { enableSunlight: false },
	render: { enableShadows: false },
	environment: {
		backgroundColor: SELVA_BACKGROUND,
		enableEnvironmentLighting: true,
		hdrPath: '/pluginUiHDR.hdr'
	},
	grid: { enabled: true },
	measure: { enabled: true }
};

const pg = createPlayground({
	title: 'DMF — Selva Pipeline',
	axes: false,
	viewer: SELVA_VIEWER_OPTIONS
});

const { viewer } = pg;
// Dev convenience: expose the viewer + THREE so the demo can be driven from the console.
(window as unknown as { viewer: typeof viewer; THREE: typeof THREE }).viewer = viewer;
(window as unknown as { viewer: typeof viewer; THREE: typeof THREE }).THREE = THREE;

// Mirror of Viewer.svelte's `viewerInitialized`: false until the first non-empty load, so the first
// updateScene repositions the camera and later ones don't yank it around.
let viewerInitialized = false;
// Mirror of Viewer.svelte's `edgesVisible` (edges start on) so re-applying after a solve stays in sync.
let edgesVisible = true;
// Selva's render-style default; the Look select drives setLook the same way the Display submenu does.
let renderStyle: Look = 'technical';

const hint =
	'Load a .dmf to render it through the Selva pipeline.\n' +
	'Look / Edges below mirror Selva’s Display menu.';

// ── DMF blob extraction ─────────────────────────────────────────────────────
// DMF layout (little-endian): [4] magic "DMF1" | [4] version | [4] jsonLen | [jsonLen] sidecar JSON |
// [..] raw SLVA/SLVZ blob to end of file. See Plugin/Selva.GH/.../DmfFile.cs. We only need the blob;
// the sidecar (materials/groups) is also embedded in the blob's own metadata header, which is what
// parseMeshBatchBlob reads.
const DMF_MAGIC = 0x31464d44; // "DMF1" little-endian
const DMF_HEADER_PREAMBLE = 12; // magic(4) + version(4) + jsonLen(4)

function dmfBlob(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength < DMF_HEADER_PREAMBLE) throw new Error('File too small to be a DMF.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== DMF_MAGIC)
		throw new Error('Not a DMF file (bad magic — expected "DMF1").');
	const jsonLen = view.getUint32(8, true);
	const blobStart = DMF_HEADER_PREAMBLE + jsonLen;
	if (blobStart > bytes.byteLength)
		throw new Error('DMF header declares a sidecar past end of file.');
	return bytes.subarray(blobStart);
}

// ── Load through the Selva pipeline ──────────────────────────────────────────
async function loadDmfBytes(bytes: Uint8Array, name: string) {
	pg.setStatus(`Loading ${name}…`);
	try {
		// Step 1 — parse. Selva's exact options (plugin-ui websocket-solve-driver): un-merged meshes so
		// each part stays a distinct pickable object, transforms applied, no debug. No material override.
		const meshes = await parseMeshBatchBlob(dmfBlob(bytes), {
			mergeByMaterial: false,
			debug: false
		});
		if (meshes.length === 0) {
			pg.setStatus(`${name}: no meshes in this DMF (empty or items-only batch).`);
			return;
		}

		// Step 2 — place. The SAME call Viewer.svelte makes each solve: clears prior content, adds the
		// meshes, fits the camera frustum to the part's bounds, and frames it. This is why we don't need
		// any recenter/near-far hack — updateScene does exactly what Selva does.
		updateScene(viewer.scene, meshes, viewer.camera, viewer.controls, viewerInitialized);
		if (!viewerInitialized) viewerInitialized = true;

		// Rescale the grid to the freshly-loaded part so cells/fade match its extent (a 3000-unit part
		// gets coarse cells and a far fade; a 3-unit part gets fine ones), exactly as Viewer.svelte does.
		viewer.updateGridScale();

		// updateScene clears and re-adds all content, so any prior edge overlays are gone — re-attach
		// them if edges are on, exactly as Viewer.svelte does after updateScene.
		if (edgesVisible) viewer.applyEdges(viewer.scene);

		const box = computeMeshesBounds(meshes);
		const size = box.getSize(new THREE.Vector3());
		const tris = meshes.reduce((n, m) => n + (m.geometry.getIndex()?.count ?? 0) / 3, 0);
		pg.setStatus(
			`Loaded ${meshes.length} mesh(es), ${tris} tris — ${name}\n` +
				`size: ${size
					.toArray()
					.map((v) => v.toFixed(1))
					.join(' × ')}\n` +
				`look: ${renderStyle} · edges: ${edgesVisible ? 'on' : 'off'} · merge-by-material: off`
		);
	} catch (err) {
		const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
		pg.setStatus(`Failed to load ${name}:\n${msg}`);
		console.error(`[dmf-viewer] DMF load failed for ${name}:`, err);
	}
}

/** Fetch a DMF served over HTTP (a bundled fixture) and run it through the same loader. */
async function loadDmfUrl(url: string, name: string) {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
		await loadDmfBytes(new Uint8Array(await res.arrayBuffer()), name);
	} catch (err) {
		const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
		pg.setStatus(`Failed to fetch ${name}:\n${msg}`);
		console.error(`[dmf-viewer] DMF fetch failed for ${name}:`, err);
	}
}

/** World-space bounds of a mesh set, for the status readout. */
function computeMeshesBounds(meshes: THREE.Object3D[]): THREE.Box3 {
	const box = new THREE.Box3();
	for (const m of meshes) {
		m.updateMatrixWorld(true);
		box.expandByObject(m);
	}
	return box;
}

// ── File picker ───────────────────────────────────────────────────────────────
// The playground has no file-input helper, so wire a bare hidden <input> and forward its selection.
const dmfInput = document.createElement('input');
dmfInput.type = 'file';
dmfInput.accept = '.dmf';
dmfInput.style.display = 'none';
dmfInput.addEventListener('change', async () => {
	const file = dmfInput.files?.[0];
	if (file) await loadDmfBytes(new Uint8Array(await file.arrayBuffer()), file.name);
	dmfInput.value = ''; // reset so re-picking the same file fires change again
});
document.body.appendChild(dmfInput);

// ── DMF section ───────────────────────────────────────────────────────────────
pg.addSection('DMF');
pg.addButton('Load DMF File…', () => dmfInput.click());
// One-click samples straight from the repo fixtures — no file dialog needed.
pg.addButton('Sample: test_file.dmf', () => void loadDmfUrl(sampleSmallUrl, 'test_file.dmf'));
pg.addButton('Sample: test_mesh.dmf', () => void loadDmfUrl(sampleMeshUrl, 'test_mesh.dmf'));

// ── Display (mirrors Selva's Display submenu) ────────────────────────────────
// These are the two controls that shape the look. The look retunes lighting/material; edges overlay
// crease lines. Both are exactly what Viewer.svelte's Display menu drives (setLook / applyEdges).
pg.addSection('Display');
const lookSelect = pg.addSelect('Look', ['technical', 'studio', 'showcase'], 'technical', (v) => {
	renderStyle = v as Look;
	viewer.setLook(renderStyle);
});
void lookSelect; // returned setter kept for symmetry; not driven programmatically here
// Toggling off goes through `clearEdges` (what Viewer.svelte calls), not a bare `removeEdges`:
// above the triangle cap the viewer swaps the overlay for the screen-space edge pass, and only
// `clearEdges` stands that pass down as well.
pg.addToggle('Edges', edgesVisible, (on) => {
	edgesVisible = on;
	if (on) viewer.applyEdges(viewer.scene);
	else viewer.clearEdges(viewer.scene);
});

// ── Camera presets (same set Selva exposes) ──────────────────────────────────
pg.addSection('Views');
pg.addToggle('Orthographic (2D)', false, (on) =>
	viewer.cameraController.setProjection(on ? 'orthographic' : 'perspective')
);
pg.addButton('Fit', () => viewer.fitToView());

pg.setStatus(hint);
