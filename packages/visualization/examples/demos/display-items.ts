/**
 * Demo: render the geometry in a Grasshopper compute response — meshes, curves, and points.
 *
 * Takes a raw GH compute response (the exact shape a host app receives) and runs it through the
 * library's `getThreeMeshesFromComputeResponse`: it walks the value trees, finds each Display batch,
 * decodes the binary mesh blob plus the non-mesh display items, and returns a flat array of THREE
 * objects.
 */
// `DisplayComputeResponse` is this package's Rhino-free view of a GH response — the minimal shape the
// parser reads. `@selvajs/compute`'s `GrasshopperComputeResponse` is a superset and stays assignable
// to it, so a host app can pass its own response straight through.
import { getThreeMeshesFromComputeResponse, type DisplayComputeResponse } from '@/parse/index.js';
import { LOOKS, type Look } from '@/render/index.js';

import { createPlayground } from '../shared/playground';
import responseUrl from '../shared/samples/compute-response.json?url';

const pg = createPlayground({ title: 'Display Items' });

pg.addSection('Display Items');
pg.addButton('Reload sample', () => void load());
pg.addSelect('Look', [...LOOKS], 'technical', (v) => pg.viewer.setLook(v as Look));

async function load() {
	pg.setStatus('Loading response…');
	pg.clearObjects();

	const response = await fetch(responseUrl).then((r) => r.json() as Promise<DisplayComputeResponse>);

	// Same call a host app makes.
	const objects = await getThreeMeshesFromComputeResponse(response);
	pg.addObjects(objects);

	const counts = objects.reduce<Record<string, number>>((acc, o) => {
		const kind = (o.userData.kind as string) ?? o.type;
		acc[kind] = (acc[kind] ?? 0) + 1;
		return acc;
	}, {});
	const summary = Object.entries(counts)
		.map(([k, n]) => `${n} ${k}`)
		.join(', ');
	pg.setStatus(`Decoded ${objects.length} objects\n→ ${summary || 'none'}`);

	// Fit on the next frame so the canvas has its real size before framing.
	requestAnimationFrame(() => pg.viewer.fitToView());
}

void load();
