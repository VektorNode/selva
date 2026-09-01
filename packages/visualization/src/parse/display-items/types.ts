// Non-mesh display items (curves, points) ride as JSON inside DisplayBatch alongside the binary
// mesh blob. Discriminated on `kind`: the parser's `never` check forces new kinds to be handled there.

export interface DisplayIdentity {
	/** The item's identity: the writer-minted opaque id, same contract as mesh ids. Distinct from `name` so renaming doesn't change identity. */
	id: string;
	name: string;
	layer: string;
	/** Arbitrary key-value pairs from the GH Metadata input. */
	metadata?: Record<string, string>;
}

export interface DisplayItemBase extends DisplayIdentity {
	/** Hex/rgb/named color string, parsed by `parseColor`. Falls back to a viewer default. */
	color?: string;
	/** 0-1; omitted means fully opaque. */
	opacity?: number;
}

/** Rhino's Z-up frame and `{X,Y,Z}` casing. */
export interface DisplayPosition {
	X: number;
	Y: number;
	Z: number;
}

/** Rendered as a fat `Line2` straight from `points`: nothing decodes geometry in the browser. */
export interface DisplayCurve extends DisplayItemBase {
	kind: 'curve';
	/**
	 * Backend-tessellated polyline, flat `[x,y,z, …]` in Rhino's Z-up frame.
	 *
	 * Typed as required even though the plugin still sends a legacy `json` field alongside it: a
	 * payload without `points` came from a Display component too old to render, and parsing throws
	 * rather than treating it as a shape this package supports.
	 */
	points: number[];
	/** Screen-space CSS px, constant regardless of zoom. Omitted uses the viewer default. */
	width?: number;
}

export interface DisplayPoint extends DisplayItemBase {
	kind: 'point';
	position: DisplayPosition;
}

export type DisplayItem = DisplayCurve | DisplayPoint;
