import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildUpBasis, environmentRotationFor, isoOffset, sunOffset, upToAxis } from '../up-axis';

const Z_UP = new THREE.Vector3(0, 0, 1);
const Y_UP = new THREE.Vector3(0, 1, 0);

describe('buildUpBasis', () => {
	it('Z-up: forward is +Y and right is +X, matching Rhino Front/Right views', () => {
		const { up, forward, right } = buildUpBasis(Z_UP);

		expect(up.toArray()).toEqual([0, 0, 1]);
		// Rhino's Front view LOOKS along +Y (camera sits at -Y).
		expect(forward.dot(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0.99);
		expect(right.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0.99);
	});

	it('returns an orthonormal right-handed frame for any up axis', () => {
		for (const up of [Z_UP, Y_UP, new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 1, 1)]) {
			const basis = buildUpBasis(up);

			expect(basis.up.length()).toBeCloseTo(1, 6);
			expect(basis.forward.length()).toBeCloseTo(1, 6);
			expect(basis.right.length()).toBeCloseTo(1, 6);

			// Mutually perpendicular.
			expect(basis.up.dot(basis.forward)).toBeCloseTo(0, 6);
			expect(basis.up.dot(basis.right)).toBeCloseTo(0, 6);
			expect(basis.forward.dot(basis.right)).toBeCloseTo(0, 6);

			// Right-handed: right x forward === up.
			const cross = new THREE.Vector3().crossVectors(basis.right, basis.forward);
			expect(cross.dot(basis.up)).toBeCloseTo(1, 6);
		}
	});

	it('normalizes a non-unit up vector', () => {
		const basis = buildUpBasis(new THREE.Vector3(0, 0, 5));
		expect(basis.up.toArray()).toEqual([0, 0, 1]);
	});
});

describe('isoOffset', () => {
	// The default camera position and updateScene's first-frame framing both used hardcoded Z-up
	// vectors that disagreed with each other. Both now come from here.
	it('Z-up: sits above the model on the front-left corner', () => {
		const offset = isoOffset(Z_UP, 10);

		expect(offset.z).toBeGreaterThan(0); // above
		expect(offset.y).toBeLessThan(0); // in front (-Y is the front side)
		expect(offset.x).toBeLessThan(0); // to the left
	});

	it('is above the ground plane in ANY up convention', () => {
		for (const up of [Z_UP, Y_UP, new THREE.Vector3(1, 0, 0)]) {
			const offset = isoOffset(up, 10);
			// The old hardcoded (-d,-d,+d) put a Y-up scene's camera BELOW the horizon.
			expect(offset.dot(up.clone().normalize())).toBeGreaterThan(0);
		}
	});

	it('scales to exactly the requested distance', () => {
		expect(isoOffset(Z_UP, 42).length()).toBeCloseTo(42, 5);
	});
});

describe('sunOffset', () => {
	it('puts the sun overhead in any up convention, not near-horizontal', () => {
		for (const up of [Z_UP, Y_UP]) {
			const u = up.clone().normalize();
			const sun = sunOffset(up, 25, 50);

			// Height along up must dominate the sideways offset, or shadows rake sideways.
			const height = sun.dot(u);
			const sideways = sun.clone().sub(u.clone().multiplyScalar(height)).length();
			expect(height).toBeGreaterThan(sideways);
		}
	});

	it('Z-up: reproduces the historical (d, d, height) placement', () => {
		// Behaviour-preserving for the default scene — this change reorients non-Z-up scenes only.
		const sun = sunOffset(Z_UP, 25, 50);
		expect(sun.x).toBeCloseTo(25, 5);
		expect(sun.y).toBeCloseTo(25, 5);
		expect(sun.z).toBeCloseTo(50, 5);
	});
});

describe('environmentRotationFor', () => {
	/** Where the HDR's zenith (native +Y) ends up once the rotation is applied. */
	const rotatedZenith = (up: THREE.Vector3) =>
		new THREE.Vector3(0, 1, 0).applyEuler(environmentRotationFor(up));

	it('Y-up: identity, since equirect maps are authored Y-up', () => {
		const euler = environmentRotationFor(Y_UP);
		expect(euler.x).toBeCloseTo(0, 6);
		expect(euler.y).toBeCloseTo(0, 6);
		expect(euler.z).toBeCloseTo(0, 6);
	});

	it('Z-up: lifts the environment upright so its zenith points along +Z', () => {
		// Without this the horizon runs vertically and IBL arrives from +Y instead of overhead.
		const zenith = rotatedZenith(Z_UP);
		expect(zenith.dot(Z_UP)).toBeCloseTo(1, 6);
	});

	it('puts the zenith on the up axis for any convention', () => {
		for (const up of [Z_UP, Y_UP, new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 2, 3)]) {
			const u = up.clone().normalize();
			expect(rotatedZenith(up).dot(u)).toBeCloseTo(1, 6);
		}
	});

	it('handles an inverted (-Y) up axis without spinning the horizon', () => {
		const down = new THREE.Vector3(0, -1, 0);
		// setFromUnitVectors picks an arbitrary perpendicular for a 180° flip; we pin the X roll.
		expect(rotatedZenith(down).dot(down)).toBeCloseTo(1, 6);
	});
});

describe('upToAxis', () => {
	it('maps each cardinal up vector to its axis', () => {
		expect(upToAxis(Z_UP)).toBe('z');
		expect(upToAxis(Y_UP)).toBe('y');
		expect(upToAxis(new THREE.Vector3(1, 0, 0))).toBe('x');
	});

	it('resolves an off-axis up vector to its dominant component', () => {
		expect(upToAxis(new THREE.Vector3(0.1, 0.2, 0.9))).toBe('z');
		expect(upToAxis(new THREE.Vector3(-0.9, 0.2, 0.1))).toBe('x');
	});
});
