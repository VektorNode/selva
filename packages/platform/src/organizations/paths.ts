import { assertSafeKey } from '../storage/safeKey.js';
import type { OrgAssetKind } from './schemas.js';

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
		assertSafeKey(id, 'orgId');
		assertSafeKey(kind, 'assetKind');
		return `orgs/${id}/branding/${kind}.webp`;
	},
	/**
	 * @deprecated No asset class serves this path, so nothing can read what lands
	 * here. Removed at the next major.
	 */
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
