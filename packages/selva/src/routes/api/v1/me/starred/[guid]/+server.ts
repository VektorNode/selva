import type { RequestHandler } from './$types';
import { getUserProfileStore } from '$lib/server/providers.server';
import { apiRoute, noContent, requireCaller, requireParams } from '$lib/server/api/v1/route';

/** Star a definition for the calling user. Idempotent. */
export const PUT: RequestHandler = apiRoute(
	'Failed to star definition',
	async ({ params, locals }) => {
		const { ctx, user } = requireCaller(locals);
		const { guid } = requireParams(params, 'guid');

		await getUserProfileStore().starDefinition(ctx, user.id, guid);
		return noContent();
	}
);

/** Unstar a definition for the calling user. Idempotent. */
export const DELETE: RequestHandler = apiRoute(
	'Failed to unstar definition',
	async ({ params, locals }) => {
		const { ctx, user } = requireCaller(locals);
		const { guid } = requireParams(params, 'guid');

		await getUserProfileStore().unstarDefinition(ctx, user.id, guid);
		return noContent();
	}
);
