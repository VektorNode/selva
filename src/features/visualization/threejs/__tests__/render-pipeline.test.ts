import * as THREE from 'three';
import type { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRenderPipeline } from '../render-pipeline';

// Track every GTAOPass the pipeline constructs so tests can assert on its internals (the pipeline
// deliberately doesn't expose its passes). The real class is used — behavior is not mocked.
const gtaoInstances = vi.hoisted(() => [] as unknown[]);
vi.mock('three/addons/postprocessing/GTAOPass.js', async (importOriginal) => {
	const mod = await importOriginal<typeof import('three/addons/postprocessing/GTAOPass.js')>();
	class TrackedGTAOPass extends mod.GTAOPass {
		constructor(...args: ConstructorParameters<typeof mod.GTAOPass>) {
			super(...args);
			gtaoInstances.push(this);
		}
	}
	return { ...mod, GTAOPass: TrackedGTAOPass };
});

// SMAAPass decodes its lookup textures via `new Image()`; give node a minimal stand-in. No GL is
// touched until render(), which these tests never call.
class FakeImage {
	src = '';
	onload: (() => void) | null = null;
}

// EffectComposer only needs size/pixel-ratio from the renderer at construction; rendering is never
// exercised here, so a stub keeps the test environment 'node' (no WebGL context).
function stubRenderer(): THREE.WebGLRenderer {
	return {
		getPixelRatio: () => 1,
		getSize: (target: THREE.Vector2) => target.set(800, 600),
		toneMapping: THREE.NoToneMapping,
		toneMappingExposure: 1
	} as unknown as THREE.WebGLRenderer;
}

function makePipeline(camera: THREE.Camera, aoPixelRatio?: number) {
	const scene = new THREE.Scene();
	const pipeline = createRenderPipeline(stubRenderer(), scene, camera, 800, 600, {
		toneMapping: THREE.NeutralToneMapping,
		toneMappingExposure: 1,
		aoPixelRatio
	});
	const gtaoPass = gtaoInstances[gtaoInstances.length - 1] as GTAOPass;
	return { pipeline, gtaoPass };
}

beforeAll(() => {
	vi.stubGlobal('Image', FakeImage);
});

afterAll(() => {
	vi.unstubAllGlobals();
});

beforeEach(() => {
	gtaoInstances.length = 0;
});

describe('render pipeline GTAO camera swap (issue 5)', () => {
	it('bakes the perspective define at construction', () => {
		const { gtaoPass } = makePipeline(new THREE.PerspectiveCamera(20, 1, 0.1, 100));
		expect(gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA).toBe(1);
	});

	it('refreshes the PERSPECTIVE_CAMERA define and recompiles when swapping to ortho and back', () => {
		const perspective = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
		const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
		const { pipeline, gtaoPass } = makePipeline(perspective);

		const versionBefore = gtaoPass.gtaoMaterial.version;
		pipeline.setCamera(ortho);
		expect(gtaoPass.camera).toBe(ortho);
		expect(gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA).toBe(0);
		// needsUpdate was flagged so the shader recompiles with the new define.
		expect(gtaoPass.gtaoMaterial.version).toBe(versionBefore + 1);

		pipeline.setCamera(perspective);
		expect(gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA).toBe(1);
		expect(gtaoPass.gtaoMaterial.version).toBe(versionBefore + 2);
	});

	it('does not force a shader recompile when the camera type is unchanged', () => {
		const perspective = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
		const other = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		const { pipeline, gtaoPass } = makePipeline(perspective);

		const versionBefore = gtaoPass.gtaoMaterial.version;
		pipeline.setCamera(other);
		expect(gtaoPass.camera).toBe(other);
		expect(gtaoPass.gtaoMaterial.version).toBe(versionBefore);
	});
});

describe('render pipeline sizing (issues 1/7)', () => {
	it('caps the AO pixel ratio at 1 by default (AO buffers stay at CSS size, not display DPR)', () => {
		const { pipeline, gtaoPass } = makePipeline(new THREE.PerspectiveCamera(20, 1, 0.1, 100));

		// Display DPR 2, but AO defaults to a 1× cap — GTAO renders at logical size, not 4× the pixels.
		pipeline.setSize(400, 300, 2);

		expect(gtaoPass.width).toBe(400);
		expect(gtaoPass.height).toBe(300);
		expect(gtaoPass.gtaoRenderTarget.width).toBe(400);
		expect(gtaoPass.gtaoRenderTarget.height).toBe(300);
	});

	it('an explicit aoPixelRatio raises the AO buffer resolution (still capped, not knocked to CSS)', () => {
		const { pipeline, gtaoPass } = makePipeline(new THREE.PerspectiveCamera(20, 1, 0.1, 100), 2);

		pipeline.setSize(400, 300, 2);

		// Cap of 2 with display DPR 2 → full-resolution AO buffers, propagated to every pass.
		expect(gtaoPass.width).toBe(800);
		expect(gtaoPass.height).toBe(600);
		expect(gtaoPass.gtaoRenderTarget.width).toBe(800);
		expect(gtaoPass.gtaoRenderTarget.height).toBe(600);
	});

	it('the AO cap never upsamples beyond the incoming pixel ratio', () => {
		// aoPixelRatio 2 but display DPR 1 → clamp to 1, no upsampling.
		const { pipeline, gtaoPass } = makePipeline(new THREE.PerspectiveCamera(20, 1, 0.1, 100), 2);

		pipeline.setSize(400, 300, 1);

		expect(gtaoPass.width).toBe(400);
		expect(gtaoPass.height).toBe(300);
	});
});
