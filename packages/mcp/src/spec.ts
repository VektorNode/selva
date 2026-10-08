/**
 * Reads the parts of a host's OpenAPI document the engine relies on: what
 * `buildOpenApiDocument` in `@selvajs/server/api` emits. Anything else in the
 * document is ignored, so a host can describe more without the engine caring.
 */

export type ScopeAction = 'read' | 'write' | 'solve';

/** A JSON Schema object, as the spec carries it. */
export type JsonSchema = Record<string, unknown>;

export interface Operation {
	operationId: string;
	method: string;
	/** Full path including the base, e.g. `/api/v1/definitions/{guid}`. */
	path: string;
	summary: string;
	scope: ScopeAction;
	internal: boolean;
	idempotent: boolean;
	pathParams: string[];
	queryParams: { name: string; description?: string; schema: JsonSchema }[];
	/** JSON body schema. Absent for no body; multipart bodies are not callable as tools. */
	body?: JsonSchema;
	multipart: boolean;
	paginated: boolean;
}

export type OperationIndex = ReadonlyMap<string, Operation>;

interface RawParameter {
	$ref?: string;
	name?: string;
	in?: string;
	description?: string;
	schema?: JsonSchema;
}

interface RawOperation {
	operationId?: string;
	summary?: string;
	'x-scope'?: ScopeAction;
	'x-internal'?: boolean;
	parameters?: RawParameter[];
	requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
}

interface RawDocument {
	paths?: Record<string, Record<string, RawOperation>>;
	components?: { parameters?: Record<string, RawParameter> };
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

export function indexOperations(document: unknown): OperationIndex {
	const doc = document as RawDocument;
	const shared = doc.components?.parameters ?? {};
	const resolve = (p: RawParameter): RawParameter =>
		p.$ref ? (shared[p.$ref.replace('#/components/parameters/', '')] ?? {}) : p;

	const index = new Map<string, Operation>();
	for (const [path, ops] of Object.entries(doc.paths ?? {})) {
		for (const [method, op] of Object.entries(ops)) {
			if (!METHODS.has(method) || !op.operationId) continue;
			// Without `x-scope` the annotations would be guesses; refuse the document instead.
			if (!op['x-scope']) {
				throw new Error(
					`${op.operationId} has no x-scope: build the spec with @selvajs/server/api`
				);
			}
			const params = (op.parameters ?? []).map(resolve);
			const content = op.requestBody?.content ?? {};
			index.set(op.operationId, {
				operationId: op.operationId,
				method: method.toUpperCase(),
				path,
				summary: op.summary ?? '',
				scope: op['x-scope'],
				internal: op['x-internal'] === true,
				idempotent: params.some((p) => p.in === 'header' && p.name === 'Idempotency-Key'),
				pathParams: params.filter((p) => p.in === 'path').map((p) => p.name!),
				queryParams: params
					.filter((p) => p.in === 'query')
					.map((p) => ({ name: p.name!, description: p.description, schema: p.schema ?? {} })),
				body: content['application/json']?.schema,
				multipart: 'multipart/form-data' in content,
				paginated: params.some((p) => p.in === 'query' && p.name === 'cursor')
			});
		}
	}
	return index;
}
