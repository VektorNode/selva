// Moved to @selvajs/schemas so server-side callers can share it without pulling
// in the UI package. Re-exported here to keep existing `@selvajs/ui` importers
// working.
export { getDefaultValue } from '@selvajs/schemas';
