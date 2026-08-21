/**
 * Everything an API handler talks to, as one injected value.
 *
 * Handlers used to reach module-global getters (`getProjectProvider()`,
 * `getDefinitionService()`, …) from the Selva app's composition root — 77 call
 * sites across the v1 routes. That welded them to one app's boot: a second app
 * on a different provider set (parafa, on Supabase) could not call them at all.
 *
 * Most fields are sub-stores of `IDataProvider`, so a host that already built a
 * `SelvaConfig` gets them via `depsFromConfig`. `services` stays host-defined:
 * `DefinitionService` and friends are composed rather than resolved, and a host
 * may supply its own.
 */

import type {
	IAuthProvider,
	IDataProvider,
	IStorageProvider,
	SelvaConfig
} from '@selvajs/platform';

export interface SelvaDeps {
	auth: IAuthProvider;
	storage: IStorageProvider;
	data: IDataProvider;
	/** `data.orgs` — hoisted because 18 v1 call sites read it directly. */
	orgs: IDataProvider['orgs'];
	/** `data.projects` — 18 call sites. */
	projects: IDataProvider['projects'];
	/** `data.definitions` — the definition metadata store. */
	definitionMeta: IDataProvider['definitions'];
	computeServer: IDataProvider['computeServer'];
	userProfile: IDataProvider['userProfile'];
	shareLinks: IDataProvider['shareLinks'];
	invites: IDataProvider['invites'];
	permissions: IDataProvider['permissions'];
	platformProjectGrants: IDataProvider['platformProjectGrants'];
	/** Composed services the host supplies. Shapes stay host-defined for now. */
	services: Record<string, unknown>;
}

/**
 * Build deps from a resolved `SelvaConfig`, plus whatever services the host
 * composed on top. The hoisted fields are aliases into `data`, not copies.
 */
export function depsFromConfig(
	config: SelvaConfig,
	services: Record<string, unknown> = {}
): SelvaDeps {
	const { data } = config;
	return {
		auth: config.auth,
		storage: config.storage,
		data,
		orgs: data.orgs,
		projects: data.projects,
		definitionMeta: data.definitions,
		computeServer: data.computeServer,
		userProfile: data.userProfile,
		shareLinks: data.shareLinks,
		invites: data.invites,
		permissions: data.permissions,
		platformProjectGrants: data.platformProjectGrants,
		services
	};
}
