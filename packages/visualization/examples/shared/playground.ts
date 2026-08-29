/**
 * Shared playground shell for the @selvajs/visualization examples.
 *
 * Every demo is a small module that calls {@link createPlayground} to get a ready THREE viewer
 * (via the library's own `initThree`), a sidebar to hang controls on, and a status line. The goal:
 * a new demo is "set up the viewer, add some objects, write a status" — no boilerplate per file.
 *
 * Demos import from the package's public barrels (`@/render`, `@/parse`) rather than reaching into
 * modules directly — so if a demo needs a symbol the barrel doesn't export, that's a real gap in the
 * public API, not something to route around with a deep import.
 *
 * Runs under Vite (`pnpm example`), which transpiles these `.ts` imports and resolves the `@` alias.
 * Opening the HTML directly via `file://` or a static server (Live Server) will NOT work — the
 * browser can't transpile TypeScript or resolve bare imports.
 */
import * as THREE from 'three';

import { initThree, type ThreeInitializerOptions } from '@/render/index.js';

export interface Playground {
	/** The library viewer handle (scene, camera, controls, fitToView, dispose, …). */
	viewer: ReturnType<typeof initThree>;
	/** Sidebar container — add buttons/labels here, or use the {@link addButton} helpers. */
	sidebar: HTMLElement;
	/** Add a clickable action button to the sidebar. Returns the element for further tweaking. */
	addButton(label: string, onClick: () => void): HTMLButtonElement;
	/**
	 * Add an on/off toggle button that tracks its own state and reflects it in the label + `.active`
	 * style. `onChange` receives the new state. Returns a `set(value)` to drive it programmatically.
	 */
	addToggle(
		label: string,
		initial: boolean,
		onChange: (on: boolean) => void
	): { set(value: boolean): void };
	/** Add a labelled range slider with a live value readout. Returns a `set(value)`. */
	addSlider(
		label: string,
		opts: { min: number; max: number; step: number; value: number },
		onChange: (value: number) => void
	): { set(value: number): void };
	/** Add a labelled dropdown. Returns a `set(value)`. */
	addSelect(
		label: string,
		options: string[],
		value: string,
		onChange: (value: string) => void
	): { set(value: string): void };
	/** Add a labelled section header in the sidebar. */
	addSection(title: string): void;
	/** Write a line (or lines) to the status panel. Replaces previous content. */
	setStatus(text: string): void;
	/** Remove every renderable the demo added, keeping lights/floor/helpers from initThree. */
	clearObjects(): void;
	/** Add objects to the scene and track them so {@link clearObjects} can remove them. */
	addObjects(objects: THREE.Object3D[]): void;
}

export interface PlaygroundOptions {
	/** Demo title shown at the top of the sidebar. */
	title: string;
	/** Passed straight through to the library's `initThree`. */
	viewer?: ThreeInitializerOptions;
	/** Add an XYZ axis gizmo at the origin so an empty scene still shows something. Default true. */
	axes?: boolean;
}

/**
 * Mount the playground into the page. Expects two elements to exist: `#sidebar` and `#viewer-canvas`
 * (the demo HTML provides them via the shared template — see any `demos/*.html`).
 */
export function createPlayground(options: PlaygroundOptions): Playground {
	const { title, viewer: viewerOptions, axes = true } = options;

	const sidebar = requireEl('sidebar');
	const canvas = requireEl<HTMLCanvasElement>('viewer-canvas');

	// The demo HTML seeds the sidebar with a "you need Vite" notice, visible when this script never
	// ran. It did, so clear it before rendering the real controls.
	sidebar.replaceChildren();

	renderSidebarHeader(sidebar, title);
	const statusEl = renderStatusPanel(sidebar);

	// No HDR ships with the examples, so default environment lighting off unless a demo opts in;
	// otherwise HDRLoader hits the SPA fallback and throws on render.
	// Surface any init failure on the page — a thrown initThree leaves a blank canvas otherwise.
	let viewer: ReturnType<typeof initThree>;
	try {
		viewer = initThree(canvas, {
			...viewerOptions,
			environment: {
				enableEnvironmentLighting: false,
				...viewerOptions?.environment
			}
		});
	} catch (err) {
		statusEl.textContent = `initThree threw:\n${err instanceof Error ? err.stack || err.message : String(err)}`;
		throw err;
	}

	if (axes) viewer.scene.add(new THREE.AxesHelper(10));

	// Objects the demo adds, so we can clear just those without touching lights/floor/axes.
	const tracked = new Set<THREE.Object3D>();

	const addObjects = (objects: THREE.Object3D[]) => {
		for (const obj of objects) {
			viewer.scene.add(obj);
			tracked.add(obj);
		}
		// Refit the shadow frustum so newly-added geometry casts crisp shadows.
		viewer.updateShadowBounds();
	};

	const clearObjects = () => {
		for (const obj of tracked) {
			disposeObject(obj);
			obj.removeFromParent();
		}
		tracked.clear();
		viewer.updateShadowBounds();
	};

	const addSection = (sectionTitle: string) => {
		const el = document.createElement('div');
		el.className = 'section-title';
		el.textContent = sectionTitle;
		sidebar.appendChild(el);
	};

	const addButton = (label: string, onClick: () => void) => {
		const btn = document.createElement('button');
		btn.textContent = label;
		btn.addEventListener('click', onClick);
		sidebar.appendChild(btn);
		return btn;
	};

	const addToggle = (label: string, initial: boolean, onChange: (on: boolean) => void) => {
		let on = initial;
		const render = () => {
			btn.textContent = `${label}: ${on ? 'On' : 'Off'}`;
			btn.classList.toggle('active', on);
		};
		const btn = addButton(label, () => {
			on = !on;
			render();
			onChange(on);
		});
		render();
		return {
			set(value: boolean) {
				on = value;
				render();
			}
		};
	};

	const addSlider = (
		label: string,
		opts: { min: number; max: number; step: number; value: number },
		onChange: (value: number) => void
	) => {
		const wrap = document.createElement('label');
		wrap.className = 'control-row';
		const text = document.createElement('span');
		const input = document.createElement('input');
		input.type = 'range';
		input.min = String(opts.min);
		input.max = String(opts.max);
		input.step = String(opts.step);
		input.value = String(opts.value);
		const render = (v: number) => {
			text.textContent = `${label}: ${v}`;
		};
		render(opts.value);
		input.addEventListener('input', () => {
			const v = Number(input.value);
			render(v);
			onChange(v);
		});
		wrap.append(text, input);
		sidebar.appendChild(wrap);
		return {
			set(value: number) {
				input.value = String(value);
				render(value);
			}
		};
	};

	const addSelect = (
		label: string,
		options: string[],
		value: string,
		onChange: (value: string) => void
	) => {
		const wrap = document.createElement('label');
		wrap.className = 'control-row';
		const text = document.createElement('span');
		text.textContent = label;
		const select = document.createElement('select');
		for (const opt of options) {
			const o = document.createElement('option');
			o.value = opt;
			o.textContent = opt;
			if (opt === value) o.selected = true;
			select.appendChild(o);
		}
		select.addEventListener('change', () => onChange(select.value));
		wrap.append(text, select);
		sidebar.appendChild(wrap);
		return {
			set(v: string) {
				select.value = v;
			}
		};
	};

	const setStatus = (text: string) => {
		statusEl.textContent = text;
	};

	// Built-in camera section every demo gets for free.
	addSection('Camera');
	addButton('Fit to View (F)', () => viewer.fitToView());
	addToggle('Auto Rotate', viewer.controls.autoRotate, (on) => {
		viewer.controls.autoRotate = on;
	});

	// Performance / debug HUD pinned to the top-right of the viewport. Always on — it's the first thing
	// you want when a demo misbehaves (blank canvas, runaway camera, draw-call spikes).
	mountDebugHud(viewer);

	return {
		viewer,
		sidebar,
		addButton,
		addToggle,
		addSlider,
		addSelect,
		addSection,
		setStatus,
		clearObjects,
		addObjects
	};
}

/**
 * A fixed, always-on debug/perf HUD in the top-right corner of the viewport.
 *
 * Reports two things that are easy to confuse. **Frame cost** (`cpu`) is the wall time one
 * `render()` actually takes, sampled by timing the draw directly — that is the number that decides
 * whether orbiting feels smooth. **fps** is only meaningful while something is redrawing: the
 * viewer's loop is on-demand, so a still scene idles at 2fps by design and a low number there means
 * nothing. `stress` forces a redraw every frame so fps becomes comparable.
 *
 * The scene breakdown (`meshes` / `edges`) is what explains the frame cost on real models. An
 * IFC-scale batch arrives as thousands of tiny meshes, each of which the renderer must walk,
 * matrix-update, frustum-test and issue a draw call for, regardless of how few triangles it holds —
 * so `meshes` predicts the cost far better than `tris` does.
 */
function mountDebugHud(viewer: ReturnType<typeof initThree>): void {
	const hud = document.createElement('pre');
	hud.id = 'debug-hud';
	hud.style.cssText =
		'position:fixed;top:6px;right:6px;z-index:9999;margin:0;padding:6px 8px;' +
		'background:rgba(0,0,0,.72);color:#3f6;font:10px/1.35 monospace;white-space:pre;' +
		'pointer-events:none;border-radius:4px;min-width:190px';
	document.body.appendChild(hud);

	const fmt = (v: THREE.Vector3) => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;

	let frames = 0;
	let fps = 0;
	let fpsWindowStart = performance.now();

	// Frame cost, measured by wrapping the renderer's own render(). renderer.info counts draw calls
	// but says nothing about how long they took, and the rAF delta includes idle time on an
	// on-demand loop — so neither answers "is this smooth".
	//
	// Two traps this has to work around, both of which silently report near-zero on a post-processed
	// viewer. The composer drives SEVERAL renderer.render() calls per frame (scene pass, GTAO's own
	// depth/normal pass, then fullscreen quads for AA and output), and `renderer.info` RESETS on each
	// one — so reading it after the frame reports whatever the last fullscreen quad did: 1 call, 0
	// triangles. Both the timing and the counts therefore accumulate across a frame and are latched
	// at the frame boundary, and the scene-pass counts are kept separately from the quad passes,
	// since only the former scales with object count.
	const frameCostMs = new RingBuffer(60);
	const renderer = viewer.renderer;
	const originalRender = renderer.render.bind(renderer);

	let frameMs = 0;
	let framePasses = 0;
	let frameCalls = 0;
	let frameTris = 0;
	// Latched at the frame boundary so the HUD never shows a half-accumulated frame.
	let shown = { calls: 0, tris: 0, passes: 0 };

	renderer.render = ((scene: THREE.Scene, camera: THREE.Camera) => {
		const t0 = performance.now();
		originalRender(scene, camera);
		frameMs += performance.now() - t0;
		framePasses++;
		frameCalls += renderer.info.render.calls;
		frameTris += renderer.info.render.triangles;
	}) as typeof renderer.render;

	// Frame boundary: whatever accumulated since the last tick was one frame's worth of passes.
	const latchFrame = () => {
		if (framePasses === 0) return; // on-demand loop skipped the draw; keep the last real numbers
		frameCostMs.push(frameMs);
		shown = { calls: frameCalls, tris: frameTris, passes: framePasses };
		frameMs = 0;
		framePasses = 0;
		frameCalls = 0;
		frameTris = 0;
	};

	// Scene composition is only recounted when the scene changes shape — traversing thousands of
	// objects every frame would itself become the thing being measured.
	let sceneCounts = { meshes: 0, edges: 0, maxDepth: 0 };
	let lastSceneVersion = -1;
	const countScene = () => {
		let meshes = 0;
		let edges = 0;
		let maxDepth = 0;
		viewer.scene.traverse((o) => {
			// Keyed on the library's own EDGE_USERDATA_KIND tag, not a three.js instance flag: an
			// overlay IS a Mesh subclass, so a missed tag silently counts it as content geometry.
			if (o.userData?.kind === 'edge-overlay') edges++;
			else if ((o as THREE.Mesh).isMesh) meshes++;
			let depth = 0;
			for (let p = o.parent; p; p = p.parent) depth++;
			if (depth > maxDepth) maxDepth = depth;
		});
		sceneCounts = { meshes, edges, maxDepth };
	};

	const tick = () => {
		frames++;
		const now = performance.now();
		if (now - fpsWindowStart >= 500) {
			fps = Math.round((frames * 1000) / (now - fpsWindowStart));
			frames = 0;
			fpsWindowStart = now;
		}

		// scene.children.length changes on every load/clear; enough to catch content swaps without
		// paying a full traversal per frame.
		if (viewer.scene.children.length !== lastSceneVersion) {
			lastSceneVersion = viewer.scene.children.length;
			countScene();
		}

		latchFrame();

		const cam = viewer.cameraController.getActiveCamera();
		const target = viewer.controls.target;
		const mem = renderer.info.memory;
		const avg = frameCostMs.mean();
		const peak = frameCostMs.max();
		const objects = sceneCounts.meshes + sceneCounts.edges;

		hud.textContent =
			`fps      ${fps}${stressing ? ' (stress)' : ''}
` +
			`cpu      ${avg.toFixed(1)} ms  peak ${peak.toFixed(1)}
` +
			`budget   ${((avg / 16.7) * 100).toFixed(0)}% of 60fps
` +
			`calls    ${shown.calls}  (${shown.passes} passes)
` +
			`tris     ${shown.tris}
` +
			`objects  ${objects}  (mesh ${sceneCounts.meshes} / edge ${sceneCounts.edges})
` +
			`per-obj  ${objects > 0 ? ((avg * 1000) / objects).toFixed(1) : '0'} µs
` +
			`gpu mem  geo ${mem.geometries} tex ${mem.textures}
` +
			`proj     ${viewer.cameraController.getProjection()}
` +
			`cam      ${fmt(cam.position)}
` +
			`target   ${fmt(target)}
` +
			`dist     ${cam.position.distanceTo(target).toFixed(2)}`;

		if (stressing) viewer.invalidate();

		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);

	/**
	 * Wall time of the last completed frame's render passes, for callers timing a configuration
	 * change. Once the work fits inside a vsync interval, rAF deltas pin to the refresh rate and
	 * stop reflecting cost at all — this keeps measuring actual work below that floor.
	 */
	(window as unknown as { frameCost: () => number }).frameCost = () => frameCostMs.mean();

	// Forces a redraw every frame, so fps measures sustained render cost instead of idle time.
	let stressing = false;
	(window as unknown as { stress: (on?: boolean) => string }).stress = (on = !stressing) => {
		stressing = on;
		return `stress ${on ? 'on — fps now measures sustained render cost' : 'off'}`;
	};
}

/** Fixed-size sample window for frame timings. */
class RingBuffer {
	private readonly values: number[] = [];
	constructor(private readonly capacity: number) {}
	push(value: number): void {
		this.values.push(value);
		if (this.values.length > this.capacity) this.values.shift();
	}
	mean(): number {
		if (this.values.length === 0) return 0;
		return this.values.reduce((a, b) => a + b, 0) / this.values.length;
	}
	max(): number {
		return this.values.length === 0 ? 0 : Math.max(...this.values);
	}
}

function requireEl<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Playground: missing #${id} element in the page.`);
	return el as T;
}

function renderSidebarHeader(sidebar: HTMLElement, title: string) {
	const h2 = document.createElement('h2');
	h2.textContent = title;
	sidebar.appendChild(h2);

	const back = document.createElement('a');
	back.href = './index.html';
	back.textContent = '← All examples';
	back.className = 'back-link';
	sidebar.appendChild(back);
}

function renderStatusPanel(sidebar: HTMLElement): HTMLElement {
	const title = document.createElement('div');
	title.className = 'section-title';
	title.textContent = 'Status';
	sidebar.appendChild(title);

	const panel = document.createElement('div');
	panel.id = 'status-panel';
	panel.textContent = 'Ready.';
	sidebar.appendChild(panel);
	return panel;
}

/** Dispose geometry + materials (and their textures) in a subtree. Mirrors the library's cleanup. */
function disposeObject(root: THREE.Object3D) {
	root.traverse((child) => {
		const renderable = child as Partial<THREE.Mesh> & THREE.Object3D;
		renderable.geometry?.dispose();
		const material = renderable.material;
		if (!material) return;
		const materials = Array.isArray(material) ? material : [material];
		for (const m of materials) {
			for (const value of Object.values(m)) {
				if (value instanceof THREE.Texture) value.dispose();
			}
			m.dispose();
		}
	});
}
