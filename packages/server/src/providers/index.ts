// Configurable provider wiring — env-driven selection over a caller-supplied
// registry, with a `selva.config.js` override hook.

export {
	createSelvaProviders,
	type CreateSelvaProvidersOptions,
	type ProviderFactory,
	type ProviderRegistry,
	type SelvaProviderRuntime
} from './create-selva-providers.js';
