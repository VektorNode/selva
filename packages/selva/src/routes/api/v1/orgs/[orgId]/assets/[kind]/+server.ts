import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrganizationProvider, getOrgAssetService } from '$lib/server/providers.server';
import { requireManageOrgMembers, requireActingOrg } from '$lib/server/access.server';
import { handleApiError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';
import { OrgAssetKindSchema } from '@selvajs/platform';

/**
 * Org branding-asset upload/removal, generic over asset kind (`logo`,
 * `favicon`, …). Gated on `manage_org_members` — managing org branding is an
 * org-admin action.
 *
 * Accepts raster images and SVG. Every input is rasterized to WebP by the
 * shared transcoder inside the storage provider, so SVG carries no XSS surface
 * — no vector blob is ever stored or served. The allowlist below is the HTTP
 * gate; the rasterization is the security control.
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

// POST /api/v1/orgs/{orgId}/assets/{kind} — upload an asset
export const POST: RequestHandler = async ({ params, request, locals }) => {
	requireManageOrgMembers(locals);
	const kind = parseKind(params);
	const { ctx, orgId: id } = requireActingOrg(locals, params.orgId);

	// The org must exist — keeps a leaked id from seeding orphan blobs.
	const org = await getOrganizationProvider().getOrg(ctx, id);
	if (!org) apiError(404, ApiErrorCode.NOT_FOUND, 'Organization not found');

	const formData = await request.formData();
	const file = formData.get('image');
	if (!(file instanceof File) || file.size === 0) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Image file is required');
	}
	if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			'Unsupported image type. Allowed: PNG, JPG, WebP, GIF, SVG'
		);
	}
	if (file.size > MAX_IMAGE_FILE_SIZE) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`
		);
	}

	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const url = await getOrgAssetService().saveAsset(ctx, id, kind, bytes, file.type);
		return json({ kind, url });
	} catch (err) {
		handleApiError(err, 'Failed to upload asset');
	}
};

// DELETE /api/v1/orgs/{orgId}/assets/{kind} — remove an asset
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageOrgMembers(locals);
	const kind = parseKind(params);
	const { ctx, orgId: id } = requireActingOrg(locals, params.orgId);

	try {
		await getOrgAssetService().removeAsset(ctx, id, kind);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to remove asset');
	}
};
