/**
 * Declared structurally rather than imported from `@selvajs/compute` — this package converts
 * meshes, it doesn't need a Rhino.Compute client dependency to describe the shape a caller hands
 * it. Callers can pass their own `GrasshopperComputeResponse` shape here; the compute package's
 * response type is a superset and stays assignable to this local contract.
 */

import type { DisplayBatch } from './types.js';

export interface DisplayDataItem {
	/** Namespaced wire type token, e.g. `Selva.GH.Features.Display.Services.DisplayBatch`. */
	type: string;
	/** A JSON string of the batch, or the batch itself once a binary response was decoded. */
	data: string | DisplayBatch;
}

export interface GrasshopperResponseValue {
	InnerTree: { [branchPath: string]: DisplayDataItem[] };
}

export interface GrasshopperComputeResponse {
	values: GrasshopperResponseValue[];
	/** Rhino `UnitSystem` name driving unit scaling (see `SCALE_FACTORS`); unrecognized/absent scales 1. */
	modelunits: string;
}
