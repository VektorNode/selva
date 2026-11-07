import { assertSafeKey } from '../storage/safeKey.js';
import type { OrgAssetKind } from './schemas.js';

function prefix(id: string): string {
	assertSafeKey(id, 'orgId');
	return `orgs/${id}/`;
}

/**
 * Every branding asset is stored as `.webp` (uploads go through the shared
 * transcoder), so the path per kind is fixed and a re-upload overwrites in
 * place via `IStorageProvider.put`'s upsert.
 *
 * Branding lives under `orgs/{id}/branding/` because it's a *public* asset
 * class — anyone, including logged-out viewers, may read a company logo.
 * `classifyAssetPath` / `ASSET_CLASSES` decide visibility from these prefixes.
 */
export const orgPaths = {
	asset: (id: string, kind: OrgAssetKind) => {
		assertSafeKey(kind, 'assetKind');
		return `${prefix(id)}branding/${kind}.webp`;
	},
	prefix
} as const;
