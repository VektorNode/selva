/**
 * Org branding assets, generic over kind (`logo`, `favicon`, …). Gated on
 * `manage_org_members` — org branding is an org-admin action.
 *
 * Raster images and SVG are both accepted. Every input is rasterized to WebP by
 * the shared transcoder inside the storage provider, so SVG carries no XSS
 * surface: no vector blob is ever stored or served. The allowlist below is the
 * HTTP gate; the rasterization is the security control.
 */

import {
	apiError,
	ApiErrorCode,
	noContent,
	requireUpload,
	type ApiHandler
} from '@selvajs/server/api';
import { OrgAssetKindSchema } from '@selvajs/platform';
import { requireManageOrgMembers, requireActingOrg } from '../../access.server';
import { orgAssetService } from './services';

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

export const uploadOrgAsset: ApiHandler = async (req) => {
	requireManageOrgMembers(req);
	const kind = parseKind(req.params);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);

	// The org must exist — keeps a leaked id from seeding orphan blobs.
	const org = await req.deps.orgs.getOrg(ctx, orgId);
	if (!org) apiError(404, ApiErrorCode.NOT_FOUND, 'Organization not found');

	const { file } = requireUpload(await req.request.formData(), 'image', {
		maxBytes: req.deps.uploadLimits.maxImageFileSize,
		contentTypes: {
			allowed: ALLOWED_CONTENT_TYPES,
			message: 'Unsupported image type. Allowed: PNG, JPG, WebP, GIF, SVG'
		},
		label: 'Image'
	});

	const bytes = new Uint8Array(await file.arrayBuffer());
	const url = await orgAssetService(req.deps).saveAsset(ctx, orgId, kind, bytes, file.type);
	return { body: { kind, url } };
};

export const removeOrgAsset: ApiHandler = async (req) => {
	requireManageOrgMembers(req);
	const kind = parseKind(req.params);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);

	await orgAssetService(req.deps).removeAsset(ctx, orgId, kind);
	return noContent();
};
