// Extraction IS validation: a `.gh` with no valid "Schema" output, or an
// unreachable compute server, throws here — which is what makes this the upload
// gate as well as the render path's fallback for un-cached or stale versions.

import {
	normalizeUISchemaCasing,
	readSchemaResults as readWrapper,
	type SchemaEndpointResult
} from '@selvajs/compute/grasshopper';
import { UI_SCHEMA_VERSION, type UISchema } from '@selvajs/schemas';
import type { ComputeServerConfig } from '@selvajs/platform';

/** One entry of the compute schema endpoint's response, typed to our `UISchema`. */
export type SchemaExtractionResult = SchemaEndpointResult<UISchema>;

/** Thin re-export of @selvajs/compute's unwrap, typed to `UISchema`. */
export function readSchemaResults(raw: unknown): SchemaExtractionResult[] {
	return readWrapper<UISchema>(raw);
}

/** Thrown when compute is reachable but the definition yields no usable schema. */
export class SchemaExtractionError extends Error {
	constructor(
		public readonly kind: 'unreachable' | 'invalid' | 'unsupported' | 'malformed',
		message: string
	) {
		super(message);
		this.name = 'SchemaExtractionError';
	}
}

/**
 * Rejects a schema whose keys are not camelCase by the time it reaches a consumer.
 *
 * Compute serializes the plugin's `UISchema` POCO, whose camelCase names live in
 * `[JsonProperty]` attributes. `Selva.gha` ILRepack-merges Newtonsoft, so those
 * attributes have type `Selva!Newtonsoft.Json.JsonPropertyAttribute`; a compute
 * server serializing with its OWN Newtonsoft does not recognize them, reads no
 * attributes, and falls back to raw CLR member names — `Inputs`, `Layout`.
 * Nothing throws on the wire: every consumer just reads `schema.inputs` as
 * undefined and renders a definition with no inputs.
 *
 * `postSchemaFormData` repairs that casing via `normalizeUISchemaCasing`, so a
 * schema fresh off the wire never trips this. It stays because schemas are also
 * PERSISTED: a row cached before the normalizer existed still holds PascalCase,
 * and it reaches consumers without passing through `postSchemaFormData` again.
 * A schema with no `inputs` in any casing lands here too. It is a backstop, not
 * the primary defense — which is why it names the missing key rather than telling
 * the operator to go update their compute server.
 *
 * Checked structurally rather than by plugin version, because the casing depends
 * on which assembly serialized the schema, not on any version number.
 */
export function assertCamelCaseSchema(schema: UISchema): void {
	const raw = schema as unknown as Record<string, unknown>;
	if (Array.isArray(raw.inputs)) return;

	const pascalKeys = ['Inputs', 'Outputs', 'Layout', 'SchemaVersion'].filter((k) => k in raw);
	if (pascalKeys.length > 0) {
		throw new SchemaExtractionError(
			'malformed',
			`Schema keys are PascalCase (found ${pascalKeys.join(', ')}), so every property name ` +
				`is wrong and the definition would render with no inputs. Compute serialized it with ` +
				`its own Newtonsoft instead of the one merged into Selva.gha. Fresh responses are ` +
				`normalized, so this is most likely a schema cached before that fix — re-save the ` +
				`definition version to re-extract it.`
		);
	}

	throw new SchemaExtractionError(
		'malformed',
		`Compute returned a schema with no 'inputs' array (got keys: ${Object.keys(raw)
			.slice(0, 12)
			.join(', ')}).`
	);
}

function parseSemver(version: string): [number, number, number] | null {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Rejects a schema from a NEWER plugin than this app was built against — its
 * shape may contain constructs the renderer doesn't know. Older (or missing)
 * versions pass: the compute-side C# migrator always emits its own current
 * version, and an older shape only lacks optional additions.
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
 * POSTs a multipart form to Rhino Compute's `/grasshopper/schema` endpoint (no
 * solve required). Throws 'unreachable' on a network failure or non-2xx. The
 * per-file `error` Compute reports on its 200-with-no-schemas case is left to
 * the caller — single-file and multi-file callers want different messages.
 */
export async function postSchemaFormData(
	formData: FormData,
	server: ComputeServerConfig
): Promise<SchemaExtractionResult[]> {
	const schemaUrl = new URL('/grasshopper/schema', server.serverUrl).toString();

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

	// Normalize here rather than in each caller: the upload/validation route reads
	// `postSchemaFormData` directly, so a fix applied only inside
	// `fetchSchemaFromCompute` would leave that path serving PascalCase schemas.
	const results = readSchemaResults(await response.json());
	return results.map((result) => ({
		...result,
		schemas: result.schemas?.map((schema) => normalizeUISchemaCasing(schema))
	}));
}

/**
 * Throws `SchemaExtractionError` so callers can map to the right HTTP status:
 * 503 unreachable / 422 invalid or unsupported.
 */
export async function fetchSchemaFromCompute(
	definitionBytes: Uint8Array,
	server: ComputeServerConfig
): Promise<UISchema> {
	const formData = new FormData();
	const blob = new Blob([new Uint8Array(definitionBytes)], { type: 'application/octet-stream' });
	formData.append('file', blob, 'definition.gh');

	const results = await postSchemaFormData(formData, server);
	const schemas = results.flatMap((r) => r.schemas ?? []);

	if (schemas.length === 0) {
		// Compute answers 200 while reporting a per-file `error`, so the
		// !response.ok guard never fires for it. Surface that message verbatim: it
		// names the actual cause (bad Schema source, no embedded schema, ...),
		// which the generic fallback below cannot.
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
	assertCamelCaseSchema(schemas[0]);
	return schemas[0];
}
