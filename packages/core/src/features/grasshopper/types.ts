/**
 * Grasshopper types - backward compatibility re-exports
 *
 * This file re-exports all types from the organized subdirectory structure.
 * Direct imports from this file continue to work, but new code should import
 * directly from the specific type modules for better organization.
 *
 * @deprecated Import from specific modules instead:
 * - import type { ... } from './types/parameters'
 * - import type { ... } from './types/trees'
 * - import type { ... } from './types/grouping'
 * - import type { ... } from './types/schemas'
 */

// Re-export everything from the organized type modules index
export * from './types/index';

// Re-export the configuration types for convenience
export type { ComputeConfig, RhinoModelUnit } from '@/core/types';
