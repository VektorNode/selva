/**
 * Starring a definition for the calling user. Both directions are idempotent.
 *
 * No visibility check: a star is a row on the caller's own profile, keyed by
 * guid, and reveals nothing about whether that guid exists. The read paths that
 * expand stars into definitions filter by visibility there.
 */

import { noContent, type ApiHandler } from '@selvajs/server/api';
import { requireParams } from '../v1/route';
import { requireCaller } from '../callers';

export const starDefinition: ApiHandler = async (req) => {
	const { ctx, user } = requireCaller(req);
	const { guid } = requireParams(req.params, 'guid');

	await req.deps.userProfile.starDefinition(ctx, user.id, guid);
	return noContent();
};

export const unstarDefinition: ApiHandler = async (req) => {
	const { ctx, user } = requireCaller(req);
	const { guid } = requireParams(req.params, 'guid');

	await req.deps.userProfile.unstarDefinition(ctx, user.id, guid);
	return noContent();
};
