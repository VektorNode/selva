export type { IDataProvider } from './interface.js';

// Re-export individual store interfaces from their owning modules so callers
// can keep importing them from `@selvajs/platform/data` if convenient. New
// callers are encouraged to import from the owning module directly.
export type { IOrgStore } from '../organizations/interface.js';
export type { IProjectStore } from '../projects/interface.js';
export type { IDefinitionStore } from '../definitions/interface.js';
export type { IComputeServerStore } from '../computeServer/interface.js';
export type { IShareLinkStore } from '../shareLinks/interface.js';
export type { IPlatformProjectGrantStore } from '../platformProjects/interface.js';
