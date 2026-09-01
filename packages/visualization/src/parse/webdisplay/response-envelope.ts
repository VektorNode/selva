/**
 * Declared structurally rather than imported from `@selvajs/compute`: this package converts
 * meshes, it doesn't need a Rhino.Compute client dependency to describe the shape a caller hands
 * it. Callers can pass their own `GrasshopperComputeResponse` shape here; the compute package's
 * response type is a superset and stays assignable to this local contract.
 */

export interface DisplayDataItem {
	/** Namespaced wire type token, e.g. `Selva.GH.Features.Display.Services.DisplayBatch`. */
	type: string;
	data: string;
}

export interface GrasshopperResponseValue {
	InnerTree: { [branchPath: string]: DisplayDataItem[] };
}

export interface GrasshopperComputeResponse {
	values: GrasshopperResponseValue[];
	/** Rhino `UnitSystem` name driving unit scaling (see `SCALE_FACTORS`); unrecognized/absent scales 1. */
	modelunits: string;
}
