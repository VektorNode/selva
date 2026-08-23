import { createHash } from 'node:crypto';
import type { IOrgStore, IStorageProvider, OrgAssetKind, RequestContext } from '@selvajs/platform';
import { orgPaths, ProviderError, withCacheBust } from '@selvajs/platform';

/**
 * Orchestrates org-asset writes that span IStorageProvider + IOrgStore — one
 * service for every asset kind (logo, favicon, …).
 *
 * Every upload is rasterized to WebP by the shared transcoder inside
 * `IStorageProvider.put`, so the stored blob is always
 * `orgs/{id}/branding/{kind}.webp` (the `branding/` segment marks the public
 * asset class — see `classifyAssetPath`). SVG inputs are flattened to a
 * 1200px raster — no vector blob is persisted, which keeps the served bytes
 * XSS-free without a sanitizer. Re-uploads overwrite in place. The org's
 * `assets` map is the source of truth for which kinds exist and their public
 * URLs; we read-merge-write it so concurrent edits to *different* kinds don't
 * clobber each other within a kind.
 *
 * Re-uploads overwrite the same path, so the stored URL would be identical
 * across replaces and a cached browser/CDN would keep serving the old bytes.
 * The content-derived `?v=` token (`withCacheBust`) gives a *different* image a
 * *different* URL, while an identical re-upload keeps its URL and stays cached.
 */
export class OrgAssetService {
	constructor(
		private orgs: IOrgStore,
		private storage: IStorageProvider
	) {}

	/**
	 * Store `kind`'s blob and point the org's `assets[kind]` at its public URL.
	 * `contentType` must be the *original* upload type (e.g. `image/svg+xml`) so
	 * the transcoder recognizes the bytes as an image. Returns the public URL.
	 */
	async saveAsset(
		ctx: RequestContext,
		orgId: string,
		kind: OrgAssetKind,
		data: Uint8Array,
		contentType: string
	): Promise<string> {
		const path = orgPaths.asset(orgId, kind);
		await this.storage.put(path, data, contentType);
		// Content-derived token, not a timestamp: an identical re-upload to the
		// same path keeps the same URL and stays cached; a changed image gets a
		// new URL and refetches immediately. 8 hex chars is enough to distinguish
		// versions without bloating the URL.
		const token = createHash('sha256').update(data).digest('hex').slice(0, 8);
		const url = withCacheBust(this.storage.getPublicUrl(path), token);
		await this.orgs.updateOrg(ctx, orgId, {
			assets: await this.mergedAssets(ctx, orgId, kind, url)
		});
		return url;
	}

	/** Remove `kind`'s blob and drop it from the org's `assets` map. No-op-safe. */
	async removeAsset(ctx: RequestContext, orgId: string, kind: OrgAssetKind): Promise<void> {
		await this.storage.delete(orgPaths.asset(orgId, kind));
		await this.orgs.updateOrg(ctx, orgId, {
			assets: await this.mergedAssets(ctx, orgId, kind, undefined)
		});
	}

	/**
	 * Read the org's current `assets` and return a copy with `kind` set to `url`
	 * (or removed when `url` is undefined). Keeps the other kinds intact.
	 */
	private async mergedAssets(
		ctx: RequestContext,
		orgId: string,
		kind: OrgAssetKind,
		url: string | undefined
	): Promise<Record<string, string>> {
		const org = await this.orgs.getOrg(ctx, orgId);
		if (!org) throw new ProviderError(`Org '${orgId}' not found`, 404);
		const next = { ...(org.assets ?? {}) } as Record<string, string>;
		if (url === undefined) delete next[kind];
		else next[kind] = url;
		return next;
	}
}
