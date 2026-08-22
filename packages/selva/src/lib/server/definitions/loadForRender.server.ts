// App binding for the definition render loader in `@selvajs/server/definitions`.
// The package owns the loading pipeline (version resolution, blob fetch,
// schema staleness check, default merging); this file wires in the app's
// providers, compute-server resolution, and warm-client cache. Access gating
// stays with the calling route.

import {
	createDefinitionLoader,
	DefinitionLoadError,
	type DefinitionChannel,
	type DefinitionLoadErrorKind,
	type LoadedDefinition
} from '@selvajs/server/definitions';
import type { DefinitionRecord, RequestContext } from '@selvajs/platform';
import {
	getStorageProvider,
	getDefinitionMeta,
	getProjectProvider,
	getComputeServerConfigStore
} from '../providers.server';
import { resolveServerForOrg } from '@selvajs/server/compute';
import { getClient, COMPUTE_DEBUG } from '../compute/engine.server';

export { DefinitionLoadError };
export type { DefinitionChannel, DefinitionLoadErrorKind, LoadedDefinition };

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
		resolveServer: (ctx, orgId, opts) =>
			resolveServerForOrg(ctx, orgId, getComputeServerConfigStore(), opts),
		getClient,
		computeDebug: COMPUTE_DEBUG
	});
	return load(ctx, record, channel, explicitVersionId);
}
