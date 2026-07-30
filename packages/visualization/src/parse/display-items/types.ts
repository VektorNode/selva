// Non-mesh display items (curves, points) ride as JSON inside DisplayBatch alongside the binary
// mesh blob. Union is discriminated on `kind`; the parser's `never` check forces new kinds to be handled.

/** Shared by meshes and items so pick/filter/label code treats them uniformly. No color/material — that's per-kind. */
export interface DisplayIdentity {
	/** Stable pick key: `${sourceComponentId}:${originalIndex}`. */
	id: string;
	/** Human label, distinct from {@link id} — renaming must not change identity. */
	name: string;
	/** Layer path for grouping in the scene manager (e.g. "Structure/Walls"). */
	layer: string;
	/** Arbitrary key-value pairs from the GH Metadata input. */
	metadata?: Record<string, string>;
}

export interface DisplayItemBase extends DisplayIdentity {
	/** Hex/rgb/named color string, parsed by `parseColor`. Falls back to a viewer default. */
	color?: string;
	/** Opacity 0–1. Omitted means fully opaque. */
	opacity?: number;
}

/** World position in Rhino's Z-up frame and `{X,Y,Z}` casing; used unchanged (no rotation applied). */
export interface DisplayPosition {
	X: number;
	Y: number;
	Z: number;
}

/** Curve as Rhino-native JSON (`curve.ToNurbsCurve().ToJSON()`), tessellated to a fat `Line2` on decode. */
export interface DisplayCurve extends DisplayItemBase {
	kind: 'curve';
	json: string;
	/** Screen-space thickness in CSS px, constant regardless of zoom. Omitted → viewer default. */
	width?: number;
}

/** A single point, rendered as one vertex of a `THREE.Points`. */
export interface DisplayPoint extends DisplayItemBase {
	kind: 'point';
	position: DisplayPosition;
}

/** Meshes do NOT appear here — they ride the binary blob in `DisplayBatch`. */
export type DisplayItem = DisplayCurve | DisplayPoint;
