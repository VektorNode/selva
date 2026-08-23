/**
 * Everything an API handler talks to, as one injected value.
 *
 * Handlers used to reach module-global getters (`getProjectProvider()`,
 * `getDefinitionService()`, …) from the Selva app's composition root — 77 call
 * sites across the v1 routes. That welded them to one app's boot: a second app
 * on a different provider set could not call them at all.
 *
 * Most fields are sub-stores of `IDataProvider`, so a host that already built a
 * `SelvaConfig` gets them via `depsFromConfig`. `services` stays host-defined:
 * `DefinitionService` and friends are composed rather than resolved, and a host
 * may supply its own.
 */

import { isFlagEnabled, NoopEventSink } from '@selvajs/platform';
import type { DefinitionService } from '../definitions/definition-service.js';
import type { OrgAssetService } from '../organizations/org-asset-service.js';
import type { TokenCodec } from '../tokens/token-codec.js';
import type {
	IAuthProvider,
	IDataProvider,
	IEventSink,
	INotificationProvider,
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
	 * Audit sink. Never optional here even though `SelvaConfig.events` is:
	 * handlers emit escalation events (`project.reclaimed`,
	 * `org_member.removed_orphaning_projects`) that the audit trail depends on,
	 * and a handler deciding for itself what a missing sink means is how one of
	 * them ends up silently unlogged. `depsFromConfig` substitutes
	 * `NoopEventSink`, which discards explicitly.
	 */
	events: IEventSink;
	/**
	 * Feature flags, as a predicate rather than a record: an omitted flag must
	 * read as false, and keeping that in `isFlagEnabled` stops each caller from
	 * re-deciding what a missing flag means.
	 */
	flag: (name: keyof SelvaFlags) => boolean;
	/**
	 * Token codecs, one per family, keyed by what they mint.
	 *
	 * Injected rather than resolved because the codec is built from an
	 * instance-wide HMAC secret, and reading that secret is the host's job — a
	 * package that reached for `process.env.SELVA_HMAC_KEY` itself would pin
	 * every host to one env var name and one way of loading it. Rotating a
	 * secret invalidates that family's outstanding tokens, so the two families
	 * are separate values rather than one shared codec.
	 *
	 * Optional: a host with no sharing and no invites wires neither. The
	 * handlers that need one fail loudly if it is absent rather than minting a
	 * token nobody can verify.
	 */
	tokens: {
		shareLinks?: TokenCodec;
		invites?: TokenCodec;
	};
	/**
	 * Upload caps, in bytes.
	 *
	 * Deployment config, so the host resolves them — a package reading its own
	 * env would pin every host to one variable name. Defaults apply when the
	 * host says nothing, because a missing cap must not read as "unlimited":
	 * `requireUpload` compares against this number, and `undefined` would let
	 * any size through.
	 */
	uploadLimits: {
		maxDefinitionFileSize: number;
		maxImageFileSize: number;
	};
	/**
	 * Outbound mail, and the instance name to fall back to when a record has no
	 * name of its own.
	 *
	 * Optional because mail is best-effort by design: an invite row is committed
	 * before delivery is attempted, and the caller still holds the accept URL to
	 * share by hand. A host with no mail configured wires nothing and the
	 * handlers report `not-configured` rather than failing the write.
	 */
	notifications?: INotificationProvider;
	/** Instance display name, used where a record has none. */
	instanceName: string;
	/**
	 * Drop the host's warm compute client for one server id.
	 *
	 * A warm client caches on server `id`, so a rotated URL or key keeps the
	 * same cache key with stale connection details and never ages out. The
	 * config-write handlers evict through this rather than importing a cache:
	 * which cache holds them is the host's decision, and importing one would
	 * pull a whole solve engine into every consumer.
	 *
	 * Defaults to a no-op — a host with no client cache has nothing to evict,
	 * and the handler must not have to know which kind of host it is running on.
	 */
	evictComputeClient: (id: string) => void;
	/**
	 * Composed services the host supplies.
	 *
	 * The named ones are typed because handlers call them — leaving a service
	 * `unknown` pushes a cast into every call site, and a cast is exactly where
	 * a second host's differently-shaped service would slip through unnoticed.
	 * The index signature keeps host-specific extras possible without naming
	 * them here.
	 */
	services: {
		definitions?: DefinitionService;
		orgAssets?: OrgAssetService;
	} & Record<string, unknown>;
}

/**
 * Build deps from a resolved `SelvaConfig`, plus whatever services and token
 * codecs the host composed on top. The hoisted fields are aliases into `data`,
 * not copies.
 *
 * `services` stays positional — every existing caller passes it there — and
 * `tokens` arrives in an options object rather than as a third positional, so
 * the two composed bags cannot be swapped at a call site.
 */
export function depsFromConfig(
	config: SelvaConfig,
	services: SelvaDeps['services'] = {},
	{
		tokens = {},
		uploadLimits,
		evictComputeClient = () => {},
		notifications,
		instanceName = 'Selva'
	}: {
		tokens?: SelvaDeps['tokens'];
		uploadLimits?: Partial<SelvaDeps['uploadLimits']>;
		evictComputeClient?: SelvaDeps['evictComputeClient'];
		notifications?: INotificationProvider;
		instanceName?: string;
	} = {}
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
		events: config.events ?? new NoopEventSink(),
		flag: (name) => isFlagEnabled(config, name),
		tokens,
		// Same defaults `resolveComputeLimits` applies, repeated rather than
		// imported: pulling that in would make every host resolving deps also
		// resolve compute limits from env, which is the coupling this avoids.
		uploadLimits: {
			maxDefinitionFileSize: uploadLimits?.maxDefinitionFileSize ?? 50 * 1024 * 1024,
			maxImageFileSize: uploadLimits?.maxImageFileSize ?? 10 * 1024 * 1024
		},
		evictComputeClient,
		notifications,
		instanceName,
		services
	};
}
