import type { OrgAssetKind } from './schemas.js';

/**
 * Path-segment safety check. Blocks traversal, separators, NUL, and empty
 * segments. Allowed alphabet `[A-Za-z0-9._-]+` covers GUIDs and sanitized
 * refs. Called by every helper so a malicious `id` can't escape the
 * `orgs/` prefix. Mirrors `definitionPaths`' guard.
 */
function assertSafeKey(value: string, label: string): void {
	if (!value || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
		throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
	}
}

/**
 * Storage keys for org-scoped assets. Every asset is stored as `.webp` (uploads
 * are rasterized through the shared transcoder), so the path per kind is fixed
 * — a re-upload overwrites in place via `IStorageProvider.put`'s upsert. The
 * filename IS the kind, so the layout is generic: a new asset kind needs no new
 * helper.
 */
export const orgPaths = {
	asset: (id: string, kind: OrgAssetKind) => {
		assertSafeKey(id, 'orgId');
		assertSafeKey(kind, 'assetKind');
		return `orgs/${id}/${kind}.webp`;
	},
	prefix: (id: string) => {
		assertSafeKey(id, 'orgId');
		return `orgs/${id}/`;
	}
} as const;
