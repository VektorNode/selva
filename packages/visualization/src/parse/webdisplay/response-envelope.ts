/**
 * Declared structurally rather than imported from `@selvajs/compute` — this package converts
 * meshes, it doesn't need a Rhino.Compute client dependency to describe the shape a caller hands
 * it. `@selvajs/compute`'s `GrasshopperComputeResponse` is a superset and stays assignable to
 * this, so {@link getThreeMeshesFromComputeResponse} keeps accepting one unchanged.
 */

export interface DisplayDataItem {
	/** Namespaced wire type token, e.g. `Selva.GH.Features.Display.Services.DisplayBatch`. */
	type: string;
	data: string;
}

export interface DisplayResponseValue {
	InnerTree: { [branchPath: string]: DisplayDataItem[] };
}

export interface DisplayComputeResponse {
	values: DisplayResponseValue[];
	/** Rhino `UnitSystem` name driving unit scaling (see `SCALE_FACTORS`); unrecognized/absent scales 1. */
	modelunits: string;
}
