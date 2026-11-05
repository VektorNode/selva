import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { hideGlass } from '../shared/index.js';
import type { BloomOptions } from '../shared/types.js';

import { EdgeDetectionPass, type EdgeDetectionOptions } from './edge-detection-pass';

/**
 * Pipeline: RenderPass → GTAOPass? → BloomPass? → EdgeDetectionPass? → SMAAPass → OutputPass. Bloom
 * sits before OutputPass because it needs linear HDR values: tone mapping would clamp the emissive
 * highlights it keys on. EdgeDetectionPass sits before SMAA so its 1px lines get antialiased. EffectComposer renders offscreen, where the
 * canvas's own MSAA never applies, so the scene target carries its own (see {@link msaaSamplesFor});
 * SMAA then smooths what MSAA leaves, the edge pass's lines included. SMAA over TAA because TAA's
 * temporal jitter smears during OrbitControls drags. OutputPass applies tone mapping and color
 * space last, so SMAA operates on the pre-tonemapped image.
 */

export interface RenderPipeline {
	render(deltaTime: number): void;
	setSize(width: number, height: number, pixelRatio: number): void;
	/** Call when the camera's projection changes (e.g. perspective↔ortho). */
	setCamera(camera: THREE.Camera): void;
	setEdgeDetection(enabled: boolean): void;
	edgeDetectionEnabled(): boolean;
	/** Draws a frame into the running average, then shows the average. Index 0 starts a new one. */
	accumulate(index: number): void;
	/** Shows the running average without drawing. */
	presentAccumulated(): void;
	/** Scales ambient occlusion live, 0 skipping the pass: no rebuild, so it can change every frame. */
	setAoWeight(weight: number): void;
	dispose(): void;
}

export interface RenderPipelineOptions {
	/** Must mirror the renderer's own tone mapping — OutputPass applies it once composited, not the renderer. */
	toneMapping: THREE.ToneMapping;
	toneMappingExposure: number;
	/** Default true. */
	ambientOcclusion?: boolean;
	/** AO strength 0–1. Default 1. */
	aoIntensity?: number;
	/** DPR cap for the AO buffers only; the scene itself renders at the full pixel ratio. Default 1. */
	aoPixelRatio?: number;
	/** Omitted: no bloom pass at all. */
	bloom?: BloomOptions;
	/** Start with the screen-space edge pass enabled; pass an object to tune it. */
	edgeDetection?: boolean | EdgeDetectionOptions;
}

/**
 * A highlight beside a point light overflows the half-float target to infinity, and bloom's blur
 * turns that one pixel into NaN across the whole frame: the viewer goes blank. Clamping first keeps
 * a hot pixel hot without letting it reach the blur.
 */
const HDR_CLAMP_SHADER = {
	name: 'HdrClamp',
	uniforms: { tDiffuse: { value: null } },
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		varying vec2 vUv;
		const float MAX_RADIANCE = 64.0;
		float safe(float v) {
			return isnan(v) ? 0.0 : clamp(v, 0.0, MAX_RADIANCE);
		}
		void main() {
			vec4 color = texture2D(tDiffuse, vUv);
			gl_FragColor = vec4(safe(color.r), safe(color.g), safe(color.b), color.a);
		}`
};

const AVERAGE_SHADER = {
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = vec4(position.xy, 0.0, 1.0);
		}`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tFrame;
		varying vec2 vUv;
		void main() {
			gl_FragColor = texture2D(tFrame, vUv);
		}`
};

/**
 * Keeps the running average of the composer's finished frames. They're already tone mapped, which
 * suits what gets averaged here: shadows and edges, not HDR highlights. Half float, because 32
 * frames blended into 8 bits would band in a soft shadow.
 */
function createAccumulator(renderer: THREE.WebGLRenderer) {
	const target = new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.HalfFloatType,
		depthBuffer: false
	});
	const material = new THREE.ShaderMaterial({
		...AVERAGE_SHADER,
		uniforms: { tFrame: { value: null } },
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		blending: THREE.CustomBlending,
		blendSrc: THREE.ConstantAlphaFactor,
		blendDst: THREE.OneMinusConstantAlphaFactor
	});
	const quad = new FullScreenQuad(material);

	const draw = (texture: THREE.Texture, weight: number) => {
		material.uniforms.tFrame.value = texture;
		material.blendAlpha = weight;
		// FullScreenQuad renders through the renderer, whose auto clear would wipe the average.
		const autoClear = renderer.autoClear;
		renderer.autoClear = false;
		quad.render(renderer);
		renderer.autoClear = autoClear;
	};
	const present = () => {
		renderer.setRenderTarget(null);
		draw(target.texture, 1);
	};

	return {
		add: (frame: THREE.Texture, index: number, width: number, height: number) => {
			if (target.width !== width || target.height !== height) target.setSize(width, height);
			renderer.setRenderTarget(target);
			draw(frame, 1 / (index + 1));
			present();
		},
		present,
		dispose: () => {
			target.dispose();
			material.dispose();
			quad.dispose();
		}
	};
}

/**
 * Without MSAA a sub-pixel feature (a sheet's bright hem edge) comes out as a dashed line, which
 * SMAA can't rebuild. At 2× DPR each CSS pixel already holds four samples, and 4× MSAA on top
 * would cost ~250 MB on a 4K target for no visible gain.
 */
function msaaSamplesFor(pixelRatio: number): number {
	return pixelRatio >= 2 ? 0 : 4;
}

// GTAOPass hides points and lines from its depth/normal prepass through this hook; glass joins
// them, or it would occlude, and darken, everything seen through it.
function skipGlass(pass: GTAOPass): void {
	const hooks = pass as unknown as { _overrideVisibility(): void; _restoreVisibility(): void };
	const overrideVisibility = hooks._overrideVisibility.bind(pass);
	const restoreVisibility = hooks._restoreVisibility.bind(pass);
	let showGlass = () => {};
	hooks._overrideVisibility = () => {
		overrideVisibility();
		showGlass = hideGlass(pass.scene);
	};
	hooks._restoreVisibility = () => {
		showGlass();
		restoreVisibility();
	};
}

export function createRenderPipeline(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	width: number,
	height: number,
	options: RenderPipelineOptions
): RenderPipeline {
	// Only the scene target needs samples: RenderPass draws into it, every later pass is a
	// full-screen quad. EffectComposer clones the second from the first, so reset it.
	const sceneTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
	const composer = new EffectComposer(renderer, sceneTarget);
	composer.renderTarget2.samples = 0;

	// RenderPass draws into `readBuffer`, and the composer's buffer swaps carry over between
	// frames. With an odd number of swapping passes the scene would land in the unsampled target
	// every other frame, so point `readBuffer` at the scene target before each frame.
	const renderFrame = (deltaTime: number) => {
		composer.readBuffer = sceneTarget;
		composer.writeBuffer = composer.renderTarget2;
		composer.render(deltaTime);
	};

	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);

	let gtaoPass: GTAOPass | null = null;
	if (options.ambientOcclusion ?? true) {
		gtaoPass = new GTAOPass(scene, camera, width, height);
		gtaoPass.blendIntensity = options.aoIntensity ?? 1;
		gtaoPass.updateGtaoMaterial({ screenSpaceRadius: true });
		skipGlass(gtaoPass);
		composer.addPass(gtaoPass);
	}

	let clampPass: ShaderPass | null = null;
	let bloomPass: UnrealBloomPass | null = null;
	if (options.bloom) {
		const { strength, radius, threshold } = options.bloom;
		clampPass = new ShaderPass(HDR_CLAMP_SHADER);
		composer.addPass(clampPass);
		bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), strength, radius, threshold);
		composer.addPass(bloomPass);
	}

	const edgeOptions = typeof options.edgeDetection === 'object' ? options.edgeDetection : {};
	const edgePass = new EdgeDetectionPass(scene, camera, width, height, edgeOptions);
	edgePass.enabled = !!options.edgeDetection;
	composer.addPass(edgePass);

	const smaaPass = new SMAAPass();
	composer.addPass(smaaPass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	renderer.toneMapping = options.toneMapping;
	renderer.toneMappingExposure = options.toneMappingExposure;

	let accumulator: ReturnType<typeof createAccumulator> | null = null;

	const aoPixelRatioCap = options.aoPixelRatio ?? 1;
	// The composer sizes every pass at the scene's resolution; AO alone is cheap enough to run lower,
	// and its blend samples by UV so it upscales onto the full-resolution frame.
	let aoScale = 1;
	if (gtaoPass) {
		const setAoSize = gtaoPass.setSize.bind(gtaoPass);
		gtaoPass.setSize = (w: number, h: number) =>
			setAoSize(Math.max(1, Math.round(w * aoScale)), Math.max(1, Math.round(h * aoScale)));
	}
	const applyPixelRatio = (pixelRatio: number) => {
		aoScale = Math.min(pixelRatio, aoPixelRatioCap) / pixelRatio;
		const samples = msaaSamplesFor(pixelRatio);
		if (sceneTarget.samples !== samples) {
			sceneTarget.samples = samples;
			sceneTarget.dispose(); // three reallocates on next use; samples alone doesn't trigger it
		}
		composer.setPixelRatio(pixelRatio);
	};
	applyPixelRatio(renderer.getPixelRatio());
	composer.setSize(width, height);

	return {
		render: renderFrame,
		// composer.setSize only — calling individual pass.setSize would reset AO/AA targets back to
		// logical CSS size, undoing the pixel-ratio scaling.
		setSize: (w, h, pixelRatio) => {
			applyPixelRatio(pixelRatio);
			composer.setSize(w, h);
		},
		setCamera: (cam) => {
			renderPass.camera = cam;
			edgePass.camera = cam;
			if (!gtaoPass) return;
			gtaoPass.camera = cam;
			// GTAOPass bakes camera type into its AO shader as a construction-time define; reassigning
			// `camera` alone leaves the old projection's depth reconstruction active — garbage AO after
			// a perspective⇄ortho toggle. Force a recompile when the type actually changes.
			const isPerspective = (cam as Partial<THREE.PerspectiveCamera>).isPerspectiveCamera ? 1 : 0;
			if (gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== isPerspective) {
				gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA = isPerspective;
				gtaoPass.gtaoMaterial.needsUpdate = true;
			}
		},
		setEdgeDetection: (enabled) => {
			edgePass.enabled = enabled;
		},
		edgeDetectionEnabled: () => edgePass.enabled,
		accumulate: (index) => {
			composer.renderToScreen = false;
			renderFrame(0);
			composer.renderToScreen = true;
			accumulator ??= createAccumulator(renderer);
			const { texture, width, height } = composer.readBuffer;
			accumulator.add(texture, index, width, height);
		},
		presentAccumulated: () => accumulator?.present(),
		setAoWeight: (weight) => {
			if (!gtaoPass) return;
			gtaoPass.enabled = weight > 0;
			gtaoPass.blendIntensity = (options.aoIntensity ?? 1) * weight;
		},
		// composer.dispose() doesn't free passes.
		dispose: () => {
			composer.dispose();
			accumulator?.dispose();
			gtaoPass?.dispose();
			clampPass?.dispose();
			bloomPass?.dispose();
			edgePass.dispose();
			smaaPass.dispose();
			outputPass.dispose();
		}
	};
}
