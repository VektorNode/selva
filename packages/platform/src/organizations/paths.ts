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
 * Storage keys for org-scoped assets. Every branding asset is stored as `.webp`
 * (uploads are rasterized through the shared transcoder), so the path per kind
 * is fixed — a re-upload overwrites in place via `IStorageProvider.put`'s
 * upsert. The filename IS the kind, so the layout is generic: a new branding
 * kind needs no new helper.
 *
 * Branding lives under `orgs/{id}/branding/` because it is a *public* asset
 * class — anyone, incl. logged-out viewers, may read a company logo. The
 * `branding/` segment keeps it distinguishable from future org-private blobs
 * under `orgs/{id}/private/` (e.g. pricing sheets), which are members-only.
 * The serving route and `getPublicUrl` decide public-vs-private by classifying
 * these prefixes — see `classifyAssetPath` / `ASSET_CLASSES`.
 */
export const orgPaths = {
	asset: (id: string, kind: OrgAssetKind) => {
		assertSafeKey(id, 'orgId');
		assertSafeKey(kind, 'assetKind');
		return `orgs/${id}/branding/${kind}.webp`;
	},
	/** Members-only blob under the org's private tier. `name` includes the extension. */
	privateAsset: (id: string, name: string) => {
		assertSafeKey(id, 'orgId');
		assertSafeKey(name, 'assetName');
		return `orgs/${id}/private/${name}`;
	},
	prefix: (id: string) => {
		assertSafeKey(id, 'orgId');
		return `orgs/${id}/`;
	}
} as const;
