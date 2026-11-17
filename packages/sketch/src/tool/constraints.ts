import { distance, type Point3 } from '../model/curve.js';

// ============================================================================
// Where the next point lands
// ============================================================================
//
// The cursor gives a candidate point; these rules move it. All of them work in the drawing plane
// (model XY) and leave Z to the point they started from.

/** What the user typed while placing a point: a length, an angle, or both as `length<angle`. */
export interface TypedInput {
	/** Model units. */
	length?: number;
	/** Degrees, counter-clockwise from the model X axis. */
	angle?: number;
}

/** A key the typed buffer takes. A comma is a decimal point. */
export const TYPED_KEY = /^[0-9.,<-]$/;

/** Null for an empty or unreadable buffer, and for a length that is not positive. */
export function parseTypedInput(text: string): TypedInput | null {
	const [lengthText, angleText, ...rest] = text.replaceAll(',', '.').split('<');
	if (rest.length > 0) return null;

	const input: TypedInput = {};
	if (lengthText !== '') {
		const length = Number(lengthText);
		if (!(length > 0) || !Number.isFinite(length)) return null;
		input.length = length;
	}
	if (angleText !== undefined && angleText !== '') {
		const angle = Number(angleText);
		if (!Number.isFinite(angle)) return null;
		input.angle = angle;
	}
	return input.length === undefined && input.angle === undefined ? null : input;
}

export interface ConstrainOptions {
	/** The point the new one continues from; null for the first point of a curve. */
	last: Point3 | null;
	/** The candidate sits on a vertex. Grid and ortho leave it there. */
	snapped: boolean;
	ortho: boolean;
	/** Model units; 0 turns the grid off. */
	gridStep: number;
	typed: TypedInput | null;
}

const ORTHO_STEP = Math.PI / 4;

export function constrainPoint(candidate: Point3, options: ConstrainOptions): Point3 {
	const { last, snapped, ortho, gridStep, typed } = options;
	let point = candidate;

	if (!snapped && gridStep > 0) {
		point = [
			Math.round(point[0] / gridStep) * gridStep,
			Math.round(point[1] / gridStep) * gridStep,
			point[2]
		];
	}

	if (!snapped && ortho && last) {
		const dx = point[0] - last[0];
		const dy = point[1] - last[1];
		const angle = Math.round(Math.atan2(dy, dx) / ORTHO_STEP) * ORTHO_STEP;
		// The cursor's shadow on the locked direction, so the point follows the cursor along it.
		const along = dx * Math.cos(angle) + dy * Math.sin(angle);
		point = [last[0] + Math.cos(angle) * along, last[1] + Math.sin(angle) * along, last[2]];
	}

	if (!typed || !last) return point;

	if (typed.angle !== undefined) {
		const angle = (typed.angle * Math.PI) / 180;
		const length = typed.length ?? Math.hypot(point[0] - last[0], point[1] - last[1]);
		return [last[0] + Math.cos(angle) * length, last[1] + Math.sin(angle) * length, last[2]];
	}

	// A length alone keeps the cursor's direction, in 3D so it can run up to a snapped vertex.
	const reach = distance(last, point);
	if (typed.length === undefined || reach === 0) return point;
	const factor = typed.length / reach;
	return [
		last[0] + (point[0] - last[0]) * factor,
		last[1] + (point[1] - last[1]) * factor,
		last[2] + (point[2] - last[2]) * factor
	];
}

/** A length for a label: about three significant digits, never more than six decimals. */
export function formatLength(value: number, suffix = ''): string {
	const abs = Math.abs(value);
	const decimals = abs === 0 ? 0 : Math.min(6, Math.max(0, 2 - Math.floor(Math.log10(abs))));
	const text = value.toFixed(decimals);
	return suffix ? `${text} ${suffix}` : text;
}
