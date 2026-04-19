import type { IDataProvider, IOrgStore, IDefinitionStore, IComputeServerStore } from '@selva/platform';
import { LocalOrganizationProvider } from '../organizations/LocalOrganizationProvider.js';
import { LocalDefinitionMetaProvider } from './LocalDefinitionMetaProvider.js';
import { FilesystemComputeServerStore } from '../computeServer/FilesystemComputeServerStore.js';

export class LocalDataProvider implements IDataProvider {
	readonly orgs: IOrgStore;
	readonly definitions: IDefinitionStore;
	readonly computeServer: IComputeServerStore;

	static fromEnv(env: Record<string, string | undefined>): LocalDataProvider {
		return new LocalDataProvider(
			LocalOrganizationProvider.fromEnv(env),
			LocalDefinitionMetaProvider.fromEnv(env),
			FilesystemComputeServerStore.fromEnv(env)
		);
	}

	constructor(
		orgs: IOrgStore,
		definitions: IDefinitionStore,
		computeServer: IComputeServerStore
	) {
		this.orgs = orgs;
		this.definitions = definitions;
		this.computeServer = computeServer;
	}
}
