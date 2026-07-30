import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createRequestResponseDriver, type SolveReporter } from '@selvajs/solve/client';
import type { SolveResult } from '@selvajs/solve/shared';
import { meshPolicy } from '@selvajs/visualization/parse';

// The C1 seam test. `@selvajs/solve` keeps meshes opaque and `@selvajs/visualization` owns the
// three.js clone/dispose rules; neither package can prove they compose, because neither may
// import the other. This is the only place both are in scope — it exists to catch a
// `ComputeApp` that forgets to pass `meshPolicy`, or a policy whose shape drifts from
// `MeshPolicy`.

function meshResult(tag: string): SolveResult<THREE.Object3D> {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
	mesh.name = tag;
	return { outputs: { out: tag }, meshes: [mesh] };
}

/** Mirrors the viewer's `clearScene`: it disposes the geometry of whatever it was handed. */
function renderAndDispose(result: SolveResult<THREE.Object3D>): void {
	result.meshes?.forEach((root) =>
		root.traverse((child) => (child as Partial<THREE.Mesh>).geometry?.dispose())
	);
}

function collectingReporter(): SolveReporter<THREE.Object3D> & {
	reports: SolveResult<THREE.Object3D>[];
} {
	const reports: SolveResult<THREE.Object3D>[] = [];
	return {
		reports,
		report: (result) => reports.push(result),
		reportError: () => {}
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mesh policy wiring (audit C1)', () => {
	it('a memo hit serves a live mesh after the viewer disposed the previous one', async () => {
		const onSolve = async () => meshResult('a');
		const reporter = collectingReporter();
		const driver = createRequestResponseDriver(onSolve, () => reporter, { meshPolicy });

		driver.solve({ a: 1 });
		await flush();
		renderAndDispose(reporter.reports[0]); // the viewer eats solve 1's meshes

		driver.solve({ a: 1 }); // same inputs → memo hit, no onSolve call
		await flush();

		expect(reporter.reports).toHaveLength(2);
		const served = reporter.reports[1].meshes![0] as THREE.Mesh;
		expect(served).not.toBe(reporter.reports[0].meshes![0]);
		expect(served.geometry.attributes.position).toBeDefined();
	});

	it('without a policy the same flow serves the disposed instance (why the wiring matters)', async () => {
		// Pins the failure mode, so the assertion above is known to be testing something.
		const onSolve = async () => meshResult('a');
		const reporter = collectingReporter();
		const driver = createRequestResponseDriver(onSolve, () => reporter); // no meshPolicy

		driver.solve({ a: 1 });
		await flush();
		driver.solve({ a: 1 });
		await flush();

		expect(reporter.reports[1].meshes![0]).toBe(reporter.reports[0].meshes![0]);
	});
});
