import type { OrgAssetKind } from './schemas.js';

/**
 * Blocks path traversal, separators, and empty segments. Called by every
 * helper below so a malicious `id` can't escape the `orgs/` prefix.
 */
function assertSafeKey(value: string, label: string): void {
	// The regex alone allows '.' and '..' — both fully match the allowed alphabet — so they need an explicit check.
	if (!value || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
		throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
	}
}

/**
 * Every branding asset is stored as `.webp` (uploads go through the shared
 * transcoder), so the path per kind is fixed and a re-upload overwrites in
 * place via `IStorageProvider.put`'s upsert.
 *
 * Branding lives under `orgs/{id}/branding/` because it's a *public* asset
 * class — anyone, including logged-out viewers, may read a company logo.
 * That segment distinguishes it from `orgs/{id}/private/` (members-only).
 * `classifyAssetPath` / `ASSET_CLASSES` decide public-vs-private from these
 * prefixes.
 */
export const orgPaths = {
	asset: (id: string, kind: OrgAssetKind) => {
		assertSafeKey(id, 'orgId');
		assertSafeKey(kind, 'assetKind');
		return `orgs/${id}/branding/${kind}.webp`;
	},
	/** Members-only blob; `name` includes the extension. */
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
