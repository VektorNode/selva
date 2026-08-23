export { DefinitionService, type CreateDefinitionRecord } from './definition-service.js';

export {
	fetchSchemaFromCompute,
	postSchemaFormData,
	assertSupportedSchemaVersion,
	assertCamelCaseSchema,
	readSchemaResults,
	SchemaExtractionError
} from './schema-extraction.js';
export type { SchemaExtractionResult } from './schema-extraction.js';

export {
	createDefinitionLoader,
	DefinitionLoadError,
	type DefinitionChannel,
	type DefinitionLoader,
	type DefinitionLoaderDeps,
	type DefinitionLoadErrorKind,
	type DefinitionLoadOptions,
	type LoadedDefinition
} from './load-for-render.js';

export {
	resolveAccessibleProjects,
	listVisibleDefinitions,
	getVisibleDefinition,
	loadVisibleVersion,
	type VisibilityDeps,
	type AccessibleProjectSet,
	type ListVisibleDefinitionsResult
} from './visibility.js';
