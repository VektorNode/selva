import * as THREE from 'three';

import { applyOffset, computeCombinedBoundingBox, getLogger } from '../../shared/index.js';

import { parseDisplayItems } from '../display-items/display-items-parser.js';

import { parseMeshBatchObject } from './batch-parser.js';

import type { DisplayDataItem, DisplayComputeResponse } from './response-envelope.js';
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
 * Extracts display meshes and items from a Grasshopper WebDisplay compute response: decompresses,
 * scales to meters, and optionally grounds them. Requires the VektorNode Rhino.Compute fork (see
 * root CLAUDE.md).
 *
 * The whole pipeline (base64 decode, inflate, dequantization, mesh construction) runs synchronously
 * on the calling thread — large batches block the UI for their duration. `async` only so the shape
 * can stay stable if parsing moves off-thread later.
 *
 * @throws Rethrows unexpected errors after attempting to dispose any created meshes.
 */
export async function getThreeMeshesFromComputeResponse(
	data: DisplayComputeResponse,
	options?: MeshExtractionOptions
): Promise<THREE.Object3D[]> {
	const startTime = performance.now();
	const objects: THREE.Object3D[] = [];

	const {
		allowScaling = true,
		// Defaults to FALSE: geometry renders where Rhino puts it. Grounding used to be on by
		// default here but was never applied on the WebSocket preview path, so the same definition
		// sat at a different height depending on transport. Rhino coordinates are the honest frame —
		// the viewer agrees with the Grasshopper definition, and picked/measured coordinates match.
		allowAutoPosition = false,
		groundAxis = 'z',
		rhino,
		debug = false,
		parsing: parsingOptions = {}
	} = options ?? {};

	try {
		const scaleFactor = allowScaling ? getScaleFactor(data.modelunits) : 1;
		await extractDisplayFromData(data, objects, scaleFactor, parsingOptions, rhino, debug);

		if (allowAutoPosition) {
			applyGroundOffset(objects, groundAxis);
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

async function extractDisplayFromData(
	data: DisplayComputeResponse,
	objects: THREE.Object3D[],
	scaleFactor: number,
	parsingOptions: MeshBatchParsingOptions,
	rhino: RhinoModule | undefined,
	debug: boolean
): Promise<void> {
	for (const value of data.values) {
		const innerTree = value.InnerTree;

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
	branch: DisplayDataItem[],
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
 * Drops objects so their lowest point sits on the ground plane. `axis` is the scene's up axis —
 * `z` for the default Rhino frame geometry arrives in (see ../../shared/coordinate-frame.ts).
 * Taking it as a parameter rather than hardcoding `z` keeps grounding correct for a host that
 * configures a different `sceneUp`, where subtracting `min.z` would shove content sideways instead
 * of down.
 */
function applyGroundOffset(meshes: THREE.Object3D[], axis: 'x' | 'y' | 'z'): void {
	if (meshes.length === 0) return;

	const combinedBoundingBox = computeCombinedBoundingBox(meshes);
	applyOffset(meshes, combinedBoundingBox.min[axis], axis);
}

function handleError(error: unknown, meshes: THREE.Object3D[]): void {
	getLogger().error('An unexpected error occurred:', error);
	disposeMeshes(meshes);
}

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

function logProcessingTime(startTime: number): void {
	const elapsed = performance.now() - startTime;
	getLogger().info('Time to process meshes:', `${elapsed.toFixed(2)}ms`);
}
