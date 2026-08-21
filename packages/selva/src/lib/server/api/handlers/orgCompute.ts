/**
 * Per-org compute config: this org's own servers (`scope: 'org'`) and its
 * default selection (`orgDefaults[orgId]`). Platform servers and the global
 * default are read-only here — `manage_compute` owns those via `/api/admin/compute`.
 *
 * Authorization: org `owner`/`admin` with `manage_org_compute`, plus the acting-org
 * tenancy check. Gated by `ALLOW_ORG_COMPUTE_OVERRIDE`; when off, both methods 403.
 *
 * **`apiKey` merge semantics are the trap here.** Omitted preserves the stored
 * key, `null` clears it, a string replaces it — and `/api/admin/compute` must
 * agree, which is why the merge lives in `serverConfigWrite`, not inline.
 */

import { apiError, ApiErrorCode, noContent } from '@selvajs/server/api';
import type { ApiHandler, ApiRequest } from '@selvajs/server/api';
import {
	isOrgServer,
	isPlatformServer,
	serversVisibleTo,
	type OrgComputeServer
} from '@selvajs/platform';
import { requireManageOrgCompute, requireActingOrg } from '../../access.server';
import { evictChangedServers } from '../../compute/evictChangedServers';
import {
	validateIncomingServers,
	resolveApiKey,
	storedKeysById,
	type IncomingServerBase
} from '../../compute/serverConfigWrite';
import { parseBody, shaped } from '../v1/route';
import { OrgComputeResponseSchema } from '../v1/responses';
import { OrgComputePatchBodySchema } from '../v1/bodies';

function requireFlag(req: ApiRequest) {
	if (!req.deps.flag('ALLOW_ORG_COMPUTE_OVERRIDE')) {
		apiError(
			403,
			ApiErrorCode.FORBIDDEN,
			'Per-org compute override is disabled on this instance (ALLOW_ORG_COMPUTE_OVERRIDE).'
		);
	}
}

export const getOrgCompute: ApiHandler = async (req) => {
	requireFlag(req);
	requireManageOrgCompute(req);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);

	// Scoped in the store, so `config.servers` holds only what this org may
	// see and `defaultServerId` is blank unless it is one of them.
	const config = await req.deps.computeServer.getConfig(ctx, { scopeToOrgId: orgId });

	// Servers this org owns and may edit. `apiKey` is dropped by the response
	// schema; `hasApiKey` is what a picker needs to render "key set".
	const owned = config.servers
		.filter((s): s is OrgComputeServer => isOrgServer(s) && s.ownerOrgId === orgId)
		.map((s) => ({ ...s, hasApiKey: !!s.hasApiKey }));

	// Platform and own servers visible to this org — the read-only catalog
	// behind the "default selection" dropdown.
	const catalog = config.servers.map((s) => ({
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
};

export const updateOrgCompute: ApiHandler = async (req) => {
	requireFlag(req);
	requireManageOrgCompute(req);
	const { ctx, orgId } = requireActingOrg(req, req.params.orgId);

	const incoming = await parseBody(req.request, OrgComputePatchBodySchema);
	// Cross-field rules the schema can't express (URL shape, duplicate ids).
	validateIncomingServers(incoming.servers as IncomingServerBase[]);

	const provider = req.deps.computeServer;
	// Every key is needed: an unchanged server keeps its stored key across the write.
	const existing = await provider.getConfig(ctx, { includeApiKeys: true });
	const storedKeys = storedKeysById(
		existing.servers.filter((s): s is OrgComputeServer => isOrgServer(s) && s.ownerOrgId === orgId)
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
};
