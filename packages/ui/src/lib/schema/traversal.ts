// Moved to @selvajs/schemas, next to the types it walks, so any package depending on the
// schema can traverse it without pulling in @selvajs/ui. Re-exported to keep existing
// @selvajs/ui importers working.
export { getGroups, getLayoutItems, getInputItems, type InputLayoutItem } from '@selvajs/schemas';
