/**
 * Builds the OpenAPI 3.1 document for `/api/v1` from the route registry.
 *
 * Request schemas come from `z.toJSONSchema` over the actual validators, so a
 * renamed body field changes the spec on the next generate rather than leaving
 * the yaml describing a field that no longer exists.
 *
 * Response schemas are *not* derived — handlers build payloads from store
 * records with no Zod validator on the way out. They're described structurally
 * instead (pagination envelope, error envelope), and resource bodies stay open.
 * Claiming more precision than exists would be worse than claiming less.
 */

import { z, type ZodType } from 'zod';
import { V1_ENDPOINTS, type Endpoint } from './registry.js';
import { ApiErrorCode } from '../../api-errors.js';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@selvajs/platform';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const ERROR_DESCRIPTIONS: Record<number, string> = {
	400: 'Validation failed.',
	401: 'Missing or invalid credentials.',
	403: 'Authenticated, but not permitted to perform this action.',
	404: 'No such resource, or the caller cannot see it.',
	409: 'The request conflicts with the current state.',
	422: 'Well-formed but not processable.',
	429: 'Rate limited. Retry after the interval in `Retry-After`.',
	500: 'Unexpected server error.',
	503: 'The compute server is unconfigured or unreachable.'
};

function requestBodySchema(schema: ZodType): Json {
	// io: 'input' — fields with defaults are optional on the way in, unlike the output view.
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

function responseFor(ep: Endpoint): Json {
	if (ep.response === 'empty') {
		return { '204': { description: 'Success. No content.' } };
	}
	const status = String(ep.status ?? 200);
	if (ep.response === 'collection') {
		return {
			[status]: {
				description: 'A page of results.',
				content: {
					'application/json': { schema: { $ref: '#/components/schemas/Page' } }
				}
			}
		};
	}
	if (ep.response === 'binary') {
		return {
			[status]: {
				description: 'Binary payload.',
				content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
			}
		};
	}
	return {
		[status]: {
			description: 'Success.',
			content: { 'application/json': { schema: { type: 'object' } } }
		}
	};
}

function parametersFor(ep: Endpoint): Json[] {
	const params: Json[] = [];

	for (const name of ep.path.matchAll(/\{(\w+)\}/g)) {
		params.push({
			name: name[1],
			in: 'path',
			required: true,
			schema: { type: 'string' }
		});
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

	return params;
}

function operationFor(ep: Endpoint): Json {
	const op: Record<string, Json> = {
		summary: ep.summary,
		operationId: operationId(ep),
		tags: [tagFor(ep.path)]
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

	if (ep.method === 'POST' && ep.path.endsWith('/solve')) {
		op.parameters = [
			...((op.parameters as Json[]) ?? []),
			{
				name: 'Idempotency-Key',
				in: 'header',
				required: false,
				description:
					'A client-chosen key. Repeating a request with the same key within the retention window replays the first response instead of solving again; the replay carries `Idempotency-Replayed: true`. The store is per-process and in-memory — it absorbs retries, it is not a durable result cache, and it does not survive a restart or a second app instance.',
				schema: { type: 'string' }
			}
		];
	}

	const responses = responseFor(ep) as Record<string, Json>;
	for (const status of [...(ep.errors ?? []), 401, 500].sort((a, b) => a - b)) {
		responses[String(status)] = {
			description: ERROR_DESCRIPTIONS[status] ?? 'Error.',
			content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
		};
	}
	op.responses = responses;

	return op;
}

function tagFor(path: string): string {
	const first = path.split('/')[1] ?? 'root';
	return first.charAt(0).toUpperCase() + first.slice(1);
}

function operationId(ep: Endpoint): string {
	const segments = ep.path
		.split('/')
		.filter(Boolean)
		.map((s) => (s.startsWith('{') ? `By${cap(s.slice(1, -1))}` : cap(s)));
	return ep.method.toLowerCase() + segments.join('');
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Route prefix every endpoint in this registry is served under. */
export const API_BASE_PATH = '/api/v1';

/**
 * `info.version` describes the API, not the npm package — they move
 * independently on purpose. `/api/v1` is additive-only, so every release
 * publishes the same contract; embedding the package version made the spec
 * drift on every version bump for no API reason.
 *
 * Derived from the base path so the major can't contradict the prefix it's
 * served under: shipping `/api/v2` moves both at once, or neither.
 */
export const API_VERSION = `${/v(\d+)$/.exec(API_BASE_PATH)?.[1] ?? '1'}.0.0`;

export function buildOpenApiDocument(version: string = API_VERSION): Json {
	const paths: Record<string, Record<string, Json>> = {};
	for (const ep of V1_ENDPOINTS) {
		const path = `${API_BASE_PATH}${ep.path}`;
		(paths[path] ??= {})[ep.method.toLowerCase()] = operationFor(ep);
	}

	return {
		openapi: '3.1.0',
		info: {
			title: 'Selva API',
			version,
			description:
				'The tenant-scoped Selva API. Every endpoint acts as the calling identity and is ' +
				"confined to that identity's organization.\n\n" +
				'**Stability.** Public endpoints are additive-only within v1: new optional fields and ' +
				'parameters may appear, but nothing is removed, renamed, or changed in type or meaning. ' +
				'A breaking change ships as a new route under `/api/v2` alongside this one. Anything ' +
				'deprecated inside v1 keeps working for a stated window and returns a `Deprecation` ' +
				'header while it does.\n\n' +
				'**Operations marked `x-internal` carry none of that promise.** They exist to serve the ' +
				'Selva web UI and may change or disappear without notice.\n\n' +
				'**Existence is never disclosed.** A resource the caller may not see returns `404`, not ' +
				'`403`. `403` means the resource is visible but the action is not allowed.\n\n' +
				'**No CORS.** `/api/v1` sends no cross-origin headers; it serves same-origin browser ' +
				'requests and non-browser clients holding a token.\n\n' +
				'Instance administration lives at `/api/admin`, is session-only, is never reachable ' +
				'with a bearer token, and is not described here.',
			license: { name: 'MIT' }
		},
		servers: [{ url: '/', description: 'The Selva instance serving this document.' }],
		security: [{ cookieAuth: [] }, { bearerAuth: [] }],
		components: {
			securitySchemes: {
				cookieAuth: {
					type: 'apiKey',
					in: 'cookie',
					name: 'session',
					description: 'Browser session cookie. Same-origin only.'
				},
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description:
						'A personal access token. `/api/v1` is the only prefix that accepts one — ' +
						'`/api/admin` never does.'
				}
			},
			parameters: {
				limit: {
					name: 'limit',
					in: 'query',
					required: false,
					description: `Page size. Out-of-range values clamp rather than fail, so a client walking a cursor is never stopped by pagination plumbing. Default ${DEFAULT_PAGE_LIMIT}.`,
					schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_LIMIT }
				},
				cursor: {
					name: 'cursor',
					in: 'query',
					required: false,
					description:
						"An opaque cursor from a previous response's `nextCursor`. Do not construct or parse one.",
					schema: { type: 'string' }
				},
				orderBy: {
					name: 'orderBy',
					in: 'query',
					required: false,
					schema: { type: 'string', enum: ['createdAt', 'updatedAt', 'name'] }
				},
				orderDir: {
					name: 'orderDir',
					in: 'query',
					required: false,
					schema: { type: 'string', enum: ['asc', 'desc'] }
				}
			},
			schemas: {
				Page: {
					type: 'object',
					description:
						'The envelope every collection returns. `nextCursor` is absent on the last page.',
					properties: {
						items: { type: 'array', items: { type: 'object' } },
						nextCursor: { type: 'string' }
					},
					required: ['items']
				},
				Error: {
					type: 'object',
					description:
						'Every failure carries this shape. Branch on `code`, not on the human-readable `message`.',
					properties: {
						message: { type: 'string' },
						code: { type: 'string', enum: Object.values(ApiErrorCode) },
						fields: {
							type: 'object',
							description:
								'Per-field messages, keyed by dotted path. Present on validation failures.',
							additionalProperties: { type: 'string' }
						}
					},
					required: ['message', 'code']
				}
			}
		},
		paths: paths as unknown as Json
	};
}

// ============================================================================
// YAML serialization
// ============================================================================
//
// A full YAML library is overkill for one file with narrow, known value types
// (strings, numbers, booleans, arrays, plain objects) and no anchors, tags, or
// multi-document streams.

function needsQuoting(s: string): boolean {
	return (
		s === '' ||
		/^[\s]|[\s]$/.test(s) ||
		/[:#{}[\],&*?|<>=!%@`"']/.test(s) ||
		/\n/.test(s) ||
		/^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
		/^[-+.0-9]/.test(s)
	);
}

function scalar(value: string | number | boolean | null): string {
	if (value === null) return 'null';
	if (typeof value !== 'string') return String(value);
	if (!needsQuoting(value)) return value;
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function isScalar(v: Json): v is string | number | boolean | null {
	return v === null || typeof v !== 'object';
}

function emit(value: Json, indent: number, lines: string[]): void {
	const pad = '  '.repeat(indent);

	if (Array.isArray(value)) {
		for (const item of value) {
			if (isScalar(item)) {
				lines.push(`${pad}- ${scalar(item)}`);
			} else {
				// Open the item on the dash line so nested maps stay compact.
				const nested: string[] = [];
				emit(item, indent + 1, nested);
				lines.push(`${pad}- ${nested[0].slice((indent + 1) * 2)}`);
				lines.push(...nested.slice(1));
			}
		}
		return;
	}

	for (const [key, v] of Object.entries(value as Record<string, Json>)) {
		const k = needsQuoting(key) ? `"${key}"` : key;
		if (isScalar(v)) {
			lines.push(`${pad}${k}: ${scalar(v)}`);
		} else if (Array.isArray(v) && v.length === 0) {
			lines.push(`${pad}${k}: []`);
		} else if (!Array.isArray(v) && Object.keys(v).length === 0) {
			lines.push(`${pad}${k}: {}`);
		} else {
			lines.push(`${pad}${k}:`);
			emit(v, indent + 1, lines);
		}
	}
}

export function toYaml(doc: Json): string {
	const lines: string[] = [
		'# Generated from the Zod validators and the route registry in',
		'# src/lib/server/api/v1/. Do not edit by hand — `pnpm test` fails when this',
		'# file drifts from the code. Regenerate with `pnpm openapi:generate`.'
	];
	emit(doc, 0, lines);
	return lines.join('\n') + '\n';
}
