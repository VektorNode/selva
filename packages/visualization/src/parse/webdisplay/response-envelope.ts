/**
 * The Grasshopper response envelope, declared structurally rather than imported from
 * `@selvajs/compute` — this package converts meshes, it doesn't need a Rhino.Compute client
 * dependency to describe the shape a caller hands it.
 *
 * Declared minimally: only the fields the parser reads. `@selvajs/compute`'s
 * `GrasshopperComputeResponse` is a superset and stays assignable to this, so
 * {@link getThreeMeshesFromComputeResponse} keeps accepting one unchanged — as does any other
 * source with the same shape (WebSocket preview, fixture, non-Selva backend).
 */

/** One value in a data-tree branch: a typed, serialized payload. */
export interface DisplayDataItem {
	/** Namespaced wire type token, e.g. `Selva.GH.Features.Display.Services.DisplayBatch`. */
	type: string;
	/** Serialized payload — for a display batch, the JSON envelope holding the base64 mesh blob. */
	data: string;
}

/** One output parameter of a solve, holding a Grasshopper data tree keyed by branch path. */
export interface DisplayResponseValue {
	InnerTree: { [branchPath: string]: DisplayDataItem[] };
}

/**
 * A solve response carrying display output.
 *
 * `modelunits` is the Rhino `UnitSystem` name driving unit scaling (see `SCALE_FACTORS`); an
 * unrecognized or absent value scales 1.
 */
export interface DisplayComputeResponse {
	values: DisplayResponseValue[];
	modelunits: string;
}
