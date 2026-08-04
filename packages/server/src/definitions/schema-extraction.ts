// Shared compute-schema extraction. One implementation used by:
//   - upload routes (validate-and-cache gate — no upload without a valid schema)
//   - the render path (falls back to live extraction for un-cached or stale
//     versions; see load-for-render.ts and ADR 0005)
//   - the temporary solve-time backfill bridge (see the app's specs/SchemaCaching.md)
//
// Extraction IS validation: a `.gh` with no valid "Schema" output, or an
// unreachable compute server, throws here and the caller rejects the upload.

import {
	readSchemaResults as readWrapper,
	type SchemaEndpointResult
} from '@selvajs/compute/grasshopper';
import { UI_SCHEMA_VERSION, type UISchema } from '@selvajs/schemas';
import type { ComputeServerConfig } from '@selvajs/platform';

/** One entry of the compute schema endpoint's response, typed to our `UISchema`. */
export type SchemaExtractionResult = SchemaEndpointResult<UISchema>;

/** Read compute's schema-endpoint body, typed to `UISchema`. See {@link readSchemaResults}. */
export function readSchemaResults(raw: unknown): SchemaExtractionResult[] {
	return readWrapper<UISchema>(raw);
}

/** Thrown when compute is reachable but the definition yields no usable schema. */
export class SchemaExtractionError extends Error {
	constructor(
		public readonly kind: 'unreachable' | 'invalid' | 'unsupported',
		message: string
	) {
		super(message);
		this.name = 'SchemaExtractionError';
	}
}

function parseSemver(version: string): [number, number, number] | null {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Plugin↔app compat gate: reject a schema emitted by a NEWER plugin than this
 * app was built against — its shape may contain constructs the renderer does
 * not know. Older (or missing) versions pass: the compute-side C# migrator
 * always emits its own current version, and an older shape only lacks
 * optional additions.
 */
export function assertSupportedSchemaVersion(schema: UISchema): void {
	const version = schema.schemaVersion;
	if (!version) return; // pre-2.12.0 plugin — older than the app, fine
	const extracted = parseSemver(version);
	const supported = parseSemver(UI_SCHEMA_VERSION);
	if (!extracted || !supported) return;
	const newer =
		extracted[0] > supported[0] ||
		(extracted[0] === supported[0] &&
			(extracted[1] > supported[1] ||
				(extracted[1] === supported[1] && extracted[2] > supported[2])));
	if (newer) {
		throw new SchemaExtractionError(
			'unsupported',
			`This definition was authored with a newer Selva plugin (schema format ${version}); ` +
				`this server supports schema format ≤ ${UI_SCHEMA_VERSION}. Update the server, or ` +
				`re-save the definition with a matching plugin version.`
		);
	}
}

/**
 * Fetch the UI schema from Rhino Compute's `/grasshopper/schema` endpoint (no
 * solve required). Throws `SchemaExtractionError` so callers can map to the
 * right HTTP status (503 unreachable / 422 invalid or unsupported).
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

	const results = readSchemaResults(await response.json());
	const schemas = results.flatMap((r) => r.schemas ?? []);

	if (schemas.length === 0) {
		// Compute reports a per-file diagnosis in an `error` field and still answers 200, so
		// the !response.ok guard above never fires for it. Surface that message verbatim —
		// it names the actual cause (bad Schema source, no embedded schema, ...), which the
		// generic fallback below cannot, and its absence sends people debugging the wrong thing.
		const diagnosis = results.map((r) => r.error).filter(Boolean);
		if (diagnosis.length > 0) {
			throw new SchemaExtractionError('invalid', diagnosis.join('\n'));
		}

		throw new SchemaExtractionError(
			'invalid',
			'No schemas found in definition.\n\n' +
				'In Grasshopper, verify a Context Bake component with the output name "Schema" is present and wired to the solver.'
		);
	}

	assertSupportedSchemaVersion(schemas[0]);
	return schemas[0];
}
