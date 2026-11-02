import * as THREE from 'three';

import type { RenderPipeline } from '../render-pipeline.js';

/** Long enough to skip the pauses inside an orbit, or a drag would keep restarting the average. */
const SETTLE_MS = 150;

/** Ambient occlusion is the largest cost of a frame, and the only one that can fade without a pop. */
const AO_FADE_FRAMES = 8;

/** Enough moving frames that one hitch can't decide it. */
const ORBIT_SAMPLES = 12;

/** Low-discrepancy sequence in [0, 1): N samples cover the range far more evenly than random ones. */
export function halton(index: number, base: number): number {
	let result = 0;
	let fraction = 1 / base;
	for (let i = index; i > 0; i = Math.floor(i / base)) {
		result += (i % base) * fraction;
		fraction /= base;
	}
	return result;
}

/** Counts what a forgotten `invalidate()` most likely changed: visibility and materials. */
function sceneStamp(scene: THREE.Scene): number {
	let stamp = 0;
	scene.traverseVisible((object) => {
		stamp += 1;
		const { material } = object as Partial<THREE.Mesh>;
		for (const each of Array.isArray(material) ? material : material ? [material] : []) {
			stamp += each.version * 31;
		}
	});
	return stamp;
}

export interface IdleRefiner {
	/** Something changed: drop the average, and wait for the camera to settle again. */
	reset(now: number): void;
	/** The camera moved this frame, after `deltaMs`. */
	moving(deltaMs: number): void;
	/** Whether the next frame should be a refinement instead of nothing. */
	wants(now: number): boolean;
	/** Draws one refinement and shows the average so far. */
	step(camera: THREE.Camera): void;
	/** Puts the finished average back on the canvas. False if there is none. */
	present(): boolean;
	/** True once the average is finished and the scene hasn't changed under it. */
	isHolding(): boolean;
}

/**
 * Softens the picture while nothing moves. Each frame moves the camera by under a pixel and every
 * light within its real size, and the average of those frames has true penumbras and clean edges at
 * no cost to orbiting. The averaged image would be lost to the render loop's safety repaint, so
 * while it holds, that repaint only checks whether the scene changed.
 *
 * It also keeps orbiting smooth on a slow GPU. Once frames run over `lightOrbitFrameMs`, ambient
 * occlusion fades out while the camera moves and back in as it rests. Decided once, so a machine
 * near the limit doesn't flip between the two, and a fast one never sees it.
 */
export function createIdleRefiner(params: {
	scene: THREE.Scene;
	renderer: THREE.WebGLRenderer;
	getPipeline: () => RenderPipeline | null;
	frames: number;
	lightOrbitFrameMs: number;
	jitterLights: (index: number) => void;
	restoreLights: () => void;
}): IdleRefiner {
	const { scene, renderer, getPipeline, frames, lightOrbitFrameMs, jitterLights, restoreLights } =
		params;

	let index = 0;
	let changedAt = 0;
	let stamp = 0;
	const size = new THREE.Vector2();

	// Fading back in needs the refine frames, so without them AO stays on.
	let lightOrbit = frames > 0 && lightOrbitFrameMs <= 0;
	let aoWeight = 1;
	const orbitSamples: number[] = [];
	const setAoWeight = (weight: number) => {
		aoWeight = Math.min(1, Math.max(0, weight));
		getPipeline()?.setAoWeight(aoWeight);
	};
	const measureOrbit = (deltaMs: number) => {
		orbitSamples.push(deltaMs);
		if (orbitSamples.length < ORBIT_SAMPLES) return;
		orbitSamples.sort((a, b) => a - b);
		lightOrbit = orbitSamples[ORBIT_SAMPLES >> 1]! > lightOrbitFrameMs;
		orbitSamples.length = 0;
	};

	const jitterCamera = (camera: THREE.Camera, sample: number) => {
		const lens = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
		if (!lens.setViewOffset) return;
		renderer.getDrawingBufferSize(size);
		const x = sample ? halton(sample, 2) - 0.5 : 0;
		const y = sample ? halton(sample, 3) - 0.5 : 0;
		lens.setViewOffset(size.x, size.y, x, y, size.x, size.y);
	};

	return {
		reset: (now) => {
			index = 0;
			changedAt = now;
		},
		moving: (deltaMs) => {
			if (frames === 0) return;
			if (lightOrbit) setAoWeight(aoWeight - 1 / AO_FADE_FRAMES);
			else measureOrbit(deltaMs);
		},
		wants: (now) =>
			(index < frames || aoWeight < 1) && now - changedAt >= SETTLE_MS && !!getPipeline(),
		step: (camera) => {
			const pipeline = getPipeline();
			if (!pipeline) return;
			if (aoWeight < 1) {
				// Shown as it fades, and left out of the average, which should only hold the full picture.
				setAoWeight(aoWeight + 1 / AO_FADE_FRAMES);
				pipeline.setCamera(camera);
				pipeline.accumulate(0);
				return;
			}
			// Frame 0 is the picture already on screen, so the average starts without a jump.
			if (index > 0) jitterLights(index);
			jitterCamera(camera, index);
			pipeline.setCamera(camera);
			pipeline.accumulate(index);
			(camera as THREE.PerspectiveCamera).clearViewOffset?.();
			if (index > 0) restoreLights();
			index += 1;
			if (index === frames) stamp = sceneStamp(scene);
		},
		present: () => {
			if (frames === 0 || index < frames) return false;
			getPipeline()?.presentAccumulated();
			return !!getPipeline();
		},
		isHolding: () => frames > 0 && index >= frames && !!getPipeline() && stamp === sceneStamp(scene)
	};
}
