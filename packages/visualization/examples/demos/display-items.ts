/**
 * Demo: render the geometry in a Grasshopper compute response — meshes, curves, and points.
 *
 * Takes a raw GH compute response (the exact shape a host app receives) and runs it through the
 * library's `getThreeObjectsFromComputeResponse`: it walks the value trees, finds each Display batch,
 * decodes the binary mesh blob plus the non-mesh display items, and returns a flat array of THREE
 * objects.
 */
import { getThreeObjectsFromComputeResponse } from '@/parse/index.js';
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

	type ComputeResponse = Parameters<typeof getThreeObjectsFromComputeResponse>[0];
	const response = await fetch(responseUrl).then((r) => r.json() as Promise<ComputeResponse>);

	// Same call a host app makes.
	const objects = await getThreeObjectsFromComputeResponse(response);
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
