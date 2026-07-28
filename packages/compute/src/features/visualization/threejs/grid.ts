import * as THREE from 'three';

/**
 * An "infinite", distance-fading reference grid — the single strongest visual cue that reads as CAD.
 *
 * Why not `GridHelper`: it's a fixed-size square of line segments that visibly ends and looks wrong
 * once you pan or zoom past it. Instead we draw one large screen-facing plane and compute the grid
 * in the fragment shader from world coordinates, fading lines out with distance so the edge is never
 * a hard cutoff. The plane is big enough to cover any reasonable view; the fade hides its bounds.
 *
 * Two line frequencies (minor + major every 10th) give the usual graph-paper depth read. Spacing is
 * in world units (meters — the scene's normalized unit), so a `cellSize` of 1 = 1m minor cells.
 */

export interface GridOptions {
	/** Minor cell size in world units (meters). Default 1. */
	cellSize?: number;
	/** How many minor cells per major line. Default 10. */
	majorEvery?: number;
	/** Minor line color. */
	cellColor?: THREE.ColorRepresentation;
	/** Major line color. */
	majorColor?: THREE.ColorRepresentation;
	/** World-space radius at which the grid has fully faded out. Default 100. */
	fadeDistance?: number;
	/**
	 * Axis the grid is laid perpendicular to — i.e. the scene's up axis. `'z'` is the horizontal
	 * ground in the Rhino Z-up frame the viewer uses; `'y'` is Three's native Y-up.
	 *
	 * This standalone default is `'y'`, but `initThree` always passes a plane derived from the
	 * configured `sceneUp`, so a viewer-created grid defaults to `'z'`.
	 */
	plane?: 'x' | 'y' | 'z';
}

export interface Grid {
	/** The grid mesh; add to the scene. Tagged `userData.id = 'grid'` so pick/fit code skips it. */
	readonly object: THREE.Mesh;
	/** Keep the fade centered on the camera so the grid feels infinite as you move. Call per frame. */
	update(cameraPosition: THREE.Vector3): void;
	/**
	 * Rescale the grid's cell spacing and fade radius to the loaded content's extent. Call after a
	 * geometry change (e.g. right after `updateScene`) so a part that is 3 units or 3000 units wide
	 * both get sensibly-sized cells and a fade that reaches past the model. No-op for empty/degenerate
	 * bounds — the grid keeps its last (or default) scale. See {@link Grid.fitToContent}'s impl notes.
	 */
	fitToContent(bounds: THREE.Box3): void;
	setVisible(visible: boolean): void;
	dispose(): void;
}

/**
 * Round a value to a "nice" 1/2/5 × 10ⁿ step — the spacing conventions used by rulers and CAD grids,
 * so cells land on human-readable multiples (…, 0.5, 1, 2, 5, 10, 20, 50, …) rather than arbitrary
 * fractions like 1.37. Returns the largest nice step ≤ `value` (floored on the mantissa) so cells
 * never come out finer than the target and alias into a solid sheet.
 */
function niceStep(value: number): number {
	if (!(value > 0) || !Number.isFinite(value)) return 1;
	const exponent = Math.floor(Math.log10(value));
	const power = Math.pow(10, exponent);
	const mantissa = value / power; // in [1, 10)
	const niceMantissa = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
	return niceMantissa * power;
}

const GRID_VERTEX = /* glsl */ `
	varying vec3 vWorldPos;
	void main() {
		vec4 world = modelMatrix * vec4(position, 1.0);
		vWorldPos = world.xyz;
		gl_Position = projectionMatrix * viewMatrix * world;
	}
`;

const GRID_FRAGMENT = /* glsl */ `
	precision highp float;
	varying vec3 vWorldPos;

	uniform vec2 uAxes;         // indices (0=x,1=y,2=z) of the two in-plane world axes
	uniform float uCell;
	uniform float uMajor;
	uniform vec3 uCellColor;
	uniform vec3 uMajorColor;
	uniform vec3 uCenter;       // fade center (camera position), projected onto plane
	uniform float uFade;

	// Antialiased grid line intensity for a given spacing, using screen-space derivatives so lines
	// stay ~1px regardless of zoom (the standard "pristine grid" technique).
	float gridLine(vec2 coord, float spacing) {
		vec2 c = coord / spacing;
		vec2 d = fwidth(c);
		vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, 1e-6);
		float line = min(g.x, g.y);
		return 1.0 - clamp(line, 0.0, 1.0);
	}

	// Index a vec3 by a float axis id (0/1/2) without dynamic indexing (WebGL1-safe).
	float axis(vec3 v, float i) {
		return i < 0.5 ? v.x : (i < 1.5 ? v.y : v.z);
	}

	void main() {
		// Pick the two in-plane world coordinates.
		vec2 coord = vec2(axis(vWorldPos, uAxes.x), axis(vWorldPos, uAxes.y));

		float minor = gridLine(coord, uCell);
		float major = gridLine(coord, uCell * uMajor);

		vec3 color = mix(uCellColor, uMajorColor, major);
		float alpha = max(minor, major);

		// Radial fade from the camera-projected center.
		float dist = distance(vWorldPos, uCenter);
		float fade = 1.0 - clamp(dist / uFade, 0.0, 1.0);
		alpha *= fade * fade;

		if (alpha < 0.001) discard;
		gl_FragColor = vec4(color, alpha);
	}
`;

export function createGrid(options: GridOptions = {}): Grid {
	const {
		cellSize = 1,
		majorEvery = 10,
		cellColor = 0x888888,
		majorColor = 0x444444,
		fadeDistance = 100,
		plane = 'y'
	} = options;

	// The two in-plane world axes (0=x,1=y,2=z): ground 'y' grids over x,z; 'z' over x,y; 'x' over y,z.
	const axes =
		plane === 'y'
			? new THREE.Vector2(0, 2) // x, z
			: plane === 'z'
				? new THREE.Vector2(0, 1) // x, y
				: new THREE.Vector2(1, 2); // y, z

	// The plane must comfortably outreach the fade radius, else the grid ends before it has faded and
	// shows a hard rectangular edge. Built as a unit plane and sized purely by scale so fitToContent
	// can regrow it without recreating geometry — the same rotation onto the world plane still applies.
	const PLANE_TO_FADE_RATIO = 2.5;
	const geometry = new THREE.PlaneGeometry(1, 1);

	// PlaneGeometry is in the XY plane by default; rotate it onto the requested world plane.
	if (plane === 'y') geometry.rotateX(-Math.PI / 2);
	else if (plane === 'x') geometry.rotateY(Math.PI / 2);

	const material = new THREE.ShaderMaterial({
		vertexShader: GRID_VERTEX,
		fragmentShader: GRID_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		uniforms: {
			uAxes: { value: axes },
			uCell: { value: cellSize },
			uMajor: { value: majorEvery },
			uCellColor: { value: new THREE.Color(cellColor) },
			uMajorColor: { value: new THREE.Color(majorColor) },
			uCenter: { value: new THREE.Vector3() },
			uFade: { value: fadeDistance }
		}
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = 'grid';
	mesh.userData.id = 'grid'; // excluded from raycasting/fit-to-view, like the floor
	mesh.renderOrder = -1; // draw before content so transparent geometry blends over it

	// Live scale of the (unit) plane and current fade radius; fitToContent mutates both, `update`
	// reads planeScale each frame to size the camera-tracking plane. Seeded from the constructor's
	// fadeDistance so an un-fitted grid still covers its fade.
	let fadeRadius = fadeDistance;
	let planeScale = fadeDistance * PLANE_TO_FADE_RATIO;

	const center = new THREE.Vector3();

	return {
		object: mesh,
		update: (cameraPosition) => {
			// Re-center the plane and the fade on the camera so the grid tracks the view "infinitely".
			// Keep the plane's own axis fixed (don't lift the ground grid up to the camera height).
			if (plane === 'y') {
				mesh.position.set(cameraPosition.x, 0, cameraPosition.z);
				center.set(cameraPosition.x, 0, cameraPosition.z);
			} else if (plane === 'z') {
				mesh.position.set(cameraPosition.x, cameraPosition.y, 0);
				center.set(cameraPosition.x, cameraPosition.y, 0);
			} else {
				mesh.position.set(0, cameraPosition.y, cameraPosition.z);
				center.set(0, cameraPosition.y, cameraPosition.z);
			}
			material.uniforms.uCenter.value.copy(center);
			// Size the unit plane to the current scale. The rotation baked into the geometry means the
			// plane's local XY spans the two world in-plane axes, so a uniform scale is correct on any
			// plane orientation.
			mesh.scale.setScalar(planeScale);
		},
		fitToContent: (bounds) => {
			if (bounds.isEmpty()) return;
			// Use the two in-plane axes' extent (not the full 3D diagonal) as the "how big is this on
			// the ground" measure — a tall thin part shouldn't blow the cell size up by its height.
			const sizeVec = bounds.getSize(new THREE.Vector3());
			const axisComponent = (v: THREE.Vector3, i: number) => (i === 0 ? v.x : i === 1 ? v.y : v.z);
			const inPlaneExtent = Math.max(
				axisComponent(sizeVec, axes.x),
				axisComponent(sizeVec, axes.y)
			);
			if (!(inPlaneExtent > 0) || !Number.isFinite(inPlaneExtent)) return;

			// Aim for ~20 minor cells across the part, snapped to a nice 1/2/5 step so labels stay
			// readable; majorEvery keeps the coarser reference lines. Fade reaches ~2× past the part so
			// the grid extends beyond it without a visible edge, and the plane outreaches the fade.
			const TARGET_CELLS_ACROSS = 20;
			material.uniforms.uCell.value = niceStep(inPlaneExtent / TARGET_CELLS_ACROSS);
			fadeRadius = inPlaneExtent * 2;
			material.uniforms.uFade.value = fadeRadius;
			planeScale = fadeRadius * PLANE_TO_FADE_RATIO;
		},
		setVisible: (visible) => {
			mesh.visible = visible;
		},
		dispose: () => {
			mesh.removeFromParent(); // don't leave a dead mesh in the scene graph
			geometry.dispose();
			material.dispose();
		}
	};
}
