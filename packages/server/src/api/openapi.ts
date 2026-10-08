/**
 * Builds an OpenAPI 3.1 document for a host's `/api/v1` from its route registry.
 *
 * Shared so every host publishes the same shape: `@selvajs/mcp` reads
 * `operationId`, `x-scope`, `x-internal` and the `Idempotency-Key` parameter
 * from it, and nothing else.
 *
 * Request schemas come from `z.toJSONSchema` over the actual validators, so a
 * renamed body field changes the spec on the next generate. Response schemas
 * are not derived: handlers build payloads from store records with no Zod
 * validator on the way out. They're described structurally (pagination
 * envelope, error envelope) and resource bodies stay open; `returns` adds prose.
 */

import { z, type ZodType } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, type ApiScopeAction } from '@selvajs/platform';
import { ApiErrorCode } from './errors.js';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * `collection` is the paginated `{ items, nextCursor? }` envelope and implies
 * the `limit`/`cursor` query params. Mislabelling a list endpoint as `object`
 * is how an unpaginated collection ships.
 */
export type ResponseKind = 'collection' | 'object' | 'empty' | 'binary';

export interface Endpoint {
	method: HttpMethod;
	/** OpenAPI path with `{param}` placeholders, not SvelteKit's `[param]`. */
	path: string;
	summary: string;
	/** The scope action the route checks. Emitted as `x-scope`; MCP tool annotations derive from it. */
	scope: ApiScopeAction;
	/** Excluded from published docs; may change without notice. */
	internal?: boolean;
	response: ResponseKind;
	/** What a success body holds, in prose. */
	returns?: string;
	/** Success status when it isn't 200 (or 204 for `empty`). */
	status?: number;
	/** For `binary`. Defaults to `application/octet-stream`. */
	contentType?: string;
	requestBody?: ZodType;
	/** Multipart form fields, for handlers that take `FormData` instead of JSON. */
	multipart?: { field: string; required: boolean; description: string }[];
	/** Query params beyond the standard pagination set. */
	query?: { name: string; description: string }[];
	/** Documented failure statuses beyond `alwaysErrors`. */
	errors?: number[];
	/** Honours `Idempotency-Key`; must match the route's `idempotent` mount option. */
	idempotent?: boolean;
}

export interface OpenApiOptions {
	/** Route prefix every endpoint is served under, e.g. `/api/v1`. */
	basePath: string;
	info: { title: string; version: string; description: string; license?: { name: string } };
	securitySchemes: Record<string, Json>;
	security: Json[];
	/** Extra `components.schemas`, beside `Error` and `Page`. */
	schemas?: Record<string, Json>;
	/** Merged over the default per-status descriptions. */
	errorDescriptions?: Record<number, string>;
	/** Failures any operation can return. */
	alwaysErrors?: number[];
	/** Replaces the default `Idempotency-Key` description. */
	idempotencyKeyDescription?: string;
}

const DEFAULT_ERROR_DESCRIPTIONS: Record<number, string> = {
	400: 'Validation failed.',
	401: 'Missing or invalid credentials.',
	403: 'Authenticated, but not permitted to perform this action. For an API token, `details.requiredScope` names the scope that would have passed.',
	404: 'No such resource, or the caller cannot see it.',
	409: 'The request conflicts with the current state.',
	422: 'Well-formed but not processable.',
	429: 'Rate limited. Retry after the interval in `Retry-After`.',
	500: 'Unexpected server error.',
	503: 'A dependency is unconfigured or unreachable. Retry later.'
};

const DEFAULT_IDEMPOTENCY_KEY_DESCRIPTION =
	'A client-chosen key, 1 to 255 characters. Repeating the request with the same key within the retention window replays the first successful response instead of running it again; the replay carries `Idempotency-Replayed: true`. Keys are scoped to the calling token (or user, for a browser session). Reusing a key with a different method, path or body returns `422`. A failed attempt is not kept, so a corrected retry runs. The store is per-process and in-memory: it absorbs retries, does not survive a restart, and is not shared between app instances.';

function requestBodySchema(schema: ZodType): Json {
	// io: 'input': fields with defaults are optional on the way in, unlike the output view.
	const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }) as Record<
		string,
		Json
	>;
	// A nested schema inherits its dialect from the document; a $schema key
	// here makes some validators treat the subtree as a separate document.
	delete json.$schema;
	return json;
}

function multipartSchema(fields: NonNullable<Endpoint['multipart']>): Json {
	const properties: Record<string, Json> = {};
	const required: string[] = [];
	for (const f of fields) {
		properties[f.field] = { type: 'string', description: f.description };
		if (f.required) required.push(f.field);
	}
	return required.length
		? { type: 'object', properties, required }
		: { type: 'object', properties };
}

function responseFor(ep: Endpoint): Record<string, Json> {
	if (ep.response === 'empty') {
		return { '204': { description: ep.returns ?? 'Success. No content.' } };
	}
	const status = String(ep.status ?? 200);
	if (ep.response === 'collection') {
		return {
			[status]: {
				description: ep.returns ?? 'A page of results.',
				content: {
					'application/json': { schema: { $ref: '#/components/schemas/Page' } }
				}
			}
		};
	}
	if (ep.response === 'binary') {
		return {
			[status]: {
				description: ep.returns ?? 'Binary payload.',
				content: {
					[ep.contentType ?? 'application/octet-stream']: {
						schema: { type: 'string', format: 'binary' }
					}
				}
			}
		};
	}
	return {
		[status]: {
			description: ep.returns ?? 'Success.',
			content: { 'application/json': { schema: { type: 'object' } } }
		}
	};
}

function parametersFor(ep: Endpoint): Json[] {
	const params: Json[] = [];

	for (const name of ep.path.matchAll(/\{(\w+)\}/g)) {
		params.push({ name: name[1], in: 'path', required: true, schema: { type: 'string' } });
	}

	if (ep.response === 'collection') {
		params.push(
			{ $ref: '#/components/parameters/limit' },
			{ $ref: '#/components/parameters/cursor' },
			{ $ref: '#/components/parameters/orderBy' },
			{ $ref: '#/components/parameters/orderDir' }
		);
	}

	for (const q of ep.query ?? []) {
		params.push({
			name: q.name,
			in: 'query',
			required: false,
			description: q.description,
			schema: { type: 'string' }
		});
	}

	if (ep.idempotent) params.push({ $ref: '#/components/parameters/idempotencyKey' });

	return params;
}

function operationFor(
	ep: Endpoint,
	errorDescriptions: Record<number, string>,
	alwaysErrors: number[]
): Json {
	const op: Record<string, Json> = {
		summary: ep.summary,
		operationId: operationId(ep),
		tags: [tagFor(ep.path)],
		'x-scope': ep.scope
	};

	if (ep.internal) op['x-internal'] = true;

	const params = parametersFor(ep);
	if (params.length) op.parameters = params;

	if (ep.requestBody) {
		op.requestBody = {
			required: true,
			content: { 'application/json': { schema: requestBodySchema(ep.requestBody) } }
		};
	} else if (ep.multipart) {
		op.requestBody = {
			required: true,
			content: { 'multipart/form-data': { schema: multipartSchema(ep.multipart) } }
		};
	}

	const responses = responseFor(ep);
	const statuses = new Set([...(ep.errors ?? []), ...alwaysErrors]);
	if (ep.idempotent) statuses.add(422);
	for (const status of [...statuses].sort((a, b) => a - b)) {
		responses[String(status)] = {
			description: errorDescriptions[status] ?? 'Error.',
			content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
		};
	}
	op.responses = responses;

	return op;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A file-like segment (`/openapi.json`) drops its extension in names.
const stem = (s: string) => s.replace(/\..*$/, '');

function tagFor(path: string): string {
	return cap(stem(path.split('/')[1] ?? 'root'));
}

/** `PATCH /jobs/{id}` → `patchJobsById`. Public contract: clients and MCP tools call by it. */
export function operationId(ep: Pick<Endpoint, 'method' | 'path'>): string {
	const segments = ep.path
		.split('/')
		.filter(Boolean)
		.map((s) => (s.startsWith('{') ? `By${cap(s.slice(1, -1))}` : cap(stem(s))));
	return ep.method.toLowerCase() + segments.join('');
}

export function buildOpenApiDocument(endpoints: Endpoint[], options: OpenApiOptions): Json {
	const errorDescriptions = { ...DEFAULT_ERROR_DESCRIPTIONS, ...options.errorDescriptions };
	const alwaysErrors = options.alwaysErrors ?? [401, 403, 429, 500];

	const paths: Record<string, Record<string, Json>> = {};
	for (const ep of endpoints) {
		const path = `${options.basePath}${ep.path}`;
		(paths[path] ??= {})[ep.method.toLowerCase()] = operationFor(
			ep,
			errorDescriptions,
			alwaysErrors
		);
	}

	const paginated = endpoints.some((ep) => ep.response === 'collection');
	const parameters: Record<string, Json> = {};
	if (paginated) {
		parameters.limit = {
			name: 'limit',
			in: 'query',
			required: false,
			description: `Page size. Out-of-range values clamp rather than fail, so a client walking a cursor is never stopped by pagination plumbing. Default ${DEFAULT_PAGE_LIMIT}.`,
			schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_LIMIT }
		};
		parameters.cursor = {
			name: 'cursor',
			in: 'query',
			required: false,
			description:
				"An opaque cursor from a previous response's `nextCursor`. Do not construct or parse one.",
			schema: { type: 'string' }
		};
		parameters.orderBy = {
			name: 'orderBy',
			in: 'query',
			required: false,
			schema: { type: 'string', enum: ['createdAt', 'updatedAt', 'name'] }
		};
		parameters.orderDir = {
			name: 'orderDir',
			in: 'query',
			required: false,
			schema: { type: 'string', enum: ['asc', 'desc'] }
		};
	}
	if (endpoints.some((ep) => ep.idempotent)) {
		parameters.idempotencyKey = {
			name: 'Idempotency-Key',
			in: 'header',
			required: false,
			description: options.idempotencyKeyDescription ?? DEFAULT_IDEMPOTENCY_KEY_DESCRIPTION,
			schema: { type: 'string', minLength: 1, maxLength: 255 }
		};
	}

	const schemas: Record<string, Json> = {};
	if (paginated) {
		schemas.Page = {
			type: 'object',
			description:
				'The envelope every collection returns. `nextCursor` is absent on the last page.',
			properties: {
				items: { type: 'array', items: { type: 'object' } },
				nextCursor: { type: 'string' }
			},
			required: ['items']
		};
	}
	schemas.Error = {
		type: 'object',
		description:
			'Every failure carries this shape. Branch on `code`, not on the human-readable `message`.',
		properties: {
			message: { type: 'string' },
			code: { type: 'string', enum: Object.values(ApiErrorCode) },
			fields: {
				type: 'object',
				description: 'Per-field messages, keyed by dotted path. Present on validation failures.',
				additionalProperties: { type: 'string' }
			},
			details: {
				type: 'object',
				description:
					'Machine-readable context. A scope refusal carries `requiredScope`, e.g. `write:org:<id>`.',
				additionalProperties: { type: 'string' }
			}
		},
		required: ['message', 'code']
	};
	Object.assign(schemas, options.schemas);

	const components: Record<string, Json> = { securitySchemes: options.securitySchemes };
	if (Object.keys(parameters).length) components.parameters = parameters;
	components.schemas = schemas;

	return {
		openapi: '3.1.0',
		info: options.info as unknown as Json,
		servers: [{ url: '/', description: 'The instance serving this document.' }],
		security: options.security,
		components,
		paths: paths as unknown as Json
	};
}
