// App binding for the definition render loader, moved to
// `@selvajs/server/definitions` (embeddable-server-layer K4). The package owns
// the loading pipeline (version resolution, blob fetch, schema staleness check
// per ADR 0005, default merging); this file is the composition root that wires
// the app's providers, compute-server resolution, and warm-client cache into
// it. Access gating stays with the calling route, as before.

import {
	createDefinitionLoader,
	DefinitionLoadError,
	type DefinitionChannel,
	type DefinitionLoadErrorKind,
	type LoadedDefinition
} from '@selvajs/server/definitions';
import type { DefinitionRecord, RequestContext } from '@selvajs/platform';
import { getStorageProvider, getDefinitionMeta, getProjectProvider } from '../providers.server';
import { resolveServerForOrg } from '../compute/resolve.server';
import { getClient } from '../compute/clientCache.server';
import { env } from '$env/dynamic/private';

export { DefinitionLoadError };
export type { DefinitionChannel, DefinitionLoadErrorKind, LoadedDefinition };

// Verbose IO diagnostics — same flag as the solve route.
const COMPUTE_DEBUG = ['true', '1', 'yes'].includes(
	(env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase()
);

export async function loadDefinitionForRender(
	ctx: RequestContext,
	record: DefinitionRecord,
	channel: DefinitionChannel,
	explicitVersionId?: string | null
): Promise<LoadedDefinition> {
	const load = createDefinitionLoader({
		storage: getStorageProvider(),
		definitions: getDefinitionMeta(),
		projects: getProjectProvider(),
		resolveServer: (ctx, orgId, opts) => resolveServerForOrg(ctx, orgId, opts),
		getClient,
		computeDebug: COMPUTE_DEBUG
	});
	return load(ctx, record, channel, explicitVersionId);
}
