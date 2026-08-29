import * as THREE from 'three';

import { applyOffset, computeCombinedBoundingBox, getLogger } from '../../shared/index.js';

import { parseDisplayItems } from '../display-items/display-items-parser.js';

import { parseMeshBatchObject } from './batch-parser.js';

import type { DisplayDataItem, GrasshopperComputeResponse } from './response-envelope.js';
import type { DisplayBatch, MeshExtractionOptions, MeshBatchParsingOptions } from './types.js';

// Constants

/**
 * Metres per model unit, keyed by Rhino `UnitSystem` name (the `modelunits` string on the compute
 * response). Imperial factors are the exact international definitions. Units missing from this
 * table scale by 1 and log a one-time warning — see {@link getScaleFactor}.
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

const DISPLAY_COMPONENT_TYPE = 'Display';
const DISPLAY_BATCH_TYPE = 'DisplayBatch';

/**
 * True when a wire `type` denotes a Display payload: one of its dot-separated tokens is exactly
 * `Display` or `DisplayBatch`. Matches the bare `Display` used by older servers and the namespaced
 * `Selva.GH.Features.Display.Services.DisplayBatch`, but not e.g. `System.DisplayText` — matching
 * on tokens rather than substring avoids misrouting an unrelated type that merely contains "Display".
 */
function isDisplayItemType(type: string): boolean {
	const tokens = type.split('.');
	return tokens.includes(DISPLAY_COMPONENT_TYPE) || tokens.includes(DISPLAY_BATCH_TYPE);
}

/** Unknown-unit names already warned about, so a per-solve parse doesn't spam the log. */
const warnedUnknownUnits = new Set<string>();

/**
 * Extracts display meshes and items from a Grasshopper WebDisplay compute response: decompresses,
 * scales to meters, and optionally grounds them. Requires the VektorNode Rhino.Compute fork.
 *
 * Synchronous internally (large batches block the UI for their duration); `async` only so the
 * shape can stay stable if parsing moves off-thread later.
 *
 * @throws Rethrows unexpected errors after attempting to dispose any created meshes.
 */
export async function getThreeObjectsFromComputeResponse(
	data: GrasshopperComputeResponse,
	options?: MeshExtractionOptions
): Promise<THREE.Object3D[]> {
	const startTime = performance.now();
	const objects: THREE.Object3D[] = [];

	const {
		allowScaling = true,
		// Defaults to false so picked/measured values match the GH definition's own coordinates
		// rather than shifting per transport.
		allowAutoPosition = false,
		groundAxis = 'z',
		debug = false,
		parsing: parsingOptions = {}
	} = options ?? {};

	try {
		const scaleFactor = allowScaling ? getScaleFactor(data.modelunits) : 1;
		await extractDisplayFromData(data, objects, scaleFactor, parsingOptions, debug);

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
 * Gets the metres-per-unit scale factor for a Rhino unit name. Unknown units fall back to 1 (no
 * scaling) with a one-time warning — a kilometers model rendering 1000x off should at least say why.
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
	data: GrasshopperComputeResponse,
	objects: THREE.Object3D[],
	scaleFactor: number,
	parsingOptions: MeshBatchParsingOptions,
	debug: boolean
): Promise<void> {
	for (const value of data.values) {
		const innerTree = value.InnerTree;

		for (const path in innerTree) {
			const branch = innerTree[path];
			if (!branch) continue;

			await processDataBranch(branch, objects, scaleFactor, parsingOptions, debug);
		}
	}
}

/** Extracts a DisplayBatch's meshes (binary blob) and items (curves/points JSON) from one data branch. */
async function processDataBranch(
	branch: DisplayDataItem[],
	objects: THREE.Object3D[],
	scaleFactor: number,
	parsingOptions: MeshBatchParsingOptions,
	debug: boolean
): Promise<void> {
	for (const item of branch) {
		if (!isDisplayItemType(item.type)) continue;

		const mergedParsingOptions = {
			mergeByMaterial: true,
			debug: false,
			...parsingOptions
		};

		// Parsed once and shared: item.data is a multi-MB base64 SLVA blob, so parsing it twice (once
		// for the mesh parser, once for the item extractor) would double both CPU and string memory.
		const batch = extractBatch(item.data);
		if (!batch) {
			getLogger().error('Error parsing display batch envelope: invalid JSON');
			continue;
		}

		const batchMeshes = await parseMeshBatchObject(batch, mergedParsingOptions);

		const batchItems = parseDisplayItems(batch.items);

		const batchObjects: THREE.Object3D[] = [...batchMeshes, ...batchItems];

		// Meshes and items share one scale factor so they end up in the same frame.
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

/** Resolves `item.data` to a parsed DisplayBatch, tolerating either an already-parsed object or a JSON string. */
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
 * Drops objects so their lowest point sits on the ground plane. `axis` isn't hardcoded to `z`
 * because subtracting `min.z` on a host with a non-default `sceneUp` would shove content sideways
 * instead of down.
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
