// Non-mesh display items (curves, points) ride as JSON inside DisplayBatch alongside the binary
// mesh blob; meshes themselves don't appear in this union. Discriminated on `kind` — the parser's
// `never` check forces new kinds to be handled there.

/** Shared by meshes and items so pick/filter/label code treats them uniformly. No color/material — that's per-kind. */
export interface DisplayIdentity {
	/** Stable pick key: `${sourceComponentId}:${originalIndex}`. */
	id: string;
	/** Distinct from {@link id} — renaming must not change identity. */
	name: string;
	layer: string;
	/** Arbitrary key-value pairs from the GH Metadata input. */
	metadata?: Record<string, string>;
}

export interface DisplayItemBase extends DisplayIdentity {
	/** Hex/rgb/named color string, parsed by `parseColor`. Falls back to a viewer default. */
	color?: string;
	/** 0–1. Omitted means fully opaque. */
	opacity?: number;
}

/** Rhino's Z-up frame and `{X,Y,Z}` casing. */
export interface DisplayPosition {
	X: number;
	Y: number;
	Z: number;
}

/** Rhino-native JSON (`curve.ToNurbsCurve().ToJSON()`), tessellated to a fat `Line2` on decode. */
export interface DisplayCurve extends DisplayItemBase {
	kind: 'curve';
	json: string;
	/** Screen-space CSS px, constant regardless of zoom. Omitted → viewer default. */
	width?: number;
}

export interface DisplayPoint extends DisplayItemBase {
	kind: 'point';
	position: DisplayPosition;
}

export type DisplayItem = DisplayCurve | DisplayPoint;
