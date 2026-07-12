import * as THREE from 'three';

import { applyOffset, computeCombinedBoundingBox } from '../threejs/three-helpers.js';
import { getLogger } from '@/core';

import { parseDisplayItems } from '../display-items/display-items-parser.js';

import { parseMeshBatchObject } from './batch-parser.js';

import type { DataItem, GrasshopperComputeResponse } from '@/features/grasshopper/types';
import type { DisplayBatch, MeshExtractionOptions, MeshBatchParsingOptions } from './types.js';
import type { RhinoModule } from 'rhino3dm';

// Constants

/**
 * Metres per model unit, keyed by Rhino `UnitSystem` name (the `modelunits` string on the compute
 * response). Imperial factors are the exact international definitions (1 in = 0.0254 m,
 * 1 ft = 0.3048 m, 1 mi = 1609.344 m). Units not in this table scale 1 and log a one-time warning
 * — see {@link getScaleFactor}.
 */
export const SCALE_FACTORS: Record<string, number> = {
	// Metric
	Angstroms: 1e-10,
	Nanometers: 1e-9,
	Microns: 1e-6,
	Millimeters: 1e-3,
	Centimeters: 1e-2,
	Decimeters: 0.1,
	Meters: 1,
	Dekameters: 10,
	Hectometers: 100,
	Kilometers: 1000,
	Megameters: 1e6,
	Gigameters: 1e9,
	// Imperial (exact: 1 inch = 0.0254 m)
	Microinches: 0.0254e-6,
	Mils: 0.0254e-3,
	Inches: 0.0254,
	Feet: 0.3048,
	Yards: 0.9144,
	Miles: 1609.344,
	NauticalMiles: 1852
};

/**
 * Wire `type` token identifying a Selva Display payload. The real wire value is namespaced (e.g.
 * `Selva.GH.Features.Display.Services.DisplayBatch`), so dispatch matches exact dot-separated
 * tokens — never substrings, which would misroute any unrelated type merely containing "Display".
 */
const DISPLAY_COMPONENT_TYPE = 'Display';
const DISPLAY_BATCH_TYPE = 'DisplayBatch';

/**
 * True when a wire `type` denotes a Display payload: one of its dot-separated tokens is exactly
 * `Display` or `DisplayBatch`. Matches the bare `Display` used by older servers and the namespaced
 * `Selva.GH.Features.Display.Services.DisplayBatch`, but not e.g. `System.DisplayText`.
 */
function isDisplayItemType(type: string): boolean {
	const tokens = type.split('.');
	return tokens.includes(DISPLAY_COMPONENT_TYPE) || tokens.includes(DISPLAY_BATCH_TYPE);
}

/** Unknown-unit names already warned about, so a per-solve parse doesn't spam the log. */
const warnedUnknownUnits = new Set<string>();

/**
 * Extracts and processes display meshes from a ComputePointerResponse using the Grasshopper WebDisplay component.
 *
 * This is the primary entry point for extracting mesh geometry from Grasshopper compute responses.
 * It handles all aspects of mesh processing: decompression, coordinate transformation, scaling, and positioning.
 *
 * **Note:** The entire pipeline (base64 decode, inflate, dequantization, mesh construction) runs
 * synchronously on the calling thread — large batches will block the UI for their duration. The
 * function is `async` only so its shape can stay stable if parsing moves off-thread later.
 *
 * @param data - The ComputePointerResponse containing Grasshopper output trees.
 * @param options - Configuration for mesh extraction and parsing behavior. All options are optional with sensible defaults.
 * @returns Promise resolving to array of THREE.Mesh objects (may be empty).
 * @throws Rethrows unexpected errors after attempting to dispose any created meshes.
 *
 * @remarks
 * - Only works with the WebDisplay component of GHHeadless.
 * - Requires changes to Rhino.Compute (see https://github.com/TheVessen/compute.rhino3d).
 * - Provides a performant way to display mesh data in Three.js.
 * - All decoding is synchronous on the main thread; there is no Web Worker offload today.
 * - Supports mesh metadata (names, user data) if provided in the compute response.
 *
 * @internal Internal helper: high-level extraction remains public via visualization module, but this
 * function is considered internal implementation detail for mesh extraction.
 *
 * @example
 * ```ts
 * // Simple usage with defaults (all processing enabled)
 * const meshes = await getThreeMeshesFromComputeResponse(response);
 *
 * // With debugging enabled
 * const meshes = await getThreeMeshesFromComputeResponse(response, { debug: true });
 *
 * // With advanced options
 * const meshes = await getThreeMeshesFromComputeResponse(response, {
 *   debug: true,
 *   allowScaling: true,
 *   allowAutoPosition: false,
 *   parsing: {
 *     mergeByMaterial: false,
 *     applyTransforms: true,
 *     debug: true,
 *   },
 * });
 * ```
 */
export async function getThreeMeshesFromComputeResponse(
	data: GrasshopperComputeResponse,
	options?: MeshExtractionOptions
): Promise<THREE.Object3D[]> {
	const startTime = performance.now();
	const objects: THREE.Object3D[] = [];

	const {
		allowScaling = true,
		allowAutoPosition = true,
		rhino,
		debug = false,
		parsing: parsingOptions = {}
	} = options ?? {};

	try {
		const scaleFactor = allowScaling ? getScaleFactor(data.modelunits) : 1;
		await extractDisplayFromData(data, objects, scaleFactor, parsingOptions, rhino, debug);

		if (allowAutoPosition) {
			applyGroundOffset(objects);
		}

		return objects;
	} catch (error) {
		handleError(error, objects);
		throw error;
	} finally {
		if (debug) {
			logProcessingTime(startTime);
		}
	}
}

/**
 * Gets the metres-per-unit scale factor for the given Rhino unit name. Unknown units fall back to
 * 1 (no scaling) with a one-time warning per unit name — a kilometers model rendering 1000× off
 * should at least say why.
 */
function getScaleFactor(modelUnits: string): number {
	const factor = SCALE_FACTORS[modelUnits];
	if (factor !== undefined) {
		return factor;
	}
	if (!warnedUnknownUnits.has(modelUnits)) {
		warnedUnknownUnits.add(modelUnits);
		getLogger().warn(
			`Unknown Rhino model unit "${modelUnits}" — geometry will not be scaled (factor 1). ` +
				`Known units: ${Object.keys(SCALE_FACTORS).join(', ')}.`
		);
	}
	return 1;
}

/**
 * Extracts meshes and non-mesh display items (curves, points) from compute response data.
 */
async function extractDisplayFromData(
	data: GrasshopperComputeResponse,
	objects: THREE.Object3D[],
	scaleFactor: number,
	parsingOptions: MeshBatchParsingOptions,
	rhino: RhinoModule | undefined,
	debug: boolean
): Promise<void> {
	for (const value of data.values) {
		const innerTree = value.InnerTree as { [key: string]: DataItem[] };

		for (const path in innerTree) {
			const branch = innerTree[path];
			if (!branch) continue;

			await processDataBranch(branch, objects, scaleFactor, parsingOptions, rhino, debug);
		}
	}
}

/**
 * Processes a single data branch to extract a DisplayBatch's meshes (binary blob) and items
 * (curves/points JSON). Both get the same unit scale so they share one frame.
 */
async function processDataBranch(
	branch: DataItem[],
	objects: THREE.Object3D[],
	scaleFactor: number,
	parsingOptions: MeshBatchParsingOptions,
	rhino: RhinoModule | undefined,
	debug: boolean
): Promise<void> {
	for (const item of branch) {
		if (!isDisplayItemType(item.type)) continue;

		const mergedParsingOptions = {
			mergeByMaterial: true,
			applyTransforms: true,
			debug: false,
			...parsingOptions
		};

		// Parse the JSON envelope once — it contains the full multi-MB base64 SLVA blob as a string,
		// so letting the mesh parser and the display-item extractor each parse it doubles both the
		// synchronous main-thread CPU and the transient string memory.
		const batch = extractBatch(item.data);
		if (!batch) {
			getLogger().error('Error parsing display batch envelope: invalid JSON');
			continue;
		}

		const batchMeshes = await parseMeshBatchObject(batch, mergedParsingOptions);

		const batchItems = parseDisplayItems(batch.items, {
			rhino,
			applyTransforms: mergedParsingOptions.applyTransforms
		});

		const batchObjects: THREE.Object3D[] = [...batchMeshes, ...batchItems];

		if (scaleFactor !== 1) {
			for (const obj of batchObjects) {
				obj.scale.set(scaleFactor, scaleFactor, scaleFactor);
			}
		}

		objects.push(...batchObjects);

		if (debug) {
			getLogger().debug(
				`Extracted ${batchMeshes.length} meshes and ${batchItems.length} items from batch`
			);
		}
	}
}

/**
 * Resolves a raw DisplayBatch payload to a parsed object, tolerating either a parsed object or a
 * JSON string (the blob-bearing `item.data` is the same envelope the mesh parser reads).
 */
function extractBatch(data: unknown): DisplayBatch | undefined {
	return typeof data === 'string' ? safeParse(data) : (data as DisplayBatch | undefined);
}

function safeParse(s: string): DisplayBatch | undefined {
	try {
		return JSON.parse(s) as DisplayBatch;
	} catch {
		return undefined;
	}
}

/**
 * Applies vertical offset to position objects on the Z=0 plane (the ground of the unified
 * Z-up scene frame — see ../coordinate-transform.ts).
 */
function applyGroundOffset(meshes: THREE.Object3D[]): void {
	if (meshes.length === 0) return;

	const combinedBoundingBox = computeCombinedBoundingBox(meshes);
	applyOffset(meshes, combinedBoundingBox.min.z, 'z');
}

/**
 * Handles errors by disposing created objects and logging.
 */
function handleError(error: unknown, meshes: THREE.Object3D[]): void {
	getLogger().error('An unexpected error occurred:', error);
	disposeMeshes(meshes);
}

/**
 * Disposes of all objects (meshes, lines, points) and their associated resources.
 */
function disposeMeshes(meshes: THREE.Object3D[]): void {
	for (const obj of meshes) {
		const mesh = obj as Partial<THREE.Mesh> & THREE.Object3D;
		if (mesh.geometry) {
			mesh.geometry.dispose();
		}

		if (mesh.material) {
			if (Array.isArray(mesh.material)) {
				mesh.material.forEach((material) => material.dispose());
			} else {
				mesh.material.dispose();
			}
		}
	}
}

/**
 * Logs the processing time for mesh extraction.
 */
function logProcessingTime(startTime: number): void {
	const elapsed = performance.now() - startTime;
	getLogger().info('Time to process meshes:', `${elapsed.toFixed(2)}ms`);
}
