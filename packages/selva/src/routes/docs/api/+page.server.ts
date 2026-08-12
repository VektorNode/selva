import type { PageServerLoad } from './$types';
import { V1_ENDPOINTS, type Endpoint } from '$lib/server/api/v1/registry';
import { ApiErrorCode } from '$lib/server/api-errors';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@selvajs/platform';

/**
 * The public API reference.
 *
 * **Internal endpoints are filtered out here, on the server.** Shipping the
 * whole registry and hiding half of it in markup would put the internal surface
 * in the page payload, where it is one devtools panel away from being read as a
 * promise.
 *
 * The page is unauthenticated: it documents the shape of the API, not any
 * tenant's data.
 */

export interface DocGroup {
	tag: string;
	endpoints: {
		method: string;
		path: string;
		summary: string;
		paginated: boolean;
		hasBody: boolean;
		multipart: { field: string; required: boolean; description: string }[] | null;
		query: { name: string; description: string }[];
		errors: number[];
	}[];
}

function tagFor(path: string): string {
	const first = path.split('/')[1] ?? 'other';
	return first.charAt(0).toUpperCase() + first.slice(1);
}

// Group order, most useful first rather than alphabetical: a reader arriving
// here wants to solve something.
const TAG_ORDER = ['Definitions', 'Projects', 'Orgs', 'Me'];

export const load: PageServerLoad = () => {
	const groups = new Map<string, DocGroup>();

	for (const ep of V1_ENDPOINTS.filter((e: Endpoint) => !e.internal)) {
		const tag = tagFor(ep.path);
		const group = groups.get(tag) ?? { tag, endpoints: [] };
		group.endpoints.push({
			method: ep.method,
			path: `/api/v1${ep.path}`,
			summary: ep.summary,
			paginated: ep.response === 'collection',
			hasBody: Boolean(ep.requestBody),
			multipart: ep.multipart ?? null,
			query: ep.query ?? [],
			errors: [...(ep.errors ?? []), 401, 500].sort((a, b) => a - b)
		});
		groups.set(tag, group);
	}

	const ordered = [...groups.values()].sort(
		(a, b) =>
			(TAG_ORDER.indexOf(a.tag) + 1 || 99) - (TAG_ORDER.indexOf(b.tag) + 1 || 99) ||
			a.tag.localeCompare(b.tag)
	);

	return {
		groups: ordered,
		errorCodes: Object.values(ApiErrorCode),
		pagination: { defaultLimit: DEFAULT_PAGE_LIMIT, maxLimit: MAX_PAGE_LIMIT }
	};
};
