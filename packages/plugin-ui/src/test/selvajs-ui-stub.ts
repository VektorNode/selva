// Test-only stand-in for @selvajs/ui, aliased in by vitest.config.ts. The real barrel
// re-exports `.svelte` components this svelte-plugin-free vitest can't parse, so we expose
// only the non-UI helpers the pure logic under test actually needs. Re-exported from the
// source module (not duplicated) so it can't drift from @selvajs/ui.
export { getDefaultValue } from '../../../ui/src/lib/schema/defaults';
