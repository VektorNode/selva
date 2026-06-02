// Schema layout traversal now lives in @selvajs/schemas (next to the types it walks) so
// any package depending on the schema can traverse it without pulling in @selvajs/ui.
// Re-exported here to keep it part of @selvajs/ui's published surface for existing
// consumers.
export { getGroups, getLayoutItems, getInputItems, type InputLayoutItem } from '@selvajs/schemas';
