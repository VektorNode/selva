import type {
	IDataProvider,
	IOrgStore,
	IProjectStore,
	IDefinitionStore,
	IComputeServerStore,
	IInviteStore,
	IShareLinkStore,
	IEventSink
} from '@selvajs/platform';
import { NoopEventSink } from '@selvajs/platform';
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
		const projects = new LocalProjectStore(loader, events);
		const definitions = new LocalDefinitionStore(env.DATA_PATH, undefined, events);
		const shareLinks = new LocalShareLinkStore(
			path.join(env.DATA_PATH, 'share-links.json'),
			events
		);
		const invites = LocalInviteStore.fromEnv(env, events);
		const computeServer = LocalComputeServerStore.fromEnv(env);
		const orgs = new LocalOrgStore(loader, invites, computeServer, events);
		// Wire cross-store deps that aren't constructor-injected:
		// - canEditDefinition needs the project store for `listPublic`
		// - share-link resolution needs the definition store to enforce the §7
		//   soft-delete cascade (Supabase does the equivalent via JOIN)
		definitions.setProjectProvider(projects);
		shareLinks.setDefinitionProvider(definitions);
		return new LocalDataProvider(orgs, projects, definitions, computeServer, invites, shareLinks);
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
