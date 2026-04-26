import type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore,
	IInviteStore,
	IShareLinkStore,
	IEventSink
} from '@selva/platform';
import { NoopEventSink } from '@selva/platform';
import * as path from 'node:path';
import { LocalOrgStore, LocalOrgStoreLoader } from './LocalOrgStore.js';
import { LocalProjectStore } from './LocalProjectStore.js';
import { LocalDefinitionStore } from './LocalDefinitionStore.js';
import { LocalComputeServerStore } from './LocalComputeServerStore.js';
import { LocalInviteStore } from './LocalInviteStore.js';
import { LocalShareLinkStore } from './LocalShareLinkStore.js';

/**
 * Composition of every local-provider data store. One `LocalOrgStoreLoader`
 * is shared across org + project stores so they see the same cache and
 * atomic write path.
 */
export class LocalDataProvider implements IDataProvider {
	readonly orgs: IOrgStore;
	readonly projects: IProjectStore;
	readonly definitions: IDefinitionStore;
	readonly computeServer: IComputeServerStore;
	readonly invites: IInviteStore;
	readonly shareLinks: IShareLinkStore;

	static fromEnv(
		env: Record<string, string | undefined>,
		events: IEventSink = new NoopEventSink()
	): LocalDataProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		const loader = new LocalOrgStoreLoader(env.DATA_PATH);
		const orgs = new LocalOrgStore(loader, events);
		const projects = new LocalProjectStore(loader, events);
		const definitions = new LocalDefinitionStore(env.DATA_PATH, undefined, events);
		const shareLinks = new LocalShareLinkStore(
			path.join(env.DATA_PATH, 'share-links.json'),
			events
		);
		// Wire cross-store deps: canEditDefinition needs the project store, and
		// share-link resolution needs the definition store to enforce the §7
		// soft-delete cascade (Supabase does the equivalent via JOIN).
		definitions.setProjectProvider(projects);
		shareLinks.setDefinitionProvider(definitions);
		return new LocalDataProvider(
			orgs,
			projects,
			definitions,
			LocalComputeServerStore.fromEnv(env),
			LocalInviteStore.fromEnv(env, events),
			shareLinks
		);
	}

	constructor(
		orgs: IOrgStore,
		projects: IProjectStore,
		definitions: IDefinitionStore,
		computeServer: IComputeServerStore,
		invites: IInviteStore,
		shareLinks: IShareLinkStore
	) {
		this.orgs = orgs;
		this.projects = projects;
		this.definitions = definitions;
		this.computeServer = computeServer;
		this.invites = invites;
		this.shareLinks = shareLinks;
	}
}
