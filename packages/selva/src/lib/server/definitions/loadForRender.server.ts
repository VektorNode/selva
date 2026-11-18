// `@selvajs/server/definitions` owns the loading pipeline (version resolution,
// blob fetch, schema staleness check, default merging); this wires in the
// app's providers, compute-server resolution, and warm-client cache. Access
// gating stays with the calling route.

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
import { serverResolver } from '../compute/serverResolver.server';
import { getClient, COMPUTE_DEBUG } from '../compute/engine.server';

export { DefinitionLoadError };
export type { DefinitionChannel, DefinitionLoadErrorKind, LoadedDefinition };

// One loader for the process. It keeps the saved values it read, the Compute read that loads
// share and the pause after a failed read, so a loader per request sends the file to Compute on
// every page load and never serves what came back. Providers are looked up per call.
const load = createDefinitionLoader({
	storage: { get: (key) => getStorageProvider().get(key) },
	definitions: {
		getVersion: (ctx, versionId) => getDefinitionMeta().getVersion(ctx, versionId),
		setVersionSchema: (ctx, versionId, schema) =>
			getDefinitionMeta().setVersionSchema(ctx, versionId, schema)
	},
	projects: { getProject: (ctx, projectId) => getProjectProvider().getProject(ctx, projectId) },
	resolveServer: (ctx, orgId, opts) =>
		serverResolver.resolve(ctx, orgId, getComputeServerConfigStore(), opts),
	getClient,
	computeDebug: COMPUTE_DEBUG
});

export function loadDefinitionForRender(
	ctx: RequestContext,
	record: DefinitionRecord,
	channel: DefinitionChannel,
	explicitVersionId?: string | null
): Promise<LoadedDefinition> {
	return load(ctx, record, channel, explicitVersionId);
}
