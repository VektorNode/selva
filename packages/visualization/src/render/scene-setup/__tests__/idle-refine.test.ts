import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import type { RenderPipeline } from '../../render-pipeline.js';
import { createIdleRefiner, halton } from '../idle-refine.js';

function setup(frames = 3, withPipeline = true, lightOrbitFrameMs = 22) {
	const scene = new THREE.Scene();
	const pipeline = {
		setCamera: vi.fn(),
		accumulate: vi.fn(),
		presentAccumulated: vi.fn(),
		setAoWeight: vi.fn()
	};
	const jitterLights = vi.fn();
	const restoreLights = vi.fn();
	const refiner = createIdleRefiner({
		scene,
		renderer: {
			getDrawingBufferSize: (size: THREE.Vector2) => size.set(100, 100)
		} as unknown as THREE.WebGLRenderer,
		getPipeline: () => (withPipeline ? (pipeline as unknown as RenderPipeline) : null),
		frames,
		lightOrbitFrameMs,
		jitterLights,
		restoreLights
	});
	return { scene, pipeline, refiner, jitterLights, restoreLights };
}

describe('halton', () => {
	it('fills the range evenly', () => {
		expect([1, 2, 3].map((i) => halton(i, 2))).toEqual([0.5, 0.25, 0.75]);
	});
});

describe('createIdleRefiner', () => {
	it('waits for the camera to settle', () => {
		const { refiner } = setup();
		refiner.reset(1000);

		expect(refiner.wants(1050)).toBe(false);
		expect(refiner.wants(1200)).toBe(true);
	});

	it('starts from the unjittered picture, so the average begins without a jump', () => {
		const { refiner, jitterLights, pipeline } = setup();
		const camera = new THREE.PerspectiveCamera();

		refiner.step(camera);

		expect(jitterLights).not.toHaveBeenCalled();
		expect(pipeline.accumulate).toHaveBeenCalledWith(0);
	});

	it('jitters lights after the first frame and always puts them and the camera back', () => {
		const { refiner, jitterLights, restoreLights } = setup();
		const camera = new THREE.PerspectiveCamera();
		const projection = camera.projectionMatrix.clone();

		refiner.step(camera);
		refiner.step(camera);

		expect(jitterLights).toHaveBeenCalledWith(1);
		expect(restoreLights).toHaveBeenCalledTimes(1);
		expect(camera.view?.enabled).toBe(false);
		expect(camera.projectionMatrix.equals(projection)).toBe(true);
	});

	it('stops at the frame count and holds until the scene changes', () => {
		const { refiner, scene } = setup(2);
		const camera = new THREE.PerspectiveCamera();
		refiner.reset(0);
		refiner.step(camera);
		expect(refiner.isHolding()).toBe(false);
		refiner.step(camera);

		expect(refiner.wants(1000)).toBe(false);
		expect(refiner.isHolding()).toBe(true);

		scene.add(new THREE.Mesh());
		expect(refiner.isHolding()).toBe(false);
	});

	it('starts over after a change', () => {
		const { refiner, pipeline } = setup(1);
		const camera = new THREE.PerspectiveCamera();
		refiner.step(camera);

		refiner.reset(0);

		expect(refiner.isHolding()).toBe(false);
		expect(refiner.present()).toBe(false);
		refiner.step(camera);
		expect(pipeline.accumulate).toHaveBeenLastCalledWith(0);
	});

	it('does nothing without a composer', () => {
		const { refiner } = setup(3, false);
		refiner.reset(0);

		expect(refiner.wants(1000)).toBe(false);
		expect(refiner.isHolding()).toBe(false);
	});

	it('is off at zero frames', () => {
		const { refiner } = setup(0);
		refiner.reset(0);

		expect(refiner.wants(1000)).toBe(false);
		expect(refiner.isHolding()).toBe(false);
	});

	describe('light orbit', () => {
		const orbit = (refiner: ReturnType<typeof setup>['refiner'], ms: number, frames: number) => {
			for (let i = 0; i < frames; i++) refiner.moving(ms);
		};

		it('leaves a fast machine alone', () => {
			const { refiner, pipeline } = setup();

			orbit(refiner, 8, 100);

			expect(pipeline.setAoWeight).not.toHaveBeenCalled();
		});

		it('fades ambient occlusion out step by step on a slow one, never in one jump', () => {
			const { refiner, pipeline } = setup();

			orbit(refiner, 30, 13);

			expect(pipeline.setAoWeight).toHaveBeenLastCalledWith(7 / 8);
			orbit(refiner, 30, 7);
			expect(pipeline.setAoWeight).toHaveBeenLastCalledWith(0);
		});

		it('ignores a single hitch', () => {
			const { refiner, pipeline } = setup();

			refiner.moving(400);
			orbit(refiner, 8, 11);

			orbit(refiner, 8, 1);
			expect(pipeline.setAoWeight).not.toHaveBeenCalled();
		});

		it('fades back in when the camera rests, before averaging starts', () => {
			const { refiner, pipeline } = setup(2, true, 0);
			const camera = new THREE.PerspectiveCamera();
			orbit(refiner, 30, 8);
			refiner.reset(0);

			expect(refiner.wants(1000)).toBe(true);
			for (let i = 0; i < 8; i++) refiner.step(camera);

			expect(pipeline.setAoWeight).toHaveBeenLastCalledWith(1);
			expect(pipeline.accumulate).toHaveBeenCalledTimes(8);
			refiner.step(camera);
			refiner.step(camera);
			expect(refiner.isHolding()).toBe(true);
		});

		it('stays on with no refine frames to fade it back in', () => {
			const { refiner, pipeline } = setup(0, true, 0);

			orbit(refiner, 30, 20);

			expect(pipeline.setAoWeight).not.toHaveBeenCalled();
		});
	});

	it('has nothing to present at zero frames, or a capture would come back blank', () => {
		const { refiner, pipeline } = setup(0);

		expect(refiner.present()).toBe(false);
		expect(pipeline.presentAccumulated).not.toHaveBeenCalled();
	});
});
