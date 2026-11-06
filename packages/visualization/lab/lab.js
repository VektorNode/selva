import { BufferAttribute } from 'three';

import { SCALE_FACTORS, parseMeshBatchBlob } from '../src/parse/index.ts';
import { grainTangents } from '../src/parse/webdisplay/grain-tangents.ts';
import { initThree, updateScene } from '../src/render/index.ts';
import { LOOK_PRESETS } from '../src/shared/index.ts';
import { buildGlassScene } from './glass-scene.js';
import { buildMetalScene } from './metal-scene.js';
import { buildNightScene } from './night-scene.js';
import { measure } from './measure.js';
import { buildPlasticScene } from './plastic-scene.js';
import { buildStoneScene } from './stone-scene.js';
import { buildWoodScene } from './wood-scene.js';
import { readModelUnits } from './slvm-units.mjs';

const scenes = import.meta.glob('../../../dev/viewer-scenes/*.slvm', {
	query: '?url',
	import: 'default',
	eager: true
});

// A recording is in its document's units and the viewer works in metres. Recordings made before
// units were stored were all millimetres.
const DEFAULT_UNITS = 'Millimeters';

const options = Object.fromEntries(new URLSearchParams(location.search));
const manual = 'manual' in options;

// `run.mjs` steps frames itself, so a frame's time is its real cost and not the vsync interval.
let pending = null;
if (manual) {
	window.requestAnimationFrame = (callback) => {
		pending = callback;
		return 1;
	};
	window.cancelAnimationFrame = () => {
		pending = null;
	};
}
const step = () => {
	const callback = pending;
	pending = null;
	callback?.(performance.now());
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function load(names) {
	// 'glass-panes' leaves out the thick cube, the one object that needs transmission.
	const glass = names.includes('glass')
		? buildGlassScene()
		: names.includes('glass-panes')
			? buildGlassScene({ panesOnly: true })
			: [];
	if (names.includes('metals')) glass.push(...buildMetalScene());
	if (names.includes('plastics')) glass.push(...buildPlasticScene());
	if (names.includes('wood')) glass.push(...buildWoodScene());
	if (names.includes('stone')) glass.push(...buildStoneScene());
	for (const name of names.filter((each) => each.startsWith('night-'))) {
		glass.push(...buildNightScene(name.slice('night-'.length)));
	}
	// A solve's mesh assembly adds these, and anisotropy and the fibre tilt follow them: without,
	// three rebuilds the frame per pixel and a synthetic scene shows what no solve does.
	for (const { geometry } of glass) {
		const { position, normal, uv } = geometry.attributes;
		if (!uv || !geometry.index) continue;
		const tangents = grainTangents(position.array, normal.array, geometry.index.array, uv.array);
		geometry.setAttribute('tangent', new BufferAttribute(tangents, 4));
	}
	names = names.filter(
		(name) =>
			!name.startsWith('glass') &&
			!name.startsWith('night-') &&
			!['metals', 'plastics', 'wood', 'stone'].includes(name)
	);
	if (names.length === 0) return glass;
	const urls = Object.entries(scenes)
		.filter(([path]) => names.some((name) => path.endsWith(`/${name}.slvm`)))
		.map(([, url]) => url);
	if (urls.length === 0) throw new Error(`No scene named ${names}: see dev/viewer-scenes.`);
	const meshes = await Promise.all(
		urls.map(async (url) => {
			const bytes = await (await fetch(url)).arrayBuffer();
			const scale = SCALE_FACTORS[readModelUnits(new Uint8Array(bytes)) ?? DEFAULT_UNITS];
			const batch = await parseMeshBatchBlob(bytes, { mergeByMaterial: true });
			for (const mesh of batch) {
				mesh.scale.setScalar(scale);
				mesh.updateMatrixWorld();
			}
			return batch;
		})
	);
	return [...meshes.flat(), ...glass];
}

async function start() {
	const canvas = document.getElementById('viewer');
	const look = options.look ?? 'studio';
	const render = {};
	if (options.frames != null) render.idleRefineFrames = Number(options.frames);
	if (options.orbit != null) render.lightOrbitFrameMs = Number(options.orbit);

	// Each is what a feature costs: the same scene with it removed.
	const without = new Set(options.without?.split(',') ?? []);
	const preset = LOOK_PRESETS[look];
	if (without.has('ao')) preset.ambientOcclusion = false;
	if (without.has('bloom')) delete preset.bloom;
	if (without.has('emissive')) preset.emissiveLights = false;
	if (without.has('shadows')) render.enableShadows = false;
	if (without.has('sun')) preset.sunlightIntensity = 0;

	// `set=metalReflection:0.2,bloom.strength:0.5` retunes the look's dials without editing source.
	for (const entry of options.set?.split(',') ?? []) {
		const [path, value] = entry.split(':');
		const keys = path.split('.');
		const last = keys.pop();
		const holder = keys.reduce((object, key) => (object[key] ??= {}), preset);
		holder[last] = Number.isNaN(Number(value)) ? value : Number(value);
	}

	const viewer = initThree(canvas, {
		look,
		environment: { hdrPath: '/baseHDR.hdr', backgroundColor: options.background ?? '#0a0e12' },
		render
	});
	const { scene, camera, controls, renderer } = viewer;

	const meshes = await load((options.scene ?? 'lamp').split('+'));
	if (without.has('finishes')) {
		for (const { material } of meshes) {
			material.onBeforeCompile = () => {};
			material.customProgramCacheKey = () => 'plain';
			material.needsUpdate = true;
		}
	}
	updateScene(scene, meshes, camera, controls, false);
	viewer.setLook(look);
	viewer.updateShadowBounds();
	viewer.syncEmissiveLights();
	for (let i = 0; i < 400 && !scene.environment; i++) await sleep(25);

	const target = controls.target;
	const view = camera.position.clone().sub(target);
	if (options.target) target.fromArray(options.target.split(',').map(Number));
	view.applyAxisAngle(camera.up, Number(options.turn ?? 0));
	view.multiplyScalar(Number(options.distance ?? 1));
	camera.position.copy(target).add(view);
	camera.lookAt(target);

	const gl = renderer.getContext();
	const pixel = new Uint8Array(4);
	// Blocks on the GPU, or the timer would only measure queuing the draw calls.
	const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

	const megabytes = (bytes) => Math.round(bytes / 1e4) / 100;
	const geometryBytes = () => {
		let bytes = 0;
		const seen = new Set();
		scene.traverse(({ geometry }) => {
			if (!geometry || seen.has(geometry)) return;
			seen.add(geometry);
			const buffers = [...Object.values(geometry.attributes), geometry.index];
			for (const buffer of buffers) bytes += buffer?.array.byteLength ?? 0;
		});
		return bytes;
	};
	// Depth only: a cube map is six faces, and a blurred VSM map adds a colour pass of its own.
	const shadowBytes = () => {
		let bytes = 0;
		scene.traverse((light) => {
			if (!light.isLight || !light.castShadow) return;
			const { x, y } = light.shadow.mapSize;
			bytes += x * y * 4 * (light.isPointLight ? 6 : renderer.shadowMap.type === 3 ? 2 : 1);
		});
		return bytes;
	};
	const countFrame = () => {
		renderer.info.autoReset = false;
		renderer.info.reset();
		viewer.invalidate();
		step();
		finish();
		const { calls, triangles } = renderer.info.render;
		renderer.info.autoReset = true;
		return { drawCalls: calls, triangles };
	};

	const sorted = (values) => [...values].sort((a, b) => a - b);
	const round = (value) => Math.round(value * 10) / 10;

	const refineFrames = Number(options.frames ?? 32);
	// A camera change is seen on the next frame, and restarts the settle delay from there.
	const settle = async () => {
		viewer.invalidate();
		step();
		step();
		finish();
		await sleep(250);
	};

	let lastShot = null;
	window.lab = {
		/** What each solve mesh is made of, as parsed: the first question when a scene looks wrong. */
		materials: () =>
			meshes.map(({ name, userData, material }) => ({
				name: userData.name || name,
				members: userData.members?.length ?? 1,
				color: `#${material.color?.getHexString()}`,
				metalness: material.metalness,
				roughness: material.roughness,
				emissive: material.userData.selvaEmissive
					? `#${material.emissive.getHexString()} x${material.emissiveIntensity}`
					: null,
				emissiveLight: material.userData.selvaEmissiveLight ?? null,
				opacity: material.opacity,
				transmission: material.transmission ?? 0
			})),
		/** Per-object numbers for the last `shot()`. Call it last: the ID pass redraws the scene. */
		measure: () => measure(viewer, lastShot),
		/** Waits out the settle delay and every refine frame, so the image is the finished one. */
		shot: async () => {
			await settle();
			for (let i = 0; i < refineFrames; i++) step();
			finish();
			const blob = await viewer.captureImage();
			lastShot = blob;
			const bytes = new Uint8Array(await blob.arrayBuffer());
			return btoa(bytes.reduce((text, byte) => text + String.fromCharCode(byte), ''));
		},
		/** Frame-to-frame change across an orbit, its stop and the refine, to catch a visible pop. */
		transition: async () => {
			const pixels = () => {
				const { width, height } = canvas;
				const data = new Uint8Array(width * height * 4);
				gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
				return data;
			};
			const change = (a, b) => {
				let sum = 0;
				for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i + 1] - b[i + 1]);
				return Math.round((sum / (a.length / 4) / 255) * 1e4) / 100;
			};
			const home = camera.position.clone();
			const changes = [];
			let previous = null;
			const frame = () => {
				step();
				finish();
				const current = pixels();
				if (previous) changes.push(change(previous, current));
				previous = current;
			};
			frame();
			// A nudge too small to move the picture, so what changes is the shading.
			for (let i = 0; i < 16; i++) {
				camera.position.copy(home).addScalar(1e-6 * (i % 2));
				camera.lookAt(target);
				frame();
			}
			camera.position.copy(home);
			camera.lookAt(target);
			frame();
			await sleep(250);
			for (let i = 0; i < 44; i++) frame();
			return changes;
		},
		bench: async (frames = 90) => {
			const orbit = [];
			const home = camera.position.clone().sub(target);
			for (let i = 0; i < frames + 8; i++) {
				camera.position
					.copy(target)
					.add(home.clone().applyAxisAngle(camera.up, Math.sin(i * 0.15) * 0.25));
				camera.lookAt(target);
				const start = performance.now();
				viewer.invalidate();
				step();
				finish();
				if (i >= 8) orbit.push(performance.now() - start);
			}
			camera.position.copy(target).add(home);
			camera.lookAt(target);
			await settle();
			const start = performance.now();
			for (let i = 0; i < refineFrames; i++) {
				step();
				finish();
			}
			const debug = gl.getExtension('WEBGL_debug_renderer_info');
			return {
				gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
				size: `${canvas.width}x${canvas.height}`,
				...countFrame(),
				geometryMb: megabytes(geometryBytes()),
				shadowMapMb: megabytes(shadowBytes()),
				orbitMedianMs: round(sorted(orbit)[Math.floor(orbit.length / 2)]),
				orbitP95Ms: round(sorted(orbit)[Math.floor(orbit.length * 0.95)]),
				refineTotalMs: round(performance.now() - start),
				look
			};
		}
	};
	document.title = 'ready';
}

start().catch((error) => {
	document.body.textContent = error.message;
	document.title = 'failed';
});
