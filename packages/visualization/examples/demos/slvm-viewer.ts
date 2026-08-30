/**
 * Demo: load a Selva mesh file (`.slvm`, legacy `.dmf`) through the EXACT pipeline the Selva app
 * uses, so the look/materials can be verified and debugged 1:1 with production.
 *
 * A mesh file is a saved `DisplayBatch`: a small JSON sidecar header followed by the raw SLVA/SLVZ mesh
 * blob. This demo strips the header and runs the blob through the same two calls Selva's viewer makes:
 *
 *   1. Parse — `parseMeshBatchBlob(blob, { mergeByMaterial })`, seeded to `true` to match
 *      plugin-ui's `websocket-solve-driver`, with a sidebar toggle to compare against un-merged. No
 *      `material` appearance override: Selva applies the look at the initThree/setLook level, never
 *      at parse time.
 *   2. Place — `updateScene(scene, meshes, camera, controls, initialPositionSet)`, the same call
 *      `Viewer.svelte` makes each solve. It clears prior content, adds the meshes, fits the camera
 *      frustum (near/far) to the part, and frames it — so a GH part sitting thousands of mm off the
 *      origin lands and frames exactly as it does in Selva, with no demo-specific recenter/fit hack.
 *
 * The viewer itself is constructed with Selva's exact `initThree` options (see `SELVA_VIEWER_OPTIONS`
 * below, copied from `Viewer.svelte`): the 'technical' look, the #E6E6E6 background, and crease
 * edges on by default. What you see here is what Selva renders.
 *
 * Sun and shadows are LEFT ON, matching `Viewer.svelte`, which sets neither and so takes the
 * library defaults (both `true`). This demo used to switch both off, which made it measurably
 * faster than the app it claims to mirror: a shadow-casting sun costs a whole extra scene render
 * per frame from the light's point of view, plus a blur pass for `VSMShadowMap`. The Sun/shadows
 * toggle below exists to measure exactly that.
 */
import * as THREE from 'three';

import { createPlayground } from '../shared/playground';
import { parseMeshBatchBlob } from '@/parse/index.js';
import { LOOKS, updateScene, type ThreeInitializerOptions, type Look } from '@/render/index.js';

// Bundled sample mesh files, served by Vite via ?url.
import sampleSmallUrl from '../fixtures/test_file.slvm?url';
import sampleMeshUrl from '../fixtures/test_mesh.slvm?url';
import sampleHouseUrl from '../fixtures/ifc_house.slvm?url';

// ============================================================================
// SELVA VIEWER CONFIG — copied verbatim from packages/ui Viewer.svelte onMount
// ============================================================================
// Only options that differ from the library defaults, exactly as Selva sets them: seed the
// 'technical' look and paint Selva's #E6E6E6 background. Grid + measure are the tools the Selva
// viewer builds. Keeping this in lockstep with Viewer.svelte is the whole point of the demo — so
// anything Viewer.svelte leaves at its default is left alone here too, sun and shadows included.
//
// HDR / image-based lighting is a large part of what the technical look reads as — the look is
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
// Experiment control, seeded to what plugin-ui's websocket-solve-driver sends. An IFC-scale batch
// is thousands of tiny meshes, so this is the switch between ~6000 draw calls and ~30.
let mergeByMaterial = true;
// Kept so toggling merge can re-run the parse on the same input without a second file pick.
let lastLoaded: { bytes: Uint8Array; name: string } | null = null;

const hint =
	'Load a mesh file (.slvm or legacy .dmf) to render it through the Selva pipeline.\n' +
	'Look / Edges below mirror Selva’s Display menu.';

// ── DMF blob extraction ─────────────────────────────────────────────────────
// DMF layout (little-endian): [4] magic "DMF1" | [4] version | [4] jsonLen | [jsonLen] sidecar JSON |
// [..] raw SLVA/SLVZ blob to end of file. See Plugin/Selva.GH/.../DmfFile.cs. We only need the blob;
// the sidecar (materials/groups) is also embedded in the blob's own metadata header, which is what
// parseMeshBatchBlob reads.
const DMF_MAGIC = 0x31464d44; // "DMF1" little-endian
const DMF_HEADER_PREAMBLE = 12; // magic(4) + version(4) + jsonLen(4)

function dmfBlob(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength < DMF_HEADER_PREAMBLE) throw new Error('File too small to be a mesh file.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// An SLVM v3 file IS the blob (a chunked container the parser sniffs directly); only legacy
	// DMF1 files carry a sidecar in front that has to be stripped.
	if (view.getUint32(0, true) !== DMF_MAGIC) return bytes;

	const jsonLen = view.getUint32(8, true);
	const blobStart = DMF_HEADER_PREAMBLE + jsonLen;
	if (blobStart > bytes.byteLength)
		throw new Error('DMF header declares a sidecar past end of file.');
	return bytes.subarray(blobStart);
}

// ── Load through the Selva pipeline ──────────────────────────────────────────
async function loadDmfBytes(bytes: Uint8Array, name: string) {
	lastLoaded = { bytes, name };
	pg.setStatus(`Loading ${name}…`);
	try {
		// Step 1 — parse. Selva's exact options (plugin-ui websocket-solve-driver): merged by material,
		// no debug, no material override.
		const meshes = await parseMeshBatchBlob(dmfBlob(bytes), {
			mergeByMaterial,
			debug: false
		});
		if (meshes.length === 0) {
			pg.setStatus(`${name}: no meshes in this file (empty or items-only batch).`);
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
		console.error(`[slvm-viewer] DMF load failed for ${name}:`, err);
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
		console.error(`[slvm-viewer] DMF fetch failed for ${name}:`, err);
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

// ── Scene analysis ────────────────────────────────────────────────────────────
// `analyze()` in the console. Answers why a model is slow rather than just reporting that it is:
// the triangle histogram is the tell. A batch whose median mesh holds ~20 triangles is draw-call
// bound no matter how small its triangle total looks, and merging is the only thing that helps.
function analyzeScene(): string {
	const meshes: THREE.Mesh[] = [];
	const overlays: THREE.Object3D[] = [];
	viewer.scene.traverse((o) => {
		if (o.userData?.kind === 'edge-overlay') overlays.push(o);
		else if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
	});

	const tris = meshes
		.map((m) => (m.geometry.getIndex()?.count ?? m.geometry.getAttribute('position')?.count ?? 0) / 3)
		.sort((a, b) => a - b);
	const total = tris.reduce((a, b) => a + b, 0);
	const at = (q: number) => tris[Math.min(tris.length - 1, Math.floor(tris.length * q))] ?? 0;

	// Buckets, not just quantiles: the shape of the distribution is what distinguishes "one heavy
	// model" (fine) from "thousands of trivial ones" (the pathological case).
	const buckets = [10, 100, 1_000, 10_000, Infinity];
	const labels = ['<10', '10-99', '100-999', '1k-10k', '>10k'];
	const histogram = buckets.map(
		(hi, i) => tris.filter((t) => t < hi && t >= (i === 0 ? 0 : buckets[i - 1]!)).length
	);

	const materials = new Set<string>();
	for (const m of meshes) {
		const mat = m.material;
		for (const one of Array.isArray(mat) ? mat : [mat]) materials.add(one.uuid);
	}

	const merged = meshes.filter((m) => Array.isArray(m.userData?.members)).length;
	const sourceObjects = meshes.reduce(
		(n, m) => n + (Array.isArray(m.userData?.members) ? m.userData.members.length : 1),
		0
	);

	return [
		`meshes            ${meshes.length}   (merged: ${merged})`,
		`edge overlays     ${overlays.length}`,
		`draw calls/frame  ~${meshes.length + overlays.length}`,
		`source objects    ${sourceObjects}`,
		`distinct materials ${materials.size}`,
		`triangles         ${total}`,
		`  min ${tris[0] ?? 0} · p50 ${at(0.5)} · p90 ${at(0.9)} · max ${tris[tris.length - 1] ?? 0}`,
		`  ${labels.map((l, i) => `${l}: ${histogram[i]}`).join('  ')}`,
		total > 0 ? `avg tris/draw     ${(total / Math.max(1, meshes.length)).toFixed(0)}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

(window as unknown as { analyze: () => string }).analyze = () => {
	const report = analyzeScene();
	pg.setStatus(report);
	return report;
};

// ── Cost attribution ──────────────────────────────────────────────────────────
// `bench()` in the console. Measures median frame cost with each suspected contributor switched
// off, so the cost lands on a specific subsystem instead of being inferred from object counts.
// Each configuration is timed by forcing real draws — the on-demand loop would otherwise skip them.
async function benchConfigurations(): Promise<string> {
	const FRAMES = 40;

	// Drives the viewer's real animation loop rather than calling the renderer directly, so the
	// measurement includes everything a real frame pays for (composer passes, grid, near-plane fit).
	// `invalidate()` each frame is what stops the on-demand loop from skipping the draw.
	// Reads the render cost the playground's HUD accumulates rather than timing rAF deltas: once a
	// frame's work fits inside a vsync interval those deltas pin to the refresh rate (16.7 ms on a
	// 60Hz display) and every configuration measures identical, which is a floor, not a result.
	const frameCost = (window as unknown as { frameCost?: () => number }).frameCost;

	const measure = async (): Promise<number> => {
		// Drive real frames through the viewer's own loop so the cost includes everything a frame
		// pays for (composer passes, grid, near-plane fit), then read what those frames actually cost.
		for (let i = 0; i < FRAMES; i++) {
			viewer.invalidate();
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
		return frameCost?.() ?? 0;
	};

	// Counts alongside the timings: a configuration that didn't take effect (an un-awaited async
	// apply, a budget that never triggered) otherwise looks like a change that simply didn't help.
	const overlayCount = (): number => {
		let n = 0;
		viewer.scene.traverse((o) => {
			if (o.userData?.kind === 'edge-overlay') n++;
		});
		return n;
	};

	const rows: string[] = [];
	const baseline = await measure();
	rows.push(`baseline            ${baseline.toFixed(1)} ms   (${overlayCount()} overlays)`);

	viewer.clearEdges(viewer.scene);
	const withoutEdges = await measure();
	rows.push(
		`without edges       ${withoutEdges.toFixed(1)} ms   (${pct(baseline, withoutEdges)} of frame, ` +
			`${overlayCount()} overlays)`
	);

	viewer.setAmbientOcclusion(false);
	const withoutEdgesOrAo = await measure();
	rows.push(
		`  and without AO    ${withoutEdgesOrAo.toFixed(1)} ms   (${pct(withoutEdges, withoutEdgesOrAo)} of frame)`
	);

	// Shadows are the one thing this demo used to switch off while claiming to mirror the app, so
	// they get their own row: a shadow-casting sun is an extra scene render plus a VSM blur.
	const sun = viewer.scene.getObjectByProperty('isDirectionalLight', true) as
		| THREE.DirectionalLight
		| undefined;
	const shadowsWereOn = sun?.castShadow ?? false;
	if (sun) sun.castShadow = false;
	const withoutShadows = await measure();
	rows.push(
		`  and without shadow ${withoutShadows.toFixed(1)} ms   (${pct(withoutEdgesOrAo, withoutShadows)} of frame)`
	);
	if (sun) sun.castShadow = shadowsWereOn;

	// Restore whatever the sidebar toggles say the viewer should look like. applyEdges attaches
	// asynchronously, so give it a frame to land before the caller reads the scene back.
	viewer.setAmbientOcclusion(true);
	if (edgesVisible) {
		viewer.applyEdges(viewer.scene);
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}

	return rows.join('\n');
}

/** Share of frame cost removed going from `before` to `after`. */
function pct(before: number, after: number): string {
	if (before <= 0) return '0%';
	return `${Math.max(0, ((before - after) / before) * 100).toFixed(0)}% saved`;
}

(window as unknown as { bench: () => Promise<string> }).bench = async () => {
	pg.setStatus('Benchmarking…');
	const report = await benchConfigurations();
	pg.setStatus(report);
	return report;
};

// ── File picker ───────────────────────────────────────────────────────────────
// The playground has no file-input helper, so wire a bare hidden <input> and forward its selection.
const dmfInput = document.createElement('input');
dmfInput.type = 'file';
dmfInput.accept = '.slvm,.dmf';
dmfInput.style.display = 'none';
dmfInput.addEventListener('change', async () => {
	const file = dmfInput.files?.[0];
	if (file) await loadDmfBytes(new Uint8Array(await file.arrayBuffer()), file.name);
	dmfInput.value = ''; // reset so re-picking the same file fires change again
});
document.body.appendChild(dmfInput);

// ── Mesh file section ─────────────────────────────────────────────────────────
pg.addSection('Mesh file');
pg.addButton('Load Mesh File…', () => dmfInput.click());
// One-click samples straight from the repo fixtures — no file dialog needed.
pg.addButton('Sample: test_file.slvm', () => void loadDmfUrl(sampleSmallUrl, 'test_file.slvm'));
pg.addButton('Sample: test_mesh.slvm', () => void loadDmfUrl(sampleMeshUrl, 'test_mesh.slvm'));
pg.addButton('Sample: ifc_house.slvm', () => void loadDmfUrl(sampleHouseUrl, 'ifc_house.slvm'));

// ── Merge experiment ──────────────────────────────────────────────────────────
// Re-parses the last input, so the two configurations can be compared on one file without a reload.
pg.addToggle('Merge by material', mergeByMaterial, (on) => {
	mergeByMaterial = on;
	if (lastLoaded) void loadDmfBytes(lastLoaded.bytes, lastLoaded.name);
});

// ── Display (mirrors Selva's Display submenu) ────────────────────────────────
// These are the two controls that shape the look. The look retunes lighting/material; edges overlay
// crease lines. Both are exactly what Viewer.svelte's Display menu drives (setLook / applyEdges).
pg.addSection('Display');
const lookSelect = pg.addSelect('Look', [...LOOKS], 'technical', (v) => {
	renderStyle = v as Look;
	viewer.setLook(renderStyle);
});
void lookSelect; // returned setter kept for symmetry; not driven programmatically here
// Toggling off goes through `clearEdges` (what Viewer.svelte calls), not a bare `removeEdges`:
// above the triangle cap the viewer swaps the overlay for the screen-space edge pass, and only
// `clearEdges` stands that pass down as well.
// Sun shadows cost an extra scene render per frame (plus a VSM blur), and they are ON in the app.
// This is the switch that explains a demo-vs-plugin frame-time gap.
pg.addToggle('Sun shadows', true, (on) => {
	viewer.scene.traverse((o) => {
		const light = o as THREE.DirectionalLight;
		if (light.isDirectionalLight) light.castShadow = on;
	});
	viewer.invalidate();
});
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
