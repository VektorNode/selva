// Definitions server slice — the write orchestration (DefinitionService), the
// compute-schema extraction/validation gate, and the render loader. All
// composition-root wiring (stores, warm-client cache, server resolution) is
// injected; access gating stays with the calling app.

export { DefinitionService, type CreateDefinitionRecord } from './definition-service.js';

export {
	fetchSchemaFromCompute,
	assertSupportedSchemaVersion,
	SchemaExtractionError
} from './schema-extraction.js';

export {
	createDefinitionLoader,
	DefinitionLoadError,
	type DefinitionChannel,
	type DefinitionLoader,
	type DefinitionLoaderDeps,
	type DefinitionLoadErrorKind,
	type LoadedDefinition
} from './load-for-render.js';
