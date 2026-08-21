/**
 * Accessors for the host-composed services on `SelvaDeps`.
 *
 * `services` is host-supplied and optional by type, so every call site would
 * otherwise repeat a presence check or reach for `!`. A host that mounts these
 * handlers without wiring a service it needs gets a named error here rather
 * than `Cannot read properties of undefined` from inside the service call.
 */

import type { SelvaDeps } from '@selvajs/server/api';
import type { OrgAssetService } from '../../organizations/OrgAssetService';

export function definitionService(deps: SelvaDeps) {
	const service = deps.services.definitions;
	if (!service) {
		throw new Error('SelvaDeps.services.definitions is not wired — mount requires it.');
	}
	return service;
}

/**
 * Cast rather than a typed field on `SelvaDeps`: `OrgAssetService` lives in this
 * app, not `@selvajs/server`, so the package cannot name it. Moving the class is
 * the real fix and is worth doing when org branding moves out of the app.
 */
export function orgAssetService(deps: SelvaDeps): OrgAssetService {
	const service = deps.services.orgAssets as OrgAssetService | undefined;
	if (!service) {
		throw new Error('SelvaDeps.services.orgAssets is not wired — mount requires it.');
	}
	return service;
}
