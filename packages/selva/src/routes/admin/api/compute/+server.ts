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

/**
 * Admin platform-server endpoint. `manage_compute` only. Reads/writes the
 * platform-scope rows + the global `defaultServerId`. Org-private rows and
 * `orgDefaults` are handled by `/api/org/compute`.
 */

type ServerPayload = Omit<PlatformComputeServer, 'apiKey'> & { hasApiKey: boolean };

interface IncomingServer {
	id: string;
	label: string;
	serverUrl: string;
	sharedWith: 'all' | string[];
	apiKey?: string | null;
	timeoutMs?: number;
	retryCount?: number;
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
			({ apiKey, ...rest }): ServerPayload => ({
				...rest,
				hasApiKey: !!apiKey
			})
		);
		return json({
			servers,
			defaultServerId: config.defaultServerId
		});
	} catch (err) {
		console.error('[Compute GET] Failed:', err);
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

	for (const s of incoming.servers) {
		if (!s.id || typeof s.id !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Each server needs an id');
		if (!s.label || typeof s.label !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Each server needs a label');
		if (!s.serverUrl || typeof s.serverUrl !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Each server needs a serverUrl');
		try {
			new URL(s.serverUrl);
		} catch {
			apiError(400, ApiErrorCode.VALIDATION_FAILED, `Invalid serverUrl: ${s.serverUrl}`);
		}
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
		if (s.apiKey !== undefined && s.apiKey !== null && typeof s.apiKey !== 'string')
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'apiKey must be a string, null, or omitted');
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
		const existing = await provider.getConfig(locals.ctx!);
		const storedKeyById = new Map(platformServers(existing).map((s) => [s.id, s.apiKey]));

		const next: ComputeServerConfig[] = incoming.servers.map(
			({ apiKey, sharedWith, ...rest }): PlatformComputeServer => ({
				...rest,
				scope: 'platform',
				sharedWith: sharedWith === 'all' ? 'all' : [...sharedWith],
				apiKey: apiKey === null ? undefined : apiKey ? apiKey : storedKeyById.get(rest.id)
			})
		);

		await provider.savePlatformServers(locals.ctx!, next, incoming.defaultServerId);
		// Drop warm clients for servers whose URL/key rotated or that were removed —
		// keyed on `id`, they wouldn't age out on their own (ADR 0004).
		evictChangedServers(platformServers(existing), next);
		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('[Compute PUT] Failed:', err);
		apiError(500, ApiErrorCode.INTERNAL, 'Failed to save compute config');
	}
};
