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

import { isFlagEnabled } from '@selvajs/platform';
import type { DefinitionService } from '../definitions/definition-service.js';
import type {
	IAuthProvider,
	IDataProvider,
	IStorageProvider,
	SelvaConfig,
	SelvaFlags
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
	/**
	 * Feature flags, as a predicate rather than a record: an omitted flag must
	 * read as false, and keeping that in `isFlagEnabled` stops each caller from
	 * re-deciding what a missing flag means.
	 */
	flag: (name: keyof SelvaFlags) => boolean;
	/**
	 * Composed services the host supplies.
	 *
	 * `definitions` is typed because handlers call it — leaving it `unknown`
	 * pushed a cast into every call site, and a cast is exactly where a second
	 * host's differently-shaped service would slip through unnoticed. The index
	 * signature keeps host-specific extras (`orgAssets`) possible without
	 * naming them here.
	 */
	services: { definitions?: DefinitionService } & Record<string, unknown>;
}

/**
 * Build deps from a resolved `SelvaConfig`, plus whatever services the host
 * composed on top. The hoisted fields are aliases into `data`, not copies.
 */
export function depsFromConfig(
	config: SelvaConfig,
	services: SelvaDeps['services'] = {}
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
		flag: (name) => isFlagEnabled(config, name),
		services
	};
}
