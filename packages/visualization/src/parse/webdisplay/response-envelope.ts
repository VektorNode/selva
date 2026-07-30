/**
 * The Grasshopper response envelope, declared structurally.
 *
 * This is the one place the parse layer knows the shape a Rhino.Compute / Grasshopper solve
 * response arrives in. It is declared here rather than imported from `@selvajs/compute` so that
 * turning a mesh payload into Three.js objects needs no Rhino.Compute client — this package's
 * scope is mesh conversion and the viewer, and unwrapping a Grasshopper response is a shape the
 * caller happens to hand us, not a dependency we need a client for.
 *
 * Declared **structurally and minimally**: only the fields the parser actually reads. Compute's
 * `GrasshopperComputeResponse` is a superset and remains assignable to this, so
 * {@link getThreeMeshesFromComputeResponse} keeps accepting one unchanged. Anything else with the
 * same shape — a WebSocket preview payload, a fixture, a non-Selva backend — works too.
 *
 * @module parse/webdisplay/response-envelope
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
