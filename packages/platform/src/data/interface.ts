/**
 * `IDataProvider` is the composition root that bundles every store an adapter
 * implements. Individual interfaces (`IOrgStore`, `IProjectStore`, …) live
 * next to their types in their respective subdirs — only the composition
 * lives here.
 *
 * Every store method takes a `RequestContext` first. **The query itself is
 * the security boundary** — adapters MUST scope reads/writes by `ctx`. An
 * unauthorized caller sees an empty page, `null`, or a `ProviderError`.
 *
 * Access-control predicates live in `@selvajs/platform/access` (pure rules).
 * Stores do storage; rules do rules.
 */

import type { IOrgStore } from '../organizations/interface.js';
import type { IProjectStore } from '../projects/interface.js';
import type { IDefinitionStore } from '../definitions/interface.js';
import type { IComputeServerStore } from '../computeServer/interface.js';
import type { IShareLinkStore } from '../shareLinks/interface.js';
import type { IPlatformProjectGrantStore } from '../platformProjects/interface.js';
import type { IInviteStore } from '../invites/interface.js';
import type { IUserProfileStore } from '../userProfile/interface.js';
import type { IPlatformPermissionStore } from '../permissions/interface.js';

export interface IDataProvider {
	orgs: IOrgStore;
	projects: IProjectStore;
	definitions: IDefinitionStore;
	computeServer: IComputeServerStore;
	invites: IInviteStore;
	shareLinks: IShareLinkStore;
	userProfile: IUserProfileStore;
	permissions: IPlatformPermissionStore;
	platformProjectGrants: IPlatformProjectGrantStore;
}
