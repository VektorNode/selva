// Configurable provider wiring — env-driven provider selection over a
// caller-supplied registry, `selva.config.js` override hook, lazy memoized
// instantiation. The app keeps its own getters (services, error reporting) as
// its composition root; this is the reusable core underneath.

export {
	createSelvaProviders,
	type CreateSelvaProvidersOptions,
	type ProviderFactory,
	type ProviderRegistry,
	type SelvaProviderRuntime
} from './create-selva-providers.js';
