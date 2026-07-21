import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { bench, describe } from 'vitest';

import { boxField, planarGrid, smoothSphere, triangleCount } from '@tests/helpers/bench-geometry';

import { addEdges, removeEdges } from '../edges';

/**
 * Baseline for the edge-overlay performance plan (docs/plans/4.edge-overlay-performance.md).
 * Measures the three costs that scale with mesh size:
 *
 * 1. `THREE.EdgesGeometry` extraction (the known main-thread stall) across the
 *    best/smooth/worst shapes in bench-geometry.
 * 2. `LineSegmentsGeometry.setPositions` (building the fat-line GPU buffers from extracted
 *    segments).
 * 3. The real user-facing paths: `addEdges`+`removeEdges` toggle cycles on multi-mesh scenes,
 *    unique geometries vs one shared geometry (exercising the per-geometry cache).
 *
 * Mesh-batch *parsing* benches live in webdisplay/__tests__/batch-parser.bench.ts.
 *
 * Run: pnpm bench            (default sizes: 100k and 1M triangles)
 *      BENCH_HEAVY=1 pnpm bench   (adds 4M-triangle fixtures)
 */

const THRESHOLD_ANGLE = 44; // addEdges' default crease angle — keep in sync with edges.ts

const HEAVY = !!process.env.BENCH_HEAVY;

// Big fixtures make single iterations expensive (~seconds); cap counts explicitly instead of
// letting tinybench run on a time budget.
const FEW = { time: 0, warmupTime: 0, warmupIterations: 1, iterations: 3 } as const;

interface Fixture {
	label: string;
	geometry: THREE.BufferGeometry;
	segments: number; // surviving edge segments at THRESHOLD_ANGLE, for context in the report
}

function makeFixture(label: string, geometry: THREE.BufferGeometry): Fixture {
	const edges = new THREE.EdgesGeometry(geometry, THRESHOLD_ANGLE);
	const segments = edges.attributes.position.count / 2;
	edges.dispose();
	return {
		label: `${label} (${Math.round(triangleCount(geometry) / 1000)}k tri)`,
		geometry,
		segments
	};
}

const SIZES = HEAVY ? [100_000, 1_000_000, 4_000_000] : [100_000, 1_000_000];

const fixtures: Fixture[] = SIZES.flatMap((size) => [
	makeFixture('planar', planarGrid(size)),
	makeFixture('sphere', smoothSphere(size)),
	makeFixture('boxField', boxField(size))
]);

// Non-indexed soup exercises EdgesGeometry's vertex welding (position-hash dedupe).
const soup = makeFixture('boxField soup non-indexed', boxField(100_000).toNonIndexed());

// Surviving-segment counts are essential context for the render-cost numbers — print once.
// eslint-disable-next-line no-console
console.log(
	'[edges.bench] surviving segments @44°: ' +
		[...fixtures, soup].map((f) => `${f.label}=${f.segments}`).join(', ')
);

describe('EdgesGeometry extraction @44°', () => {
	for (const fixture of [...fixtures, soup]) {
		bench(
			fixture.label,
			() => {
				new THREE.EdgesGeometry(fixture.geometry, THRESHOLD_ANGLE).dispose();
			},
			FEW
		);
	}
});

describe('LineSegmentsGeometry.setPositions (fat-line buffer build)', () => {
	// boxField keeps every crease — the only shape producing enough segments to matter.
	for (const fixture of fixtures.filter((f) => f.label.startsWith('boxField'))) {
		const edges = new THREE.EdgesGeometry(fixture.geometry, THRESHOLD_ANGLE);
		const positions = edges.attributes.position.array as Float32Array;
		edges.dispose();
		bench(
			`${fixture.label} → ${fixture.segments} segments`,
			() => {
				const lineGeometry = new LineSegmentsGeometry();
				lineGeometry.setPositions(positions);
				lineGeometry.dispose();
			},
			FEW
		);
	}
});

describe('addEdges/removeEdges toggle cycle (user-facing path)', () => {
	// removeEdges drops the refcounted cache entry, so every cycle re-extracts — exactly what the
	// viewer's edges toggle (and every solve, today) pays.
	function sceneOf(geometries: THREE.BufferGeometry[]): THREE.Group {
		const root = new THREE.Group();
		for (const geometry of geometries) {
			root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8899aa })));
		}
		return root;
	}

	const MESH_COUNT = 100;
	const uniqueScene = sceneOf(Array.from({ length: MESH_COUNT }, () => boxField(5_000)));
	const sharedGeometry = boxField(5_000);
	const sharedScene = sceneOf(Array.from({ length: MESH_COUNT }, () => sharedGeometry));

	bench(
		`${MESH_COUNT} meshes × 5k tri, unique geometries (500k tri total)`,
		() => {
			addEdges(uniqueScene);
			removeEdges(uniqueScene);
		},
		FEW
	);

	bench(
		`${MESH_COUNT} meshes × 5k tri, one shared geometry (cache hit path)`,
		() => {
			addEdges(sharedScene);
			removeEdges(sharedScene);
		},
		FEW
	);
});
