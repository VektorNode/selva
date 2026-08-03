import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { flag, getComputeServerConfigStore } from '$lib/server/providers.server';
import { requireManageOrgCompute, requireActingOrg } from '$lib/server/access.server';
import {
	isOrgServer,
	isPlatformServer,
	serversVisibleTo,
	type OrgComputeServer
} from '@selvajs/platform';
import { evictChangedServers } from '$lib/server/compute/evictChangedServers';
import {
	validateIncomingServers,
	resolveApiKey,
	storedKeysById,
	type IncomingServerBase
} from '$lib/server/compute/serverConfigWrite';
import { apiRoute, noContent, parseBody, shaped } from '$lib/server/api/v1/route';
import { OrgComputeResponseSchema } from '$lib/server/api/v1/responses';
import { OrgComputePatchBodySchema } from '$lib/server/api/v1/bodies';

/**
 * Per-org compute endpoint. Manages this org's own servers
 * (`scope: 'org'`) and the org's default selection
 * (`orgDefaults[orgId]`). Platform servers and the global default are
 * read-only here — they're managed by `manage_compute` via `/api/admin/compute`.
 *
 * Authorization: org `owner`/`admin` with `manage_org_compute`. The URL `orgId`
 * must equal the caller's `actingOrgId`. Gated by the platform flag
 * `ALLOW_ORG_COMPUTE_OVERRIDE`; when off, both methods 403.
 */

function requireFlag() {
	if (!flag('ALLOW_ORG_COMPUTE_OVERRIDE')) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Per-org compute override is disabled on this instance (ALLOW_ORG_COMPUTE_OVERRIDE).'
		);
	}
}

export const GET: RequestHandler = apiRoute(
	'Failed to load org compute config',
	async ({ params, locals }) => {
		requireFlag();
		requireManageOrgCompute(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		const config = await getComputeServerConfigStore().getConfig(ctx);

		// Servers this org owns and may edit. `apiKey` is dropped by the response
		// schema; `hasApiKey` is what a picker needs to render "key set".
		const owned = config.servers
			.filter((s): s is OrgComputeServer => isOrgServer(s) && s.ownerOrgId === orgId)
			.map((s) => ({ ...s, hasApiKey: !!s.hasApiKey }));

		// Platform and own servers visible to this org — the read-only catalog
		// behind the "default selection" dropdown.
		const catalog = serversVisibleTo(config, orgId).map((s) => ({
			id: s.id,
			label: s.label,
			serverUrl: s.serverUrl,
			scope: s.scope,
			source: isPlatformServer(s) ? ('platform' as const) : ('org' as const),
			timeoutMs: s.timeoutMs,
			retryCount: s.retryCount
		}));

		return shaped(OrgComputeResponseSchema, {
			servers: owned,
			defaultServerId: config.orgDefaults?.[orgId] ?? null,
			globalDefaultServerId: config.defaultServerId ?? null,
			catalog
		});
	}
);

// PATCH — replace the org's own server set, optionally update the org's default.
// apiKey field semantics:
//   omitted / undefined  → preserve currently stored key (matched by id)
//   null                 → explicitly clear the key
//   non-empty string     → replace with new value
export const PATCH: RequestHandler = apiRoute(
	'Failed to save org compute config',
	async ({ params, request, locals }) => {
		requireFlag();
		requireManageOrgCompute(locals);
		const { ctx, orgId } = requireActingOrg(locals, params.orgId);

		const incoming = await parseBody(request, OrgComputePatchBodySchema);
		// Cross-field rules the schema can't express (URL shape, duplicate ids).
		validateIncomingServers(incoming.servers as IncomingServerBase[]);

		const provider = getComputeServerConfigStore();
		// Every key is needed: an unchanged server keeps its stored key across the write.
		const existing = await provider.getConfig(ctx, { includeApiKeys: true });
		const storedKeys = storedKeysById(
			existing.servers.filter(
				(s): s is OrgComputeServer => isOrgServer(s) && s.ownerOrgId === orgId
			)
		);

		const next: OrgComputeServer[] = incoming.servers.map((s) => ({
			id: s.id,
			scope: 'org',
			ownerOrgId: orgId,
			label: s.label,
			serverUrl: s.serverUrl,
			timeoutMs: s.timeoutMs,
			retryCount: s.retryCount,
			apiKey: resolveApiKey(s.apiKey, storedKeys.get(s.id))
		}));

		// The requested org default must be visible to this org. The check runs
		// against the projected post-save config so it sees both the new
		// org-private rows and the existing platform ones.
		if (typeof incoming.defaultServerId === 'string') {
			const projected = {
				servers: [
					...existing.servers.filter((s) => !(isOrgServer(s) && s.ownerOrgId === orgId)),
					...next
				],
				defaultServerId: existing.defaultServerId,
				orgDefaults: existing.orgDefaults
			};
			const visibleIds = new Set(serversVisibleTo(projected, orgId).map((s) => s.id));
			if (!visibleIds.has(incoming.defaultServerId)) {
				apiError(
					400,
					ApiErrorCode.VALIDATION_FAILED,
					'defaultServerId must reference a server visible to this organization'
				);
			}
		}

		await provider.saveOrgServers(ctx, orgId, next, incoming.defaultServerId);
		// Drop warm clients for servers whose URL or key rotated, or that were
		// removed — keyed on `id`, they would not age out on their own.
		evictChangedServers(
			existing.servers.filter((s) => isOrgServer(s) && s.ownerOrgId === orgId),
			next
		);
		return noContent();
	}
);
