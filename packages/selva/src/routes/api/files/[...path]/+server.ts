import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '#lib/server/api-errors.js';
import {
	GuidSchema,
	definitionPaths,
	classifyAssetPath,
	COVER_IMAGE_CONTENT_TYPES
} from '@selvajs/platform';
import { getVisibleDefinition } from '@selvajs/server/definitions';
import { getStorageProvider } from '#lib/server/providers.server.js';
import { accessDepsFromConfig } from '#lib/server/access.server.js';

/**
 * Authenticated/­public blob proxy. The set of servable paths is the closed
 * asset-class registry (`classifyAssetPath` / `ASSET_CLASSES` in
 * `@selvajs/platform`). Each class declares a visibility; this route maps that
 * visibility to an authorization check:
 *
 *   - `public`  (org branding — logo/favicon): served to anyone, incl.
 *     logged-out visitors, with no auth. Cacheable. The bytes are always a
 *     rasterized WebP, so there is no XSS surface to gate.
 *   - `project` (definition covers): the caller must be able to view the
 *     definition's project, by the same rule as definition reads.
 *
 * Anything that classifies to no asset class 404s. New blob types are opt-in:
 * add a registry entry with the right visibility — never a generic
 * "is the extension allowed" fallthrough. Authorization lives here (the route),
 * not in the storage layer, per `IStorageProvider`'s contract.
 *
 * Why a single proxy: with the registry, the route is no longer a
 * pile of per-shape branches — it classifies once and dispatches on visibility,
 * so the cover-only contract that this route used to pin now generalizes
 * without re-opening the M5 hole.
 */

// Content types we set on served blobs. Image types are reused from the
// canonical `COVER_IMAGE_CONTENT_TYPES` so cover/branding stay in lockstep with
// the upload validation. Deliberately NO `image/svg+xml`: no
// registered class serves SVG (branding is always rasterized WebP), and
// serving raw SVG would reintroduce the XSS surface the transcoder removes.
// Anything not listed falls back to `application/octet-stream` (download, not
// inline-render).
const CONTENT_TYPE_BY_EXT: Record<string, string> = COVER_IMAGE_CONTENT_TYPES;

function contentTypeFor(storagePath: string): string {
	const dot = storagePath.lastIndexOf('.');
	const ext = dot === -1 ? '' : storagePath.slice(dot).toLowerCase();
	return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const storagePath = params.path;
	if (!storagePath) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing path');

	// 1. Classify against the closed registry. No match → unservable → 404.
	const match = classifyAssetPath(storagePath);
	if (!match) apiError(404, ApiErrorCode.NOT_FOUND, 'File not found');

	// 2. Authorize per the class's visibility, and resolve the canonical
	//    storage path to read from. For `project` we re-derive the path from
	//    `definitionPaths` rather than echoing the request — eliminates any
	//    chance the matched path resolves to something else after decoding.
	let canonicalPath = storagePath;

	switch (match.class.visibility) {
		case 'public':
			// No auth — branding is world-readable. The registry's anchored,
			// safe-alphabet pattern is the only gate the path needs.
			break;

		case 'project': {
			if (!locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
			const guid = match.scopeId;
			const guidParsed = GuidSchema.safeParse(guid);
			if (!guidParsed.success) apiError(404, ApiErrorCode.NOT_FOUND, 'File not found');

			// 404, not 403, for a cover the caller can't view: a 403 would confirm the guid exists.
			const record = await getVisibleDefinition(
				locals.ctx,
				guidParsed.data,
				accessDepsFromConfig(locals.providers)
			);
			if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'File not found');

			canonicalPath = definitionPaths.image(guidParsed.data);
			break;
		}
	}

	// 3. Stream the bytes.
	const bytes = await getStorageProvider().get(canonicalPath);
	if (!bytes) apiError(404, ApiErrorCode.NOT_FOUND, 'File not found');

	// Public branding is CDN-cacheable; everything else is per-user private.
	const cacheControl =
		match.class.visibility === 'public' ? 'public, max-age=3600' : 'private, max-age=3600';

	return new Response(Buffer.from(bytes), {
		headers: {
			'Content-Type': contentTypeFor(canonicalPath),
			'Cache-Control': cacheControl
		}
	});
};
