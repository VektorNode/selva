import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrganizationProvider, getOrgAssetService } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';
import { OrgAssetKindSchema } from '@selvajs/platform';
import { apiRoute, noContent, requireUpload } from '$lib/server/api/v1/route';

/**
 * Org branding assets, generic over kind (`logo`, `favicon`, …). Gated on
 * `manage_org_members` — org branding is an org-admin action.
 *
 * Raster images and SVG are both accepted. Every input is rasterized to WebP by
 * the shared transcoder inside the storage provider, so SVG carries no XSS
 * surface: no vector blob is ever stored or served. The allowlist below is the
 * HTTP gate; the rasterization is the security control.
 */
const ALLOWED_CONTENT_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/svg+xml'
]);

function parseKind(params: { kind?: string }) {
	const kind = OrgAssetKindSchema.safeParse(params.kind);
	if (!kind.success) apiError(404, ApiErrorCode.NOT_FOUND, `Unknown asset kind '${params.kind}'`);
	return kind.data;
}

export const POST: RequestHandler = apiRoute(
	'Failed to upload asset',
	async ({ params, request, locals }) => {
		requireManageOrgMembers(locals);
		const kind = parseKind(params);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		// The org must exist — keeps a leaked id from seeding orphan blobs.
		const org = await getOrganizationProvider().getOrg(ctx, orgId);
		if (!org) apiError(404, ApiErrorCode.NOT_FOUND, 'Organization not found');

		const { file } = requireUpload(await request.formData(), 'image', {
			maxBytes: MAX_IMAGE_FILE_SIZE,
			contentTypes: {
				allowed: ALLOWED_CONTENT_TYPES,
				message: 'Unsupported image type. Allowed: PNG, JPG, WebP, GIF, SVG'
			},
			label: 'Image'
		});

		const bytes = new Uint8Array(await file.arrayBuffer());
		const url = await getOrgAssetService().saveAsset(ctx, orgId, kind, bytes, file.type);
		return json({ kind, url });
	}
);

export const DELETE: RequestHandler = apiRoute(
	'Failed to remove asset',
	async ({ params, locals }) => {
		requireManageOrgMembers(locals);
		const kind = parseKind(params);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		await getOrgAssetService().removeAsset(ctx, orgId, kind);
		return noContent();
	}
);
