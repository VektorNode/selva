import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { requireManageCompute } from '$lib/server/access.server';
import {
	platformServers,
	type ComputeServerConfig,
	type PlatformComputeServer
} from '@selvajs/platform';
import { evictChangedServers } from '$lib/server/compute/evictChangedServers';
import {
	validateIncomingServers,
	resolveApiKey,
	storedKeysById,
	type IncomingServerBase
} from '$lib/server/compute/serverConfigWrite';
import { renderThrown } from '@selvajs/server/logging';

/**
 * Admin platform-server endpoint. `manage_compute` only. Reads/writes the
 * platform-scope rows + the global `defaultServerId`. Org-private rows and
 * `orgDefaults` are handled by `/api/v1/orgs/[orgId]/compute`.
 */

type ServerPayload = Omit<PlatformComputeServer, 'apiKey' | 'hasApiKey'> & { hasApiKey: boolean };

interface IncomingServer extends IncomingServerBase {
	sharedWith: 'all' | string[];
}

interface IncomingConfig {
	servers: IncomingServer[];
	defaultServerId?: string;
}

// GET — return platform servers + global default. API keys are stripped and
// replaced with a `hasApiKey` flag.
export const GET: RequestHandler = async ({ locals }) => {
	requireManageCompute(locals);
	try {
		const config = await getComputeServerConfigStore().getConfig(locals.ctx!);
		const servers = platformServers(config).map(
			({ apiKey: _apiKey, hasApiKey, ...rest }): ServerPayload => ({
				...rest,
				hasApiKey: !!hasApiKey
			})
		);
		return json({
			servers,
			defaultServerId: config.defaultServerId
		});
	} catch (err) {
		locals.log.error('Failed to load compute config', {
			component: 'Compute GET',
			err: renderThrown(err)
		});
		apiError(500, ApiErrorCode.INTERNAL, 'Failed to load compute config');
	}
};

// PUT — replace the full set of platform servers + global default.
// apiKey field semantics:
//   omitted / undefined  → preserve the currently stored key (matched by id)
//   null                 → explicitly clear the key
//   non-empty string     → replace with new value
export const PUT: RequestHandler = async ({ request, locals }) => {
	requireManageCompute(locals);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object')
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid request body');

	const incoming = body as IncomingConfig;
	if (!Array.isArray(incoming.servers))
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'servers must be an array');

	validateIncomingServers(incoming.servers);

	// Platform-only: org servers have an owner instead of a share list.
	for (const s of incoming.servers) {
		if (s.sharedWith !== 'all' && !Array.isArray(s.sharedWith)) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				'sharedWith must be "all" or an array of org ids'
			);
		}
		if (Array.isArray(s.sharedWith) && s.sharedWith.some((x) => typeof x !== 'string')) {
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'sharedWith array must contain strings');
		}
	}

	if (incoming.defaultServerId) {
		const found = incoming.servers.find((s) => s.id === incoming.defaultServerId);
		if (!found)
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				'defaultServerId must reference one of the submitted servers'
			);
	}

	try {
		const provider = getComputeServerConfigStore();
		// One of the few reads that genuinely needs every key: unchanged servers
		// keep their stored key, and `evictChangedServers` diffs on key rotation.
		const existing = await provider.getConfig(locals.ctx!, { includeApiKeys: true });
		const storedKeys = storedKeysById(platformServers(existing));

		const next: ComputeServerConfig[] = incoming.servers.map(
			({ apiKey, sharedWith, ...rest }): PlatformComputeServer => ({
				...rest,
				scope: 'platform',
				sharedWith: sharedWith === 'all' ? 'all' : [...sharedWith],
				apiKey: resolveApiKey(apiKey, storedKeys.get(rest.id))
			})
		);

		await provider.savePlatformServers(locals.ctx!, next, incoming.defaultServerId);
		// Drop warm clients for servers whose URL/key rotated or that were removed —
		// keyed on `id`, they wouldn't age out on their own (ADR 0004).
		evictChangedServers(platformServers(existing), next);
		return new Response(null, { status: 204 });
	} catch (err) {
		locals.log.error('Failed to save compute config', {
			component: 'Compute PUT',
			err: renderThrown(err)
		});
		apiError(500, ApiErrorCode.INTERNAL, 'Failed to save compute config');
	}
};
