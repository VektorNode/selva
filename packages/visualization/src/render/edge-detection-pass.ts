import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Screen-space edge detection (Roberts cross on depth + normal discontinuities), O(pixels)
 * regardless of triangle count. Fallback for meshes too heavy for geometry edge overlays
 * (over `EdgeOptions.maxTriangles`): uniform pixel width, one global color, view-dependent,
 * gentle creases below the normal threshold don't register.
 */
export interface EdgeDetectionOptions {
	color?: THREE.ColorRepresentation;
	opacity?: number;
	/** Summed `1 - dot(n₁, n₂)` across the two diagonal pairs. Lower catches gentler creases. */
	normalThreshold?: number;
	/** Relative view-depth discontinuity, fraction of center depth. */
	depthThreshold?: number;
	/** Sample offset in device px — line thickness. */
	thickness?: number;
}

const EDGE_SHADER = {
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		tNormal: { value: null as THREE.Texture | null },
		tDepth: { value: null as THREE.Texture | null },
		uResolution: { value: new THREE.Vector2(1, 1) },
		uColor: { value: new THREE.Color(0x222222) },
		uOpacity: { value: 1 },
		uNormalThreshold: { value: 0.4 },
		uDepthThreshold: { value: 0.02 },
		uThickness: { value: 1 },
		uNear: { value: 0.1 },
		uFar: { value: 1000 },
		uPerspective: { value: 1 }
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform sampler2D tNormal;
		uniform sampler2D tDepth;
		uniform vec2 uResolution;
		uniform vec3 uColor;
		uniform float uOpacity;
		uniform float uNormalThreshold;
		uniform float uDepthThreshold;
		uniform float uThickness;
		uniform float uNear;
		uniform float uFar;
		uniform float uPerspective;
		varying vec2 vUv;

		float viewZOf(const in float depth) {
			float perspective = (uNear * uFar) / ((uFar - uNear) * depth - uFar);
			float orthographic = -(depth * (uFar - uNear) + uNear);
			return mix(orthographic, perspective, uPerspective);
		}

		void main() {
			vec4 color = texture2D(tDiffuse, vUv);
			vec2 texel = uThickness / uResolution;

			vec2 offsetA = vec2(texel.x, texel.y);
			vec2 offsetB = vec2(texel.x, -texel.y);

			float z0 = viewZOf(texture2D(tDepth, vUv + offsetA).x);
			float z1 = viewZOf(texture2D(tDepth, vUv - offsetA).x);
			float z2 = viewZOf(texture2D(tDepth, vUv + offsetB).x);
			float z3 = viewZOf(texture2D(tDepth, vUv - offsetB).x);
			float zCenter = viewZOf(texture2D(tDepth, vUv).x);
			// Normalized by center depth, not absolute Z: keeps the response scale-invariant (an
			// absolute threshold would be noise far away, blind up close).
			float depthDelta = (abs(z0 - z1) + abs(z2 - z3)) / max(abs(zCenter), 1e-6);
			float depthEdge = step(uDepthThreshold, depthDelta);

			vec3 n0 = texture2D(tNormal, vUv + offsetA).rgb * 2.0 - 1.0;
			vec3 n1 = texture2D(tNormal, vUv - offsetA).rgb * 2.0 - 1.0;
			vec3 n2 = texture2D(tNormal, vUv + offsetB).rgb * 2.0 - 1.0;
			vec3 n3 = texture2D(tNormal, vUv - offsetB).rgb * 2.0 - 1.0;
			float normalDelta = (1.0 - dot(n0, n1)) + (1.0 - dot(n2, n3));
			float normalEdge = step(uNormalThreshold, normalDelta);

			float edge = max(depthEdge, normalEdge) * uOpacity;
			gl_FragColor = vec4(mix(color.rgb, uColor, edge), color.a);
		}
	`
};

export class EdgeDetectionPass extends Pass {
	camera: THREE.Camera;

	private readonly scene: THREE.Scene;
	private readonly normalMaterial: THREE.MeshNormalMaterial;
	private readonly edgeMaterial: THREE.ShaderMaterial;
	private readonly fsQuad: FullScreenQuad;
	private normalTarget: THREE.WebGLRenderTarget | null = null;
	private width: number;
	private height: number;

	constructor(
		scene: THREE.Scene,
		camera: THREE.Camera,
		width: number,
		height: number,
		options: EdgeDetectionOptions = {}
	) {
		super();
		this.scene = scene;
		this.camera = camera;
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);

		this.normalMaterial = new THREE.MeshNormalMaterial();
		this.normalMaterial.blending = THREE.NoBlending;

		this.edgeMaterial = new THREE.ShaderMaterial({
			uniforms: THREE.UniformsUtils.clone(EDGE_SHADER.uniforms),
			vertexShader: EDGE_SHADER.vertexShader,
			fragmentShader: EDGE_SHADER.fragmentShader
		});
		const uniforms = this.edgeMaterial.uniforms;
		uniforms.uColor.value = new THREE.Color(options.color ?? 0x222222);
		uniforms.uOpacity.value = options.opacity ?? 1;
		uniforms.uNormalThreshold.value = options.normalThreshold ?? 0.4;
		uniforms.uDepthThreshold.value = options.depthThreshold ?? 0.02;
		uniforms.uThickness.value = options.thickness ?? 1;

		this.fsQuad = new FullScreenQuad(this.edgeMaterial);
		this.needsSwap = true;
	}

	private acquireNormalTarget(): THREE.WebGLRenderTarget {
		if (!this.normalTarget) {
			const depthTexture = new THREE.DepthTexture(this.width, this.height);
			this.normalTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				depthTexture
			});
		}
		return this.normalTarget;
	}

	override setSize(width: number, height: number): void {
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		this.normalTarget?.setSize(this.width, this.height);
	}

	override render(
		renderer: THREE.WebGLRenderer,
		writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget
	): void {
		const normalTarget = this.acquireNormalTarget();

		// --- Normals + depth prepass (override material) ---
		const previousTarget = renderer.getRenderTarget();
		const previousAutoClear = renderer.autoClear;
		const previousClearColor = renderer.getClearColor(new THREE.Color());
		const previousClearAlpha = renderer.getClearAlpha();
		const previousOverride = this.scene.overrideMaterial;

		renderer.setRenderTarget(normalTarget);
		// 0x7777ff is packed +Z: background pixels get a uniform normal, so only depth silhouettes
		// (not normal noise) separate objects from empty space.
		renderer.setClearColor(0x7777ff, 1);
		renderer.autoClear = true;
		this.scene.overrideMaterial = this.normalMaterial;
		renderer.render(this.scene, this.camera);
		this.scene.overrideMaterial = previousOverride;
		renderer.setClearColor(previousClearColor, previousClearAlpha);
		renderer.autoClear = previousAutoClear;

		// --- Edge composite ---
		const uniforms = this.edgeMaterial.uniforms;
		uniforms.tDiffuse.value = readBuffer.texture;
		uniforms.tNormal.value = normalTarget.texture;
		uniforms.tDepth.value = normalTarget.depthTexture;
		uniforms.uResolution.value.set(this.width, this.height);
		const perspective = this.camera as Partial<THREE.PerspectiveCamera>;
		uniforms.uPerspective.value = perspective.isPerspectiveCamera ? 1 : 0;
		uniforms.uNear.value = (this.camera as THREE.PerspectiveCamera).near ?? 0.1;
		uniforms.uFar.value = (this.camera as THREE.PerspectiveCamera).far ?? 1000;

		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		this.fsQuad.render(renderer);
		renderer.setRenderTarget(previousTarget);
	}

	override dispose(): void {
		this.normalTarget?.dispose();
		this.normalMaterial.dispose();
		this.edgeMaterial.dispose();
		this.fsQuad.dispose();
	}
}
