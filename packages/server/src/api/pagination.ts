/**
 * Query-param parsing for the list pagination contract:
 * `?limit=&cursor=&orderBy=&orderDir=` → `{ items, nextCursor? }`.
 *
 * Every list endpoint parses these identically, so the clamping lives here
 * rather than inline per handler — a handler that clamps differently publishes
 * a different contract under the same documented one, and nothing fails at
 * build time.
 */

import { clampPageLimit } from '@selvajs/platform';
import type { DefinitionListOptions, ListOptions } from '@selvajs/platform';

/**
 * An unparseable or out-of-range `limit` clamps rather than 400s: pagination
 * params are plumbing, and failing a read over one is hostile to clients
 * walking a cursor.
 */
export function parseListOptions(url: URL): ListOptions {
	const raw = url.searchParams.get('limit');
	const limit = clampPageLimit(raw === null ? undefined : Number(raw));

	const orderByRaw = url.searchParams.get('orderBy');
	const orderBy =
		orderByRaw === 'createdAt' || orderByRaw === 'updatedAt' || orderByRaw === 'name'
			? orderByRaw
			: undefined;

	return {
		limit,
		cursor: url.searchParams.get('cursor') ?? undefined,
		orderBy,
		orderDir: url.searchParams.get('orderDir') === 'asc' ? 'asc' : undefined
	};
}

/** `parseListOptions` plus the definition-only `solveCount` ordering. */
export function parseDefinitionListOptions(url: URL): DefinitionListOptions {
	const base = parseListOptions(url);
	if (url.searchParams.get('orderBy') === 'solveCount') {
		return { ...base, orderBy: 'solveCount' };
	}
	return base;
}
