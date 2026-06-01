// Shared compute-schema extraction. One implementation used by:
//   - upload routes (validate-and-cache gate — no upload without a valid schema)
//   - the render path (falls back to live extraction for un-cached versions)
//   - the temporary solve-time backfill bridge (see specs/SchemaCaching.md)
//
// Extraction IS validation: a `.gh` with no valid "Schema" output, or an
// unreachable compute server, throws here and the caller rejects the upload.

import { camelcaseKeys } from '@selvajs/compute/core';
import type { UISchema } from '@selvajs/schemas';
import type { ComputeServerConfig } from '@selvajs/platform';

/** Thrown when compute is reachable but the definition yields no usable schema. */
export class SchemaExtractionError extends Error {
	constructor(
		public readonly kind: 'unreachable' | 'invalid',
		message: string
	) {
		super(message);
		this.name = 'SchemaExtractionError';
	}
}

/**
 * Fetch the UI schema from Rhino Compute's `/grasshopper/schema` endpoint (no
 * solve required). Throws `SchemaExtractionError` so callers can map to the
 * right HTTP status (503 unreachable / 422 invalid).
 */
export async function fetchSchemaFromCompute(
	definitionBytes: Uint8Array,
	server: ComputeServerConfig
): Promise<UISchema> {
	const schemaUrl = new URL('/grasshopper/schema', server.serverUrl).toString();

	const formData = new FormData();
	const blob = new Blob([new Uint8Array(definitionBytes)], { type: 'application/octet-stream' });
	formData.append('file', blob, 'definition.gh');

	const headers: Record<string, string> = {};
	if (server.apiKey) {
		headers['RhinoComputeKey'] = server.apiKey;
	}

	let response: Response;
	try {
		response = await fetch(schemaUrl, { method: 'POST', headers, body: formData });
	} catch (err) {
		throw new SchemaExtractionError(
			'unreachable',
			`Compute server is unreachable: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	if (!response.ok) {
		throw new SchemaExtractionError(
			'unreachable',
			`Schema endpoint returned ${response.status}: ${response.statusText}`
		);
	}

	// Compute returns [{ FileName, Schemas }] with PascalCase wrapper keys only.
	// The schema contents are already camelCase from our C# serializer, so we only
	// need a shallow camelcase to normalize FileName→fileName, Schemas→schemas.
	// deep:true would mangle user-defined option names (e.g. "Display3d" → "display3d").
	const raw = await response.json();
	const results: { schemas: UISchema[] }[] = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as {
		schemas: UISchema[];
	}[];
	const schemas = results.flatMap((r) => r.schemas ?? []);

	if (schemas.length === 0) {
		throw new SchemaExtractionError(
			'invalid',
			'No schemas found in definition.\n\n' +
				'In Grasshopper, verify a Context Bake component with the output name "Schema" is present and wired to the solver.'
		);
	}

	return schemas[0];
}
