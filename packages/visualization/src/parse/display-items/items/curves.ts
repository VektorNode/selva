import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { ErrorCodes, VisualizationError } from '../../../shared/index.js';
import { materialParams } from './appearance.js';

import type { DisplayCurve } from '../types';

const DEFAULT_LINE_WIDTH = 2;

/** Two vertices — the shortest renderable polyline. */
const MIN_POSITIONS = 6;

/**
 * Curves arrive tessellated: the backend sends `points`, this builds the line. Nothing decodes
 * geometry in the browser.
 *
 * Uses `Line2`/`LineMaterial` instead of `THREE.Line`: plain `THREE.Line` is hard-capped at 1px on
 * every major GPU backend, so `item.width` would go unhonoured. `Line2.onBeforeRender` sets
 * `LineMaterial`'s required `resolution`, so no renderer reference is needed here.
 *
 * @throws VisualizationError when the item has no `points` — see {@link curvePositions}.
 */
export function buildCurveLine(item: DisplayCurve): Line2 | null {
	const positions = curvePositions(item);
	if (!positions) return null;

	const geometry = new LineGeometry();
	geometry.setPositions(positions);

	// @types/three's LineMaterial omits `linewidth`/`transparent`/`opacity` though all exist at runtime.
	const params = materialParams(item.color, item.opacity);
	const material = new LineMaterial({ color: params.color });
	const styled = material as LineMaterial & {
		linewidth: number;
		transparent: boolean;
		opacity: number;
	};
	styled.linewidth = item.width ?? DEFAULT_LINE_WIDTH; // CSS px (worldUnits defaults false)
	styled.transparent = params.transparent;
	styled.opacity = params.opacity;

	const line = new Line2(geometry, material);
	line.computeLineDistances();
	line.name = item.name;
	line.userData = {
		source: 'compute',
		id: item.id,
		layer: item.layer,
		kind: 'curve',
		metadata: item.metadata
	};
	return line;
}

/**
 * Flat `[x,y,z, …]`, or null for a degenerate curve — one of those can't abort the batch.
 *
 * A curve with no `points` **throws** instead. It means the definition was solved by a Display
 * component predating backend tessellation, which is a stale definition rather than one bad curve:
 * skipping would render a scene silently missing geometry, indistinguishable from a definition that
 * has no curves, with the fix nowhere in sight.
 */
function curvePositions(item: DisplayCurve): number[] | null {
	if (!item.points) {
		throw new VisualizationError(
			`Curve display item '${item.id}' has no tessellated points. It was produced by an ` +
				'outdated Display component — upgrade it in Grasshopper (Solution → Upgrade obsolete ' +
				'components) and re-save the definition.',
			ErrorCodes.INVALID_CONFIG,
			{ context: { itemId: item.id, kind: item.kind } }
		);
	}

	return item.points.length >= MIN_POSITIONS ? item.points : null;
}
