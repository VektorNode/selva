/**
 * Selva's `/api/v1` OpenAPI document: the shared builder from
 * `@selvajs/server/api` over this app's route registry.
 */

import { buildOpenApiDocument as build, type Json } from '@selvajs/server/api';
import { V1_ENDPOINTS } from './registry.js';

const ERROR_DESCRIPTIONS: Record<number, string> = {
	403: 'Authenticated, but not permitted to perform this action. For an API token, `details.requiredScope` names the scope that would have passed.',
	429: 'Rate limited. Retry after the interval in `Retry-After`. API-token callers have a per-token request budget, reported on every response in `RateLimit-Limit` and `RateLimit-Remaining`; solves also draw on the owner’s compute budget.',
	503: 'The compute server is unconfigured or unreachable, or API tokens are unavailable on this server (`API_TOKENS_UNAVAILABLE`).'
};

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
	return build(V1_ENDPOINTS, {
		basePath: API_BASE_PATH,
		errorDescriptions: ERROR_DESCRIPTIONS,
		alwaysErrors: [401, 403, 429, 500, 503],
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
				'**Scopes.** Each operation names the API-token scope it needs as `x-scope`: `read`, ' +
				'`write` or `solve`.\n\n' +
				'Instance administration lives at `/api/admin`, is session-only, is never reachable ' +
				'with a bearer token, and is not described here.',
			license: { name: 'MIT' }
		},
		security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
					'An API token (`selva_…`), sent as `Authorization: Bearer <token>` and never in the URL. ' +
					'It acts as the user who created it, in one org, narrowed by its scopes. ' +
					'`/api/v1` is the only prefix that accepts one; `/api/admin` never does.'
			}
		}
	});
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
